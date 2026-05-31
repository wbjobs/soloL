import { Router, type Request, type Response } from 'express'
import type { SHAPResult } from '../../shared/types.js'
import { dataStore } from '../lib/datastore.js'
import {
  computeSHAP,
  saveSHAPResult,
  getFeatureImportanceRanking,
  type SHAPOptions,
} from '../lib/shap.js'
import { getObservationsMatrix } from '../lib/featureEngineer.js'

const router = Router()

function findAnomalyIntervals(anomalies: boolean[]): { start: number; end: number }[] {
  const intervals: { start: number; end: number }[] = []
  let start = -1

  for (let i = 0; i < anomalies.length; i++) {
    if (anomalies[i] && start === -1) {
      start = i
    } else if (!anomalies[i] && start !== -1) {
      intervals.push({ start, end: i - 1 })
      start = -1
    }
  }

  if (start !== -1) {
    intervals.push({ start, end: anomalies.length - 1 })
  }

  return intervals
}

router.post('/compute', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      modelId,
      dataId,
      anomalyResultId,
      anomalyIntervals,
      features,
      options,
    } = req.body as {
      modelId: string
      dataId: string
      anomalyResultId?: string
      anomalyIntervals?: { start: number; end: number }[]
      features?: string[]
      options?: SHAPOptions
    }

    if (!modelId || !dataId) {
      res.status(400).json({
        success: false,
        error: 'Missing required parameters: modelId and dataId',
      })
      return
    }

    const model = dataStore.getHMMModel(modelId)
    if (!model) {
      res.status(404).json({
        success: false,
        error: 'Model not found',
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

    let intervals = anomalyIntervals
    let actualAnomalyResultId = anomalyResultId

    if (!intervals && anomalyResultId) {
      const anomalyResult = dataStore.getAnomalyResult(anomalyResultId)
      if (anomalyResult) {
        intervals = findAnomalyIntervals(anomalyResult.anomalies)
      }
    }

    if (!intervals || intervals.length === 0) {
      res.status(400).json({
        success: false,
        error: 'No anomaly intervals provided or found',
      })
      return
    }

    const observations = getObservationsMatrix(data, features)
    const featureNames = features || data.selectedFeatures

    const shapResult = computeSHAP(
      model,
      observations,
      intervals,
      featureNames,
      options,
    )

    const fullResult: Omit<SHAPResult, 'id'> = {
      ...shapResult,
      dataId,
      modelId,
      anomalyResultId: actualAnomalyResultId || '',
    }

    const savedResult = saveSHAPResult(fullResult)

    res.status(200).json({
      success: true,
      data: savedResult,
      message: `SHAP values computed for ${intervals.length} anomaly intervals`,
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
    const result = dataStore.getSHAPResult(id)

    if (!result) {
      res.status(404).json({
        success: false,
        error: 'SHAP result not found',
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

router.get('/:id/ranking', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const result = dataStore.getSHAPResult(id)

    if (!result) {
      res.status(404).json({
        success: false,
        error: 'SHAP result not found',
      })
      return
    }

    const ranking = getFeatureImportanceRanking(result)

    res.status(200).json({
      success: true,
      data: ranking,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.get('/anomaly/:anomalyResultId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { anomalyResultId } = req.params
    const results = dataStore.getSHAPResultsByAnomalyResultId(anomalyResultId)

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

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params

    const result = dataStore.getSHAPResult(id)
    if (!result) {
      res.status(404).json({
        success: false,
        error: 'SHAP result not found',
      })
      return
    }

    ;(dataStore as any).shapResults.delete(id)

    res.status(200).json({
      success: true,
      message: 'SHAP result deleted successfully',
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

export default router
