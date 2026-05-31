import { Router } from 'express'
import DefenseRegion from '../models/DefenseRegion.js'

const router = Router()

router.post('/', async (req, res): Promise<void> => {
  try {
    const region = new DefenseRegion(req.body)
    await region.save()
    res.status(201).json({ success: true, data: region })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create defense region' })
  }
})

router.put('/:id', async (req, res): Promise<void> => {
  try {
    const region = await DefenseRegion.findByIdAndUpdate(req.params.id, req.body, { new: true })
    if (!region) {
      res.status(404).json({ success: false, error: 'Defense region not found' })
      return
    }
    res.json({ success: true, data: region })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update defense region' })
  }
})

router.delete('/:id', async (req, res): Promise<void> => {
  try {
    const region = await DefenseRegion.findByIdAndDelete(req.params.id)
    if (!region) {
      res.status(404).json({ success: false, error: 'Defense region not found' })
      return
    }
    res.json({ success: true, data: region })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete defense region' })
  }
})

router.get('/', async (req, res): Promise<void> => {
  try {
    const { sourceId } = req.query
    const filter: any = {}
    if (sourceId) filter.sourceId = sourceId
    const regions = await DefenseRegion.find(filter).sort({ createdAt: -1 })
    res.json({ success: true, data: regions })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to list defense regions' })
  }
})

export default router
