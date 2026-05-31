const express = require('express');
const AOIAnalyzer = require('./aoiAnalyzer');
const PrefixSpan = require('./prefixSpan');
const AnomalyDetector = require('./anomalyDetector');

function createApiRoutes(storage) {
  const router = express.Router();
  const aoiAnalyzer = new AOIAnalyzer();
  const prefixSpan = new PrefixSpan();

  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: Date.now(),
      influxdbConnected: storage.connected
    });
  });

  router.get('/data/range', async (req, res) => {
    try {
      const { start, end } = req.query;
      
      if (!start || !end) {
        return res.status(400).json({
          error: 'Missing required parameters: start and end timestamps'
        });
      }

      const startTime = parseInt(start);
      const endTime = parseInt(end);

      if (isNaN(startTime) || isNaN(endTime)) {
        return res.status(400).json({
          error: 'Invalid timestamp format'
        });
      }

      const data = await storage.queryRange(startTime, endTime);
      
      res.json({
        success: true,
        count: data.length,
        startTime,
        endTime,
        data
      });
    } catch (err) {
      console.error('Error querying data range:', err);
      res.status(500).json({
        error: err.message
      });
    }
  });

  router.get('/data/last', async (req, res) => {
    try {
      const { duration } = req.query;
      const durationMs = duration ? parseInt(duration) : 60000;

      if (isNaN(durationMs)) {
        return res.status(400).json({
          error: 'Invalid duration format'
        });
      }

      const data = await storage.queryLast(durationMs);
      
      res.json({
        success: true,
        count: data.length,
        durationMs,
        data
      });
    } catch (err) {
      console.error('Error querying last data:', err);
      res.status(500).json({
        error: err.message
      });
    }
  });

  router.post('/aoi/analyze', async (req, res) => {
    try {
      const { aois, timeRange, data } = req.body;

      if (!aois || !Array.isArray(aois) || aois.length === 0) {
        return res.status(400).json({
          error: 'Missing or invalid "aois" parameter'
        });
      }

      let dataPoints = data;

      if (!dataPoints && timeRange) {
        const { start, end } = timeRange;
        if (start && end) {
          dataPoints = await storage.queryRange(start, end);
        }
      }

      if (!dataPoints || !Array.isArray(dataPoints) || dataPoints.length === 0) {
        return res.status(400).json({
          error: 'No data available for analysis. Provide "data" array or valid "timeRange".'
        });
      }

      const results = aoiAnalyzer.analyze(dataPoints, aois);
      const scanPath = aoiAnalyzer.generateScanPath(dataPoints, aois);
      const transitionMatrix = aoiAnalyzer.calculateTransitionMatrix(dataPoints, aois);

      res.json({
        success: true,
        dataPointsCount: dataPoints.length,
        aoisCount: aois.length,
        aoiResults: results,
        scanPath,
        transitionMatrix
      });
    } catch (err) {
      console.error('Error in AOI analysis:', err);
      res.status(500).json({
        error: err.message
      });
    }
  });

  router.post('/aoi/analyze-range', async (req, res) => {
    try {
      const { aois, start, end } = req.body;

      if (!aois || !Array.isArray(aois) || aois.length === 0) {
        return res.status(400).json({
          error: 'Missing or invalid "aois" parameter'
        });
      }

      if (!start || !end) {
        return res.status(400).json({
          error: 'Missing required parameters: start and end'
        });
      }

      const startTime = parseInt(start);
      const endTime = parseInt(end);

      if (isNaN(startTime) || isNaN(endTime)) {
        return res.status(400).json({
          error: 'Invalid timestamp format'
        });
      }

      const dataPoints = await storage.queryRange(startTime, endTime);

      if (dataPoints.length === 0) {
        return res.json({
          success: true,
          dataPointsCount: 0,
          aoisCount: aois.length,
          aoiResults: {},
          scanPath: [],
          transitionMatrix: {},
          message: 'No data found in the specified time range'
        });
      }

      const results = aoiAnalyzer.analyze(dataPoints, aois);
      const scanPath = aoiAnalyzer.generateScanPath(dataPoints, aois);
      const transitionMatrix = aoiAnalyzer.calculateTransitionMatrix(dataPoints, aois);

      res.json({
        success: true,
        dataPointsCount: dataPoints.length,
        aoisCount: aois.length,
        startTime,
        endTime,
        aoiResults: results,
        scanPath,
        transitionMatrix
      });
    } catch (err) {
      console.error('Error in AOI range analysis:', err);
      res.status(500).json({
        error: err.message
      });
    }
  });

  router.post('/aoi/scanpath', async (req, res) => {
    try {
      const { aois, data, timeRange } = req.body;

      if (!aois || !Array.isArray(aois)) {
        return res.status(400).json({
          error: 'Missing or invalid "aois" parameter'
        });
      }

      let dataPoints = data;
      if (!dataPoints && timeRange) {
        dataPoints = await storage.queryRange(timeRange.start, timeRange.end);
      }

      if (!dataPoints || dataPoints.length === 0) {
        return res.status(400).json({
          error: 'No data available for scan path analysis'
        });
      }

      const scanPath = aoiAnalyzer.generateScanPath(dataPoints, aois);

      res.json({
        success: true,
        scanPath,
        transitions: scanPath.length - 1
      });
    } catch (err) {
      console.error('Error in scan path analysis:', err);
      res.status(500).json({
        error: err.message
      });
    }
  });

  router.post('/aoi/transitions', async (req, res) => {
    try {
      const { aois, data, timeRange } = req.body;

      if (!aois || !Array.isArray(aois)) {
        return res.status(400).json({
          error: 'Missing or invalid "aois" parameter'
        });
      }

      let dataPoints = data;
      if (!dataPoints && timeRange) {
        dataPoints = await storage.queryRange(timeRange.start, timeRange.end);
      }

      if (!dataPoints || dataPoints.length === 0) {
        return res.status(400).json({
          error: 'No data available for transition analysis'
        });
      }

      const transitionMatrix = aoiAnalyzer.calculateTransitionMatrix(dataPoints, aois);

      res.json({
        success: true,
        transitionMatrix,
        aois: aois.map(a => ({ id: a.id, name: a.name }))
      });
    } catch (err) {
      console.error('Error in transition analysis:', err);
      res.status(500).json({
        error: err.message
      });
    }
  });

  router.post('/sequence/mine', async (req, res) => {
    try {
      const { aois, data, timeRange, minSupport = 0.05, maxPatternLength = 10, gapThresholdMs = 5000 } = req.body;

      if (!aois || !Array.isArray(aois) || aois.length === 0) {
        return res.status(400).json({ error: 'Missing or invalid "aois" parameter' });
      }

      let dataPoints = data;
      if (!dataPoints && timeRange) {
        dataPoints = await storage.queryRange(timeRange.start, timeRange.end);
      }

      if (!dataPoints || !Array.isArray(dataPoints) || dataPoints.length === 0) {
        return res.status(400).json({ error: 'No data available for sequence mining' });
      }

      const scanPath = aoiAnalyzer.generateScanPath(dataPoints, aois);

      if (scanPath.length === 0) {
        return res.json({
          success: true,
          patterns: [],
          sankeyData: { nodes: [], links: [] },
          stats: { totalSequences: 0, patternCount: 0 },
          scanPath: []
        });
      }

      const miner = new PrefixSpan({
        minSupport,
        maxPatternLength,
        minPatternLength: 2
      });

      const sequences = miner.buildSequencesFromScanPath(scanPath, gapThresholdMs);
      const aoiMap = {};
      aois.forEach(a => { aoiMap[a.id] = a.name; });

      const result = miner.mine(sequences);
      const sankeyData = miner.generateSankeyData(result.patterns, aoiMap);

      res.json({
        success: true,
        patterns: result.patterns,
        sankeyData,
        stats: result.stats,
        scanPath,
        sequences: sequences.length
      });
    } catch (err) {
      console.error('Error in sequence mining:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/anomaly/detect', async (req, res) => {
    try {
      const { data, timeRange, sigmaThreshold = 3, windowSize = 300 } = req.body;

      let dataPoints = data;
      if (!dataPoints && timeRange) {
        dataPoints = await storage.queryRange(timeRange.start, timeRange.end);
      }

      if (!dataPoints || !Array.isArray(dataPoints) || dataPoints.length === 0) {
        return res.status(400).json({ error: 'No data available for anomaly detection' });
      }

      const detector = new AnomalyDetector({ sigmaThreshold, windowSize, cooldownMs: 0 });
      const anomalies = detector.batchDetect(dataPoints);

      res.json({
        success: true,
        anomalyCount: anomalies.length,
        anomalies,
        stats: detector.getStats()
      });
    } catch (err) {
      console.error('Error in anomaly detection:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/anomaly/stats', (req, res) => {
    if (global.anomalyDetector) {
      res.json({ success: true, stats: global.anomalyDetector.getStats() });
    } else {
      res.json({ success: true, stats: { isRunning: false } });
    }
  });

  router.get('/config', (req, res) => {
    res.json({
      success: true,
      config: {
        screen: {
          width: 1920,
          height: 1080
        },
        pupilMinDiameter: 0.2,
        sampleRate: 250,
        aggregationRate: 10,
        websocketPort: 8080
      }
    });
  });

  return router;
}

module.exports = createApiRoutes;
