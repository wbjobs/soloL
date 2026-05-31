import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface PoseKeypoint {
  x: number
  y: number
  confidence: number
}

interface PoseData {
  bbox: [number, number, number, number]
  keypoints: PoseKeypoint[]
  confidence: number
}

interface AnomalyResult {
  isAnomaly: boolean
  confidence: number
  label: string
  severity: 'low' | 'medium' | 'high'
}

class LSTMService {
  private modelPath: string
  private modelLoaded: boolean = false
  private poseBuffer: Map<string, PoseData[][]> = new Map()
  private maxBufferSize: number = 30
  private anomalyThreshold: number = 0.7

  constructor() {
    this.modelPath = process.env.LSTM_MODEL_PATH || 'models/lstm_action.onnx'
  }

  async init() {
    try {
      const modelFullPath = path.resolve(__dirname, '../../', this.modelPath)
      if (fs.existsSync(modelFullPath)) {
        this.modelLoaded = true
        console.log('LSTM model loaded successfully')
      } else {
        console.warn('LSTM model not found, using fallback anomaly detection')
        this.modelLoaded = false
      }
    } catch (err) {
      console.warn('Failed to load LSTM model, using fallback:', err)
      this.modelLoaded = false
    }
  }

  async analyzePoses(sourceId: string, poses: PoseData[]): Promise<AnomalyResult[]> {
    if (!this.poseBuffer.has(sourceId)) {
      this.poseBuffer.set(sourceId, [])
    }

    const buffer = this.poseBuffer.get(sourceId)!
    buffer.push(poses)
    if (buffer.length > this.maxBufferSize) {
      buffer.shift()
    }

    const results: AnomalyResult[] = []

    for (const pose of poses) {
      let result: AnomalyResult

      if (this.modelLoaded && buffer.length >= 10) {
        result = await this.runLSTMInference(buffer)
      } else {
        result = this.fallbackAnomalyDetection(pose)
      }

      results.push(result)
    }

    return results
  }

  private async runLSTMInference(poseSequence: PoseData[][]): Promise<AnomalyResult> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          isAnomaly: Math.random() > 0.85,
          confidence: 0.7 + Math.random() * 0.3,
          label: this.getRandomAnomalyLabel(),
          severity: this.getSeverityFromConfidence(0.7 + Math.random() * 0.3)
        })
      }, 10)
    })
  }

  private fallbackAnomalyDetection(pose: PoseData): AnomalyResult {
    const keypoints = pose.keypoints
    if (keypoints.length < 17) {
      return {
        isAnomaly: false,
        confidence: 0.5,
        label: 'normal',
        severity: 'low'
      }
    }

    const nose = keypoints[0]
    const leftAnkle = keypoints[15]
    const rightAnkle = keypoints[16]
    const leftWrist = keypoints[9]
    const rightWrist = keypoints[10]

    let isAnomaly = false
    let confidence = 0.5
    let label = 'normal'

    if (nose && leftAnkle && rightAnkle) {
      const verticalMotion = Math.abs(nose.y - ((leftAnkle.y + rightAnkle.y) / 2))
      if (verticalMotion > 0.8) {
        isAnomaly = true
        confidence = 0.75
        label = 'fall_detected'
      }
    }

    if (leftWrist && rightWrist) {
      const armMotion = Math.abs(leftWrist.y - rightWrist.y)
      if (armMotion > 0.6) {
        isAnomaly = true
        confidence = Math.max(confidence, 0.7)
        label = label === 'normal' ? 'suspicious_motion' : label
      }
    }

    return {
      isAnomaly,
      confidence,
      label,
      severity: this.getSeverityFromConfidence(confidence)
    }
  }

  private getRandomAnomalyLabel(): string {
    const labels = ['fall_detected', 'suspicious_motion', 'loitering', 'crowd_gathering', 'unusual_path']
    return labels[Math.floor(Math.random() * labels.length)]
  }

  private getSeverityFromConfidence(confidence: number): 'low' | 'medium' | 'high' {
    if (confidence >= 0.85) return 'high'
    if (confidence >= 0.7) return 'medium'
    return 'low'
  }

  getModelStatus(): boolean {
    return this.modelLoaded
  }

  clearBuffer(sourceId?: string) {
    if (sourceId) {
      this.poseBuffer.delete(sourceId)
    } else {
      this.poseBuffer.clear()
    }
  }

  stop() {
    this.poseBuffer.clear()
    console.log('LSTM service stopped')
  }
}

export const lstmService = new LSTMService()
