import { Router, type Request, type Response } from 'express'
import Annotation from '../models/Annotation.js'

const router = Router()

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sourceId } = req.query
    const query: any = {}
    if (sourceId) query.sourceId = sourceId

    const annotations = await Annotation.find(query).sort({ timestamp: -1 })
    res.json({ success: true, data: annotations })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch annotations' })
  }
})

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sourceId, annotatorId, timestamp, frameData, detections } = req.body

    if (!sourceId || !annotatorId || !timestamp || !frameData) {
      res.status(400).json({ success: false, error: 'sourceId, annotatorId, timestamp, and frameData are required' })
      return
    }

    const annotation = new Annotation({
      sourceId,
      annotatorId,
      timestamp,
      frameData,
      detections: detections || [],
      status: 'draft',
      version: 1
    })

    await annotation.save()
    res.status(201).json({ success: true, data: annotation })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create annotation' })
  }
})

router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const { detections, version, status, frameData } = req.body

    const existing = await Annotation.findById(id)
    if (!existing) {
      res.status(404).json({ success: false, error: 'Annotation not found' })
      return
    }

    if (version !== undefined && existing.version !== version) {
      res.status(409).json({ success: false, error: 'Version conflict' })
      return
    }

    const updateData: any = {}
    if (detections !== undefined) updateData.detections = detections
    if (status !== undefined) updateData.status = status
    if (frameData !== undefined) updateData.frameData = frameData
    updateData.version = (existing.version || 1) + 1

    const updated = await Annotation.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    )

    res.json({ success: true, data: updated })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update annotation' })
  }
})

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const deleted = await Annotation.findByIdAndDelete(id)

    if (!deleted) {
      res.status(404).json({ success: false, error: 'Annotation not found' })
      return
    }

    res.json({ success: true, message: 'Annotation deleted' })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete annotation' })
  }
})

router.post('/:id/commit', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params

    const annotation = await Annotation.findById(id)
    if (!annotation) {
      res.status(404).json({ success: false, error: 'Annotation not found' })
      return
    }

    annotation.status = 'committed'
    annotation.version = (annotation.version || 1) + 1
    await annotation.save()

    res.json({ success: true, data: annotation })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to commit annotation' })
  }
})

export default router
