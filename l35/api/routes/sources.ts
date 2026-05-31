import { Router } from 'express'
import multer from 'multer'
import VideoSource from '../models/VideoSource.js'
import { streamProxy } from '../services/StreamProxyService.js'

const router = Router()
const upload = multer({ dest: 'uploads/' })

router.post('/file', upload.single('video'), async (req, res): Promise<void> => {
  try {
    const file = req.file as Express.Multer.File | undefined
    if (!file) {
      res.status(400).json({ success: false, error: 'No file uploaded' })
      return
    }
    const source = new VideoSource({
      name: req.body.name || file.originalname,
      type: 'file',
      url: file.path,
      status: 'connecting'
    })
    await source.save()
    res.status(201).json({ success: true, data: source })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create video source' })
  }
})

router.post('/rtsp', async (req, res): Promise<void> => {
  try {
    const { name, url } = req.body
    if (!name || !url) {
      res.status(400).json({ success: false, error: 'Name and url are required' })
      return
    }
    const source = new VideoSource({
      name,
      type: 'rtsp',
      url,
      status: 'connecting'
    })
    await source.save()
    streamProxy.startStream(source.id, source.url!).catch(() => {})
    res.status(201).json({ success: true, data: source })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create video source' })
  }
})

router.get('/', async (req, res): Promise<void> => {
  try {
    const sources = await VideoSource.find().sort({ createdAt: -1 })
    res.json({ success: true, data: sources })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to list video sources' })
  }
})

router.delete('/:id', async (req, res): Promise<void> => {
  try {
    const source = await VideoSource.findByIdAndDelete(req.params.id)
    if (!source) {
      res.status(404).json({ success: false, error: 'Video source not found' })
      return
    }
    streamProxy.stopStream(source.id)
    res.json({ success: true, data: source })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete video source' })
  }
})

router.get('/:id/keyframes', async (req, res): Promise<void> => {
  try {
    const { id } = req.params
    const count = parseInt(req.query.count as string) || 5
    const keyframes = streamProxy.getLatestKeyframes(id, count)
    const response = {
      keyframes: keyframes.map(kf => ({
        timestamp: kf.timestamp,
        size: kf.size,
        data: kf.data.toString('base64')
      }))
    }
    res.json({ success: true, data: response })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get keyframes' })
  }
})

export default router
