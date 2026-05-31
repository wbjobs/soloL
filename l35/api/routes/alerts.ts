import { Router } from 'express'
import Alert from '../models/Alert.js'

const router = Router()

router.get('/', async (req, res): Promise<void> => {
  try {
    const { sourceId, unread } = req.query
    const filter: any = {}
    if (sourceId) filter.sourceId = sourceId
    if (unread === 'true') filter.read = false
    const alerts = await Alert.find(filter).sort({ timestamp: -1 })
    res.json({ success: true, data: alerts })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to list alerts' })
  }
})

router.put('/:id/read', async (req, res): Promise<void> => {
  try {
    const alert = await Alert.findByIdAndUpdate(req.params.id, { read: true }, { new: true })
    if (!alert) {
      res.status(404).json({ success: false, error: 'Alert not found' })
      return
    }
    res.json({ success: true, data: alert })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to mark alert as read' })
  }
})

export default router
