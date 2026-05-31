import { Router, type Request, type Response } from 'express'
import webpush from 'web-push'
import PushSubscription from '../models/PushSubscription.js'

const router = Router()

const ACTIONS = ['fall', 'chasing', 'running', 'normal']

function extractFeatures(keypoints: number[][]): number[] {
  const features: number[] = []
  for (const kp of keypoints) {
    features.push(kp[0], kp[1], kp[2])
  }
  return features
}

function softmax(logits: number[]): number[] {
  const maxLogit = Math.max(...logits)
  const expLogits = logits.map(l => Math.exp(l - maxLogit))
  const sumExp = expLogits.reduce((a, b) => a + b, 0)
  return expLogits.map(e => e / sumExp)
}

function simulateLSTMInference(frames: { frameIndex: number; keypoints: number[][] }[]): {
  actions: { frameIndex: number; action: string; confidence: number }[]
  anomalies: { frameIndex: number; action: string; confidence: number }[]
} {
  const actions: { frameIndex: number; action: string; confidence: number }[] = []
  const anomalies: { frameIndex: number; action: string; confidence: number }[] = []

  for (const frame of frames) {
    const features = extractFeatures(frame.keypoints)
    const seed = features.reduce((a, b) => a + b, 0) * frame.frameIndex
    const random = Math.abs(Math.sin(seed)) * 0.6 + 0.2

    const logits = ACTIONS.map((_, i) => {
      const noise = Math.abs(Math.sin(seed + i * 1.5)) * 0.5
      return random * (i === 3 ? 1.5 : 1) + noise
    })

    const probs = softmax(logits)
    const maxIdx = probs.indexOf(Math.max(...probs))
    const action = ACTIONS[maxIdx]
    const confidence = probs[maxIdx]

    actions.push({
      frameIndex: frame.frameIndex,
      action,
      confidence
    })

    if (confidence > 0.7 && action !== 'normal') {
      anomalies.push({ frameIndex: frame.frameIndex, action, confidence })
    }
  }

  return { actions, anomalies }
}

router.post('/analyze', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sourceId, frames } = req.body

    if (!sourceId || !frames || !Array.isArray(frames)) {
      res.status(400).json({ success: false, error: 'sourceId and frames array are required' })
      return
    }

    const result = simulateLSTMInference(frames)

    if (result.anomalies.length > 0) {
      const subscriptions = await PushSubscription.find({ sourceId })
      const anomalySummary = result.anomalies
        .slice(0, 3)
        .map(a => `${a.action} (${(a.confidence * 100).toFixed(1)}%)`)
        .join(', ')

      const payload = JSON.stringify({
        title: 'Behavior Anomaly Detected',
        body: `Detected ${result.anomalies.length} anomalies: ${anomalySummary}`,
        type: 'behavior-anomaly',
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

    res.json({ success: true, data: result })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to analyze behavior' })
  }
})

export default router
