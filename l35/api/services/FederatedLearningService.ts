import Annotation from '../models/Annotation.js'

interface GradientData {
  modelVersion: string
  weights: number[]
  clientId: string
  sampleCount: number
}

interface AggregatedWeights {
  [key: string]: number[]
}

class FederatedLearningService {
  private gradientBuffer: Map<string, GradientData[]> = new Map()
  private currentModelVersion: string
  private aggregationInterval: number
  private aggregationTimer: NodeJS.Timeout | null = null
  private aggregatedWeights: AggregatedWeights = {}

  constructor() {
    this.currentModelVersion = process.env.FEDERATED_MODEL_VERSION || 'v1.0'
    this.aggregationInterval = parseInt(process.env.FEDERATED_AGGREGATION_INTERVAL || '3600000')
  }

  init() {
    this.startAggregationCycle()
    console.log('Federated Learning service initialized')
  }

  private startAggregationCycle() {
    this.aggregationTimer = setInterval(() => {
      this.aggregateGradients()
    }, this.aggregationInterval)
  }

  async uploadGradients(gradientData: GradientData): Promise<boolean> {
    try {
      if (gradientData.modelVersion !== this.currentModelVersion) {
        console.warn(`Gradient version mismatch: expected ${this.currentModelVersion}, got ${gradientData.modelVersion}`)
        return false
      }

      const epsilon = parseFloat(process.env.DP_EPSILON || '1.0')
      const delta = parseFloat(process.env.DP_DELTA || '0.00001')
      const clipNorm = parseFloat(process.env.GRADIENT_CLIP_NORM || '1.0')

      const clippedWeights = this.clipGradients(gradientData.weights, clipNorm)
      const noisyWeights = this.addDifferentialPrivacyNoise(clippedWeights, epsilon, delta)

      if (!this.gradientBuffer.has(gradientData.clientId)) {
        this.gradientBuffer.set(gradientData.clientId, [])
      }
      this.gradientBuffer.get(gradientData.clientId)!.push({
        ...gradientData,
        weights: noisyWeights
      })

      return true
    } catch (err) {
      console.error('Failed to upload gradients:', err)
      return false
    }
  }

  private clipGradients(weights: number[], clipNorm: number): number[] {
    const norm = Math.sqrt(weights.reduce((sum, w) => sum + w * w, 0))
    if (norm > clipNorm) {
      const scale = clipNorm / norm
      return weights.map(w => w * scale)
    }
    return weights
  }

  private addDifferentialPrivacyNoise(weights: number[], epsilon: number, delta: number): number[] {
    const sigma = Math.sqrt(2 * Math.log(1.25 / delta)) / epsilon
    return weights.map(w => w + this.gaussianRandom(0, sigma))
  }

  private gaussianRandom(mean: number, sigma: number): number {
    const u1 = Math.random()
    const u2 = Math.random()
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    return mean + sigma * z
  }

  private aggregateGradients() {
    const allGradients: GradientData[] = []
    this.gradientBuffer.forEach(clientGradients => {
      allGradients.push(...clientGradients)
    })

    if (allGradients.length === 0) return

    const totalSamples = allGradients.reduce((sum, g) => sum + g.sampleCount, 0)
    const weightSize = allGradients[0].weights.length
    const averagedWeights = new Array(weightSize).fill(0)

    for (const gradient of allGradients) {
      const weight = gradient.sampleCount / totalSamples
      for (let i = 0; i < weightSize; i++) {
        averagedWeights[i] += gradient.weights[i] * weight
      }
    }

    this.aggregatedWeights[this.currentModelVersion] = averagedWeights
    this.gradientBuffer.clear()

    console.log(`Aggregated ${allGradients.length} gradient updates for model ${this.currentModelVersion}`)
  }

  async triggerFederatedLearning(): Promise<void> {
    const committedAnnotations = await Annotation.find({ status: 'committed' })
    if (committedAnnotations.length > 0) {
      this.aggregateGradients()
      console.log(`Federated learning triggered with ${committedAnnotations.length} committed annotations`)
    }
  }

  getModelVersion(): string {
    return this.currentModelVersion
  }

  getAggregatedWeights(version: string): number[] | null {
    return this.aggregatedWeights[version] || null
  }

  stop() {
    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer)
      this.aggregationTimer = null
    }
    console.log('Federated Learning service stopped')
  }
}

export const federatedLearning = new FederatedLearningService()
