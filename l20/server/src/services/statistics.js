import { BackgroundUsage, GestureEvent, WeeklyReport } from '../models/Statistics.js';

export async function recordBackgroundUsage(userId, backgroundType, backgroundUrl, durationMs) {
  const filter = {
    userId,
    backgroundType,
    backgroundUrl: backgroundUrl || { $exists: false }
  };

  await BackgroundUsage.findOneAndUpdate(
    filter,
    {
      $inc: { durationMs, sessions: 1 },
      $setOnInsert: { userId, backgroundType, backgroundUrl }
    },
    { upsert: true, new: true }
  );
}

export async function recordGestureEvent(userId, gesture, backgroundTriggered) {
  await GestureEvent.create({
    userId,
    gesture,
    backgroundTriggered
  });
}

export async function generateWeeklyReport(userId) {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const backgroundData = await BackgroundUsage.aggregate([
    {
      $match: {
        userId,
        updatedAt: { $gte: weekStart, $lt: weekEnd }
      }
    },
    {
      $group: {
        _id: '$backgroundType',
        totalDurationMs: { $sum: '$durationMs' },
        totalSessions: { $sum: '$sessions' }
      }
    }
  ]);

  const gestureData = await GestureEvent.aggregate([
    {
      $match: {
        userId,
        timestamp: { $gte: weekStart, $lt: weekEnd }
      }
    },
    {
      $group: {
        _id: '$gesture',
        count: { $sum: 1 }
      }
    }
  ]);

  const totalUsageMs = backgroundData.reduce((sum, b) => sum + b.totalDurationMs, 0);
  const totalUsageMinutes = Math.round(totalUsageMs / 60000);

  const backgroundBreakdown = backgroundData.map(b => ({
    type: b._id,
    durationMinutes: Math.round(b.totalDurationMs / 60000),
    sessions: b.totalSessions
  }));

  const gestureCounts = gestureData.map(g => ({
    gesture: g._id,
    count: g.count
  }));

  const report = await WeeklyReport.findOneAndUpdate(
    { userId },
    {
      weekStart,
      weekEnd,
      totalUsageMinutes,
      backgroundBreakdown,
      gestureCounts
    },
    { upsert: true, new: true }
  );

  return report;
}

export function formatReportEmail(report) {
  const bgRows = report.backgroundBreakdown.map(b =>
    `  ${b.type}: ${b.durationMinutes}分钟 (${b.sessions}次)`
  ).join('\n');

  const gestureRows = report.gestureCounts.map(g =>
    `  ${g.gesture}: ${g.count}次`
  ).join('\n');

  return `
AI Avatar 使用周报
==================
统计周期: ${report.weekStart.toLocaleDateString()} - ${report.weekEnd.toLocaleDateString()}

总使用时长: ${report.totalUsageMinutes} 分钟

背景使用分布:
${bgRows || '  暂无数据'}

手势触发统计:
${gestureRows || '  暂无数据'}

---
此邮件由 AI Avatar 系统自动生成
  `.trim();
}
