import cron from 'node-cron'
import { db } from './database'

class SchedulerService {
  private tasks: Map<string, cron.ScheduledTask> = new Map()

  start() {
    this.scheduleWeeklyCleanup()
  }

  private scheduleWeeklyCleanup() {
    const task = cron.schedule('0 0 3 * * 0', async () => {
      console.log('Starting weekly database maintenance...')

      const maxRecords = parseInt(db.getSetting('maxRecords') || '10000', 10)
      const deleted = db.cleanOldRecords(maxRecords)
      console.log(`Deleted ${deleted} old records`)

      const vacuumed = db.vacuum()
      console.log(`Database vacuum ${vacuumed ? 'completed' : 'failed'}`)
    }, {
      timezone: 'Asia/Shanghai'
    })

    this.tasks.set('weeklyCleanup', task)
  }

  stop() {
    this.tasks.forEach(task => task.stop())
    this.tasks.clear()
  }

  runCleanupNow() {
    const maxRecords = parseInt(db.getSetting('maxRecords') || '10000', 10)
    const deleted = db.cleanOldRecords(maxRecords)
    db.vacuum()
    return deleted
  }
}

export const scheduler = new SchedulerService()
