const express = require('express');
const cors = require('cors');
const config = require('./config');
const UDPServer = require('./udpServer');
const DataCleaner = require('./dataCleaner');
const PacketReorderer = require('./packetReorderer');
const InfluxStorage = require('./influxStorage');
const DataAggregator = require('./dataAggregator');
const AnomalyDetector = require('./anomalyDetector');
const WebSocketServer = require('./websocketServer');
const createApiRoutes = require('./apiRoutes');

class EyeTrackerServer {
  constructor() {
    this.udpServer = new UDPServer();
    this.dataCleaner = new DataCleaner();
    this.reorderer = new PacketReorderer({
      windowSizeMs: 200,
      maxWindowSize: 100,
      timeoutDiscardMs: 500
    });
    this.storage = new InfluxStorage();
    this.aggregator = new DataAggregator();
    this.anomalyDetector = new AnomalyDetector({
      sigmaThreshold: 3,
      windowSize: 300,
      cooldownMs: 10000
    });
    this.wsServer = new WebSocketServer();
    
    this.app = express();
    this.httpServer = null;
    
    this.stats = {
      rawPacketsReceived: 0,
      validDataPoints: 0,
      invalidDataPoints: 0,
      aggregatedPoints: 0,
      startTime: null
    };

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
      next();
    });
  }

  setupRoutes() {
    this.app.use('/api', createApiRoutes(this.storage));

    this.app.get('/', (req, res) => {
      res.json({
        name: 'Eye Tracker Backend',
        version: '1.0.0',
        status: this.getStatus(),
        endpoints: {
          health: 'GET /api/health',
          config: 'GET /api/config',
          dataRange: 'GET /api/data/range?start=<ts>&end=<ts>',
          dataLast: 'GET /api/data/last?duration=<ms>',
          aoiAnalyze: 'POST /api/aoi/analyze',
          aoiAnalyzeRange: 'POST /api/aoi/analyze-range',
          aoiScanPath: 'POST /api/aoi/scanpath',
          aoiTransitions: 'POST /api/aoi/transitions'
        }
      });
    });

    this.app.use((err, req, res, next) => {
      console.error('Server error:', err);
      res.status(500).json({ error: err.message });
    });
  }

  setupDataPipeline() {
    this.udpServer.on('data', (rawData) => {
      this.stats.rawPacketsReceived++;
      
      const cleaned = this.dataCleaner.clean(rawData);
      
      if (cleaned) {
        this.stats.validDataPoints++;
        this.reorderer.addPacket(cleaned);
      } else {
        this.stats.invalidDataPoints++;
      }
    });

    this.reorderer.on('data', (orderedData) => {
      this.storage.writePoint(orderedData);
      this.aggregator.addDataPoint(orderedData);
      
      const anomaly = this.anomalyDetector.processDataPoint(orderedData);
      if (anomaly && anomaly.type === 'anomaly') {
        this.wsServer.sendAnomalyAlert(anomaly);
        console.warn(`[ANOMALY] ${anomaly.message}: pupil=${anomaly.pupilDiameter.toFixed(2)}mm, z=${anomaly.zScore.toFixed(2)}, mean=${anomaly.mean.toFixed(2)}, stdDev=${anomaly.stdDev.toFixed(2)}`);
      }
    });

    this.reorderer.on('discarded', ({ reason, packet, age }) => {
      console.warn(`Packet discarded (${reason}): age=${age}ms, timestamp=${packet?.timestamp}`);
    });

    this.aggregator.on('aggregated', (data) => {
      this.stats.aggregatedPoints++;
      this.wsServer.sendAggregatedData(data);
    });

    setInterval(() => {
      if (this.wsServer && this.wsServer.clients && this.wsServer.clients.size > 0) {
        this.wsServer.sendStats(this.getStats());
      }
    }, 1000);
  }

  getStatus() {
    return {
      running: this.stats.startTime !== null,
      uptimeMs: this.stats.startTime ? Date.now() - this.stats.startTime : 0,
      influxdbConnected: this.storage.connected,
      udpServer: {
        port: config.udp.port,
        running: this.stats.startTime !== null
      },
      websocket: {
        port: config.websocket.port,
        connectedClients: this.wsServer.clients ? this.wsServer.clients.size : 0
      }
    };
  }

  getStats() {
    const uptimeMs = this.stats.startTime ? Date.now() - this.stats.startTime : 1;
    const reordererStats = this.reorderer.getStats();
    const anomalyStats = this.anomalyDetector.getStats();
    return {
      ...this.stats,
      uptimeMs,
      packetsPerSecond: Math.round((this.stats.rawPacketsReceived / uptimeMs) * 1000),
      validRate: this.stats.rawPacketsReceived > 0
        ? Math.round((this.stats.validDataPoints / this.stats.rawPacketsReceived) * 100)
        : 0,
      aggregationBufferSize: this.aggregator.getBufferSize(),
      reorderer: reordererStats,
      anomaly: anomalyStats
    };
  }

  async start() {
    console.log('='.repeat(60));
    console.log('Eye Tracker Backend Server Starting...');
    console.log('='.repeat(60));

    this.stats.startTime = Date.now();

    await this.storage.connect();
    await this.udpServer.start();
    await this.wsServer.start();
    
    this.reorderer.start();
    this.aggregator.start();
    this.anomalyDetector.start();
    global.anomalyDetector = this.anomalyDetector;
    this.setupDataPipeline();

    return new Promise((resolve, reject) => {
      this.httpServer = this.app.listen(config.http.port, () => {
        console.log('='.repeat(60));
        console.log(`HTTP Server running on http://localhost:${config.http.port}`);
        console.log(`UDP Server listening on port ${config.udp.port}`);
        console.log(`WebSocket Server on port ${config.websocket.port}`);
        console.log(`InfluxDB: ${this.storage.connected ? 'Connected' : 'Not connected'}`);
        console.log(`Packet Reorderer: window=200ms, timeout=500ms`);
        console.log(`Anomaly Detector: sigma=3, window=300`);
        console.log('='.repeat(60));
        resolve();
      });

      this.httpServer.on('error', (err) => {
        console.error('HTTP Server error:', err);
        reject(err);
      });
    });
  }

  async stop() {
    console.log('\nShutting down Eye Tracker Server...');
    
    this.reorderer.stop();
    this.aggregator.stop();
    this.anomalyDetector.stop();
    global.anomalyDetector = null;
    await this.udpServer.stop();
    await this.wsServer.stop();
    await this.storage.close();

    if (this.httpServer) {
      await new Promise((resolve) => {
        this.httpServer.close(() => resolve());
      });
    }

    console.log('Server stopped successfully');
    console.log('Final stats:', this.getStats());
  }
}

const server = new EyeTrackerServer();

process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, shutting down...');
  await server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM, shutting down...');
  await server.stop();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

server.start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = EyeTrackerServer;
