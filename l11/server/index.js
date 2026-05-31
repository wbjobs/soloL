const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const analysesRoutes = require('./routes/analyses');
const resultConsumer = require('./services/resultConsumer');
const taskQueue = require('./services/taskQueue');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const uploadDir = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
app.use('/uploads', express.static(uploadDir));

app.get('/api/health', async (req, res) => {
  const queueStats = await taskQueue.getQueueLength().catch(() => 0);
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    queue_length: queueStats,
    redis_available: queueStats !== null,
  });
});

app.use('/api/analyses', analysesRoutes);

async function startServices() {
  try {
    await taskQueue.initialize();
    await resultConsumer.start();
    console.log('✅ All background services started');
  } catch (err) {
    console.warn('⚠️  Could not start background services:', err.message);
    console.warn('⚠️  Make sure Redis is running for task queue functionality');
  }
}

startServices();

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  resultConsumer.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  resultConsumer.stop();
  process.exit(0);
});

app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  if (err.message.includes('Only MIDI files')) {
    return res.status(400).json({ error: err.message });
  }
  
  if (err.message.includes('too large')) {
    return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
  }
  
  res.status(500).json({ 
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message 
  });
});

app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🎵 MIDI Music Analyzer Server                          ║
║                                                          ║
║   Port:      ${PORT}                                       ║
║   Environment: ${process.env.NODE_ENV || 'development'}                 ║
║   Python:    ${process.env.PYTHON_PATH || 'python'}                     ║
║                                                          ║
║   API Health: http://localhost:${PORT}/api/health           ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `);
});
