import { Router, type Request, type Response } from 'express'
import Gradient from '../models/Gradient.js'

const router = Router()

const modelState: {
  version: string
  gradients: Map<string, { data: number[]; shape: number[]; weight: number }>
  totalSamples: number
} = {
  version: 'v0.1.0',
  gradients: new Map(),
  totalSamples: 0
}

function gaussianRandom(): number {
  const u1 = Math.random()
  const u2 = Math.random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

function clipGradient(data: number[], maxNorm: number = 1.0): { data: number[]; norm: number } {
  const norm = Math.sqrt(data.reduce((sum, val) => sum + val * val, 0))
  if (norm > maxNorm) {
    const scale = maxNorm / norm
    return { data: data.map(d => d * scale), norm: maxNorm }
  }
  return { data, norm }
}

function addDifferentialPrivacy(
  data: number[],
  epsilon: number,
  delta: number,
  sensitivity: number = 1.0
): number[] {
  const sigma = sensitivity * Math.sqrt(2 * Math.log(1.25 / delta)) / epsilon
  return data.map(d => d + gaussianRandom() * sigma)
}

function aggregateGradients(
  layerName: string,
  newData: number[],
  shape: number[],
  weight: number
): void {
  const existing = modelState.gradients.get(layerName)
  if (!existing) {
    modelState.gradients.set(layerName, { data: newData.map(d => d * weight), shape, weight })
  } else {
    const totalWeight = existing.weight + weight
    existing.data = existing.data.map((d, i) => d + newData[i] * weight)
    existing.weight = totalWeight
  }
}

router.post('/gradients', async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientId, sourceId, modelVersion, gradients, numSamples } = req.body

    if (!clientId || !modelVersion || !gradients || !Array.isArray(gradients) || numSamples === undefined) {
      res.status(400).json({ success: false, error: 'clientId, modelVersion, gradients array, and numSamples are required' })
      return
    }

    const epsilon = 1.0
    const delta = 1e-5
    const sensitivity = 1.0

    const processedGradients = gradients.map((grad: any) => {
      const { data, norm } = clipGradient(grad.data, 1.0)
      const noisyData = addDifferentialPrivacy(data, epsilon, delta, sensitivity)
      return {
        layerName: grad.layerName,
        shape: grad.shape,
        data: noisyData,
        norm
      }
    })

    const weight = numSamples / (numSamples + modelState.totalSamples + 1)

    for (const grad of processedGradients) {
      aggregateGradients(grad.layerName, grad.data, grad.shape, weight)
    }
    modelState.totalSamples += numSamples

    const gradient = new Gradient({
      clientId,
      sourceId,
      modelVersion,
      gradients: processedGradients,
      numSamples,
      epsilon,
      delta,
      aggregated: false
    })

    await gradient.save()

    res.json({
      success: true,
      acknowledged: true,
      serverModelVersion: modelState.version
    })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to upload gradients' })
  }
})

router.get('/model/latest', async (req: Request, res: Response): Promise<void> => {
  try {
    const modelBuffer = Buffer.from(JSON.stringify({
      version: modelState.version,
      layers: Array.from(modelState.gradients.entries()).map(([name, g]) => ({
        layerName: name,
        shape: g.shape,
        data: g.data.map(d => d / g.weight)
      }))
    }))

    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="model-${modelState.version}.onnx"`)
    res.send(modelBuffer)
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to download model' })
  }
})

router.get('/model/version', async (req: Request, res: Response): Promise<void> => {
  try {
    res.json({
      success: true,
      version: modelState.version,
      totalSamples: modelState.totalSamples,
      numLayers: modelState.gradients.size
    })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get model version' })
  }
})

export default router
