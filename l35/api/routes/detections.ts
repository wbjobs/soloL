import { Router, type Request, type Response } from 'express'
import webpush from 'web-push'
import Detection from '../models/Detection.js'
import DefenseRegion from '../models/DefenseRegion.js'
import Alert from '../models/Alert.js'
import PushSubscription from '../models/PushSubscription.js'
import { influxDB } from '../services/index.js'

const router = Router()

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sourceId, timestamp, detections, count, regions } = req.body

    const detection = new Detection({ sourceId, detections, count, regions })
    await detection.save()

    await influxDB.writeDetection({
      sourceId,
      timestamp: timestamp || Date.now(),
      detections,
      count,
      regions: regions || []
    })

    if (regions && regions.length > 0) {
      const breachedRegions = regions.filter((r: any) => r.breached)
      for (const breached of breachedRegions) {
        const region = await DefenseRegion.findById(breached.regionId)
        if (region) {
          const alert = new Alert({
            regionId: breached.regionId,
            sourceId,
            type: breached.insideCount > (region.rules?.maxPeople || Infinity) ? 'overcrowd' : 'breach',
            details: `Region ${region.name}: ${breached.insideCount} people detected`
          })
          await alert.save()

          const subscriptions = await PushSubscription.find({ sourceId })
          const payload = JSON.stringify({
            title: 'Defense Region Alert',
            body: alert.details,
            type: alert.type,
            regionId: breached.regionId,
            sourceId
          })
          for (const sub of subscriptions) {
            try {
              await webpush.sendNotification(sub.subscription, payload)
            } catch (err) {
              if ((err as any).statusCode === 410) {
                await PushSubscription.findByIdAndDelete(sub._id)
              }
            }
          }
        }
      }
    }

    res.status(201).json({ success: true, data: detection })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create detection' })
  }
})

router.get('/heatmap/:sourceId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sourceId } = req.params
    const { start, end, resolution } = req.query
    const resNum = parseInt(resolution as string) || 20
    const startDate = new Date(start as string)
    const endDate = new Date(end as string)

    const heatmap = await influxDB.queryHeatmap(sourceId, startDate, endDate, resNum)
    res.json({ success: true, data: heatmap })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to generate heatmap' })
  }
})

export default router
