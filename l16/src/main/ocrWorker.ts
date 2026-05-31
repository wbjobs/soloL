import { parentPort, workerData } from 'worker_threads'
import Tesseract from 'tesseract.js'

interface OcrTask {
  id: number
  imagePath: string
}

async function runOcr(imagePath: string): Promise<string> {
  const worker = await Tesseract.createWorker('eng+chi_sim')
  try {
    const result = await worker.recognize(imagePath)
    return result.data.text.trim()
  } finally {
    await worker.terminate()
  }
}

async function processTask(task: OcrTask) {
  try {
    const text = await runOcr(task.imagePath)
    parentPort?.postMessage({
      success: true,
      id: task.id,
      text
    })
  } catch (error) {
    parentPort?.postMessage({
      success: false,
      id: task.id,
      error: String(error)
    })
  }
}

if (workerData && workerData.task) {
  processTask(workerData.task)
}

parentPort?.on('message', (task: OcrTask) => {
  processTask(task)
})
