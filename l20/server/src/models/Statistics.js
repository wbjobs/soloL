import mongoose from 'mongoose';

const backgroundUsageSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  backgroundType: { type: String, enum: ['image', 'video', 'blur', 'none'], required: true },
  backgroundUrl: String,
  durationMs: { type: Number, default: 0 },
  sessions: { type: Number, default: 0 }
}, { timestamps: true });

const gestureEventSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  gesture: { type: String, enum: ['fist', 'ok', 'victory'], required: true },
  backgroundTriggered: String,
  timestamp: { type: Date, default: Date.now }
});

const weeklyReportSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  weekStart: Date,
  weekEnd: Date,
  totalUsageMinutes: Number,
  backgroundBreakdown: [{
    type: String,
    durationMinutes: Number,
    sessions: Number
  }],
  gestureCounts: [{
    gesture: String,
    count: Number
  }],
  email: String,
  sentAt: Date
}, { timestamps: true });

export const BackgroundUsage = mongoose.model('BackgroundUsage', backgroundUsageSchema);
export const GestureEvent = mongoose.model('GestureEvent', gestureEventSchema);
export const WeeklyReport = mongoose.model('WeeklyReport', weeklyReportSchema);
