import { Router } from 'express'
import PushSubscription from '../models/PushSubscription.js'

const router = Router()

router.post('/subscribe', async (req, res): Promise<void> => {
  try {
    const { sourceId, subscription } = req.body
    if (!sourceId || !subscription) {
      res.status(400).json({ success: false, error: 'sourceId and subscription are required' })
      return
    }
    const existing = await PushSubscription.findOne({ sourceId, 'subscription.endpoint': subscription.endpoint })
    if (existing) {
      res.json({ success: true, data: existing })
      return
    }
    const sub = new PushSubscription({ sourceId, subscription })
    await sub.save()
    res.status(201).json({ success: true, data: sub })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to save push subscription' })
  }
})

export default router
