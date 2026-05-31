import { Worker } from 'worker_threads'
import path from 'path'
import { db } from './database'

type OcrCallback = (id: number, text: string | null, error?: string) => void

interface OcrTask {
  id: number
  imagePath: string
}

class OcrService {
  private queue: OcrTask[] = []
  private activeWorkers: Set<Worker> = new Set()
  private maxWorkers: number = 2
  private callback: OcrCallback | null = null

  setCallback(callback: OcrCallback) {
    this.callback = callback
  }

  async recognize(id: number, imagePath: string) {
    this.queue.push({ id, imagePath })
    this.processQueue()
  }

  private processQueue() {
    if (this.activeWorkers.size >= this.maxWorkers || this.queue.length === 0) return

    const task = this.queue.shift()
    if (!task) return

    const workerPath = path.join(__dirname, 'ocrWorker.js')
    
    const worker = new Worker(workerPath, {
      workerData: { task }
    })

    this.activeWorkers.add(worker)

    worker.on('message', (result: { success: boolean; id: number; text?: string; error?: string }) => {
      if (result.success && result.text) {
        db.updateOcrText(result.id, result.text)
        if (this.callback) {
          this.callback(result.id, result.text)
        }
      } else if (this.callback) {
        this.callback(result.id, null, result.error)
      }
    })

    worker.on('error', (error) => {
      console.error('OCR Worker error:', error)
      if (this.callback) {
        this.callback(task.id, null, String(error))
      }
    })

    worker.on('exit', () => {
      this.activeWorkers.delete(worker)
      this.processQueue()
    })
  }

  async terminate() {
    for (const worker of this.activeWorkers) {
      worker.terminate()
    }
    this.activeWorkers.clear()
    this.queue = []
  }
}

export const ocrService = new OcrService()
