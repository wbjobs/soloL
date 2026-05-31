import { Router, type Request, type Response } from 'express'
import type { BacktestConfig, BacktestResult } from '../../shared/types.js'
import { dataStore } from '../lib/datastore.js'
import { runBacktest, saveBacktestResult } from '../lib/backtest.js'
import { getObservationsMatrix } from '../lib/featureEngineer.js'

const router = Router()

router.post('/run', async (req: Request, res: Response): Promise<void> => {
  try {
    const { dataId, config, features } = req.body as {
      dataId: string
      config: BacktestConfig
      features?: string[]
    }

    if (!dataId || !config) {
      res.status(400).json({
        success: false,
        error: 'Missing required parameters: dataId and config',
      })
      return
    }

    if (config.windowSize <= 0) {
      res.status(400).json({
        success: false,
        error: 'windowSize must be greater than 0',
      })
      return
    }

    if (config.stepSize <= 0) {
      res.status(400).json({
        success: false,
        error: 'stepSize must be greater than 0',
      })
      return
    }

    if (config.trainRatio <= 0 || config.trainRatio >= 1) {
      res.status(400).json({
        success: false,
        error: 'trainRatio must be between 0 and 1',
      })
      return
    }

    const data = dataStore.getTimeSeriesData(dataId)
    if (!data) {
      res.status(404).json({
        success: false,
        error: 'Data not found',
      })
      return
    }

    if (data.length < config.windowSize) {
      res.status(400).json({
        success: false,
        error: `Data length (${data.length}) is less than windowSize (${config.windowSize})`,
      })
      return
    }

    const observations = getObservationsMatrix(data, features)
    const featureNames = features || data.selectedFeatures

    const result = runBacktest(observations, config, featureNames)

    const fullResult: Omit<BacktestResult, 'id'> = {
      ...result,
      dataId,
    }

    const savedResult = saveBacktestResult(fullResult)

    res.status(200).json({
      success: true,
      data: savedResult,
      message: `Backtest completed with ${savedResult.windows.length} windows`,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const result = dataStore.getBacktestResult(id)

    if (!result) {
      res.status(404).json({
        success: false,
        error: 'Backtest result not found',
      })
      return
    }

    res.status(200).json({
      success: true,
      data: result,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.get('/data/:dataId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { dataId } = req.params
    const results = dataStore.getBacktestResultsByDataId(dataId)

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

router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const results = (dataStore as any).backtestResults
      ? Array.from((dataStore as any).backtestResults.values())
      : []

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

router.get('/:id/summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const result = dataStore.getBacktestResult(id)

    if (!result) {
      res.status(404).json({
        success: false,
        error: 'Backtest result not found',
      })
      return
    }

    const summary = {
      id: result.id,
      config: result.config,
      nWindows: result.windows.length,
      overallMetrics: result.overallMetrics,
      completedAt: result.completedAt,
      dataId: result.dataId,
      bestWindow: result.windows.reduce((best, current) =>
        current.f1 > best.f1 ? current : best,
      ),
      worstWindow: result.windows.reduce((worst, current) =>
        current.f1 < worst.f1 ? current : worst,
      ),
    }

    res.status(200).json({
      success: true,
      data: summary,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params

    const result = dataStore.getBacktestResult(id)
    if (!result) {
      res.status(404).json({
        success: false,
        error: 'Backtest result not found',
      })
      return
    }

    ;(dataStore as any).backtestResults.delete(id)

    res.status(200).json({
      success: true,
      message: 'Backtest result deleted successfully',
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

export default router
