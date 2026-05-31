import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import { UserConfig } from './models/UserConfig.js';
import { setupSocketHandlers } from './socket/handlers.js';
import { BackgroundUsage, GestureEvent, WeeklyReport } from './models/Statistics.js';
import { recordBackgroundUsage, recordGestureEvent, generateWeeklyReport } from './services/statistics.js';
import { sendWeeklyReportEmail } from './services/email.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const io = new Server(server, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
});

const rooms = new Map();

app.get('/api/config/:userId', async (req, res) => {
  try {
    const config = await UserConfig.findOne({ userId: req.params.userId });
    res.json(config || { userId: req.params.userId, background: null, avatar: 'default' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/config/:userId', async (req, res) => {
  try {
    const config = await UserConfig.findOneAndUpdate(
      { userId: req.params.userId },
      req.body,
      { upsert: true, new: true }
    );
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

setupSocketHandlers(io, rooms);

app.post('/api/stats/:userId/background', async (req, res) => {
  try {
    const { backgroundType, backgroundUrl, durationMs } = req.body;
    await recordBackgroundUsage(req.params.userId, backgroundType, backgroundUrl, durationMs);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stats/:userId/gesture', async (req, res) => {
  try {
    const { gesture, backgroundTriggered } = req.body;
    await recordGestureEvent(req.params.userId, gesture, backgroundTriggered);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats/:userId/summary', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const since = new Date();
    since.setDate(since.getDate() - Number(days));

    const bgStats = await BackgroundUsage.find({
      userId: req.params.userId,
      updatedAt: { $gte: since }
    });

    const gestureStats = await GestureEvent.find({
      userId: req.params.userId,
      timestamp: { $gte: since }
    });

    const gestureCounts = {};
    gestureStats.forEach(g => {
      gestureCounts[g.gesture] = (gestureCounts[g.gesture] || 0) + 1;
    });

    res.json({ backgroundUsage: bgStats, gestureCounts, periodDays: Number(days) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stats/:userId/weekly-report', async (req, res) => {
  try {
    const { email } = req.body;
    const report = await generateWeeklyReport(req.params.userId);

    if (email) {
      const result = await sendWeeklyReportEmail(email, report);
      await WeeklyReport.findOneAndUpdate(
        { userId: req.params.userId },
        { email, sentAt: new Date() }
      );
      res.json({ report, emailResult: result });
    } else {
      res.json({ report });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
