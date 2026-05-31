import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { initSchema, pool } from './db/init.js';
import { ensureBuckets } from './minio.js';
import { startMqtt } from './mqtt.js';
import { createSignalingServer } from './routes/signaling.js';
import equipmentRoutes from './routes/equipment.js';
import inspectionRoutes from './routes/inspection.js';
import defectRoutes from './routes/defect.js';
import sensorRoutes from './routes/sensor.js';
import reportRoutes from './routes/report.js';
import uploadRoutes from './routes/upload.js';
import speechRoutes from './routes/speech.js';
import spatialAnchorRoutes from './routes/spatialAnchors.js';
import pathPlanningRoutes from './routes/pathPlanning.js';

dotenv.config();

const app = express();
const server = createServer(app);
const PORT = process.env.SERVER_PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.use('/api/equipment', equipmentRoutes);
app.use('/api/inspections', inspectionRoutes);
app.use('/api/defects', defectRoutes);
app.use('/api/sensor', sensorRoutes);
app.use('/api/report', reportRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/speech', speechRoutes);
app.use('/api/spatial-anchors', spatialAnchorRoutes);
app.use('/api/path-planning', pathPlanningRoutes);

app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  res.status(statusCode).json({ error: message });
});

async function start() {
  try {
    console.log('Initializing database schema...');
    await initSchema();

    console.log('Ensuring MinIO buckets...');
    await ensureBuckets();

    console.log('Starting MQTT client...');
    startMqtt();

    createSignalingServer(server);

    server.listen(PORT, () => {
      console.log(`MR Inspection Backend running on http://localhost:${PORT}`);
      console.log(`Signaling WebSocket available at ws://localhost:${PORT}/ws/signaling`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await pool.end();
  process.exit(0);
});

start();
