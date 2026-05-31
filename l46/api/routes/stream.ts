import { Router, type Request, type Response } from 'express'
import type {
  KafkaConfig,
  StreamConfig,
  StreamMessage,
  StreamResult,
} from '../../shared/types.js'
import {
  startStreamProcessing,
  stopStreamProcessing,
  getStreamStatus,
  getRecentResults,
  getAllStreamStatuses,
  StreamDetector,
} from '../lib/stream.js'

const router = Router()

router.post('/start', async (req: Request, res: Response): Promise<void> => {
  try {
    const { kafkaConfig, streamConfig, outputConfig } = req.body as {
      kafkaConfig: KafkaConfig
      streamConfig: StreamConfig
      outputConfig?: {
        topic?: string
        webhook?: string
      }
    }

    if (!kafkaConfig || !streamConfig) {
      res.status(400).json({
        success: false,
        error: 'Missing required parameters: kafkaConfig and streamConfig',
      })
      return
    }

    const outputCfg = {
      kafkaTopic: outputConfig?.topic,
      webhookUrl: outputConfig?.webhook,
      logToConsole: true,
    }

    const streamId = await startStreamProcessing(
      kafkaConfig,
      streamConfig,
      outputCfg
    )

    res.status(200).json({
      success: true,
      streamId,
      message: 'Stream processing started successfully',
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.post('/stop/:streamId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { streamId } = req.params

    const stopped = await stopStreamProcessing(streamId)

    if (!stopped) {
      res.status(404).json({
        success: false,
        error: 'Stream not found',
      })
      return
    }

    res.status(200).json({
      success: true,
      message: 'Stream processing stopped successfully',
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.get('/status/:streamId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { streamId } = req.params
    const status = getStreamStatus(streamId)

    if (!status) {
      res.status(404).json({
        success: false,
        error: 'Stream not found',
      })
      return
    }

    res.status(200).json({
      success: true,
      status: {
        isRunning: status.status === 'running',
        processedCount: status.messageCount,
        anomalyCount: status.resultCount,
        lastResult: status.lastDetectionTime,
      },
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.get('/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const statuses = getAllStreamStatuses()
    const streamIds = statuses.map(s => s.streamId)

    res.status(200).json({
      success: true,
      streams: streamIds,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.get('/results/:streamId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { streamId } = req.params
    const { limit } = req.query as { limit?: string }

    const resultLimit = limit ? parseInt(limit, 10) : 100
    const results = getRecentResults(streamId, resultLimit)

    if (!results) {
      res.status(404).json({
        success: false,
        error: 'Stream not found',
      })
      return
    }

    res.status(200).json({
      success: true,
      data: results,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.post('/test', async (req: Request, res: Response): Promise<void> => {
  try {
    const { messages, modelId, windowSize } = req.body as {
      messages: StreamMessage[]
      modelId: string
      windowSize: number
    }

    if (!messages || !modelId || !windowSize) {
      res.status(400).json({
        success: false,
        error: 'Missing required parameters: messages, modelId, and windowSize',
      })
      return
    }

    const detector = new StreamDetector(
      modelId,
      windowSize,
      Math.floor(windowSize / 2),
      2,
      false,
      false,
      10
    )

    await detector.loadModel()

    const results: StreamResult[] = []

    for (const message of messages) {
      const result = detector.addDataPoint(message)
      if (result) {
        results.push(result)
      }
    }

    res.status(200).json({
      success: true,
      data: results,
      message: `Processed ${messages.length} messages, generated ${results.length} detection results`,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

export default router
