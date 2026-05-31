import { Router, type Request, type Response } from 'express'
import type {
  MultiAssetConfig,
  MultiAssetModel,
  MultiAssetAnomalyResult,
} from '../../shared/types.js'
import { dataStore } from '../lib/datastore.js'
import { trainMultiAssetModel, detectMultiAssetAnomalies } from '../lib/copula.js'
import { getObservationsMatrix } from '../lib/featureEngineer.js'

const router = Router()

router.post('/train', async (req: Request, res: Response): Promise<void> => {
  try {
    const { dataIds, config, features } = req.body as {
      dataIds: string[]
      config: MultiAssetConfig
      features?: string[]
    }

    if (!dataIds || !config) {
      res.status(400).json({
        success: false,
        error: 'Missing required parameters: dataIds and config',
      })
      return
    }

    if (dataIds.length < 2) {
      res.status(400).json({
        success: false,
        error: 'At least 2 dataIds are required for multi-asset analysis',
      })
      return
    }

    const datasets: Record<string, number[][]> = {}
    let timestamps: string[] = []

    for (const dataId of dataIds) {
      const data = dataStore.getTimeSeriesData(dataId)
      if (!data) {
        res.status(404).json({
          success: false,
          error: `Data not found: ${dataId}`,
        })
        return
      }

      const observations = getObservationsMatrix(data, features)
      datasets[dataId] = observations

      if (timestamps.length === 0) {
        timestamps = data.dates
      }
    }

    const model = trainMultiAssetModel(datasets, config)
    dataStore.saveMultiAssetModel(model)

    res.status(200).json({
      success: true,
      data: model,
      message: `Multi-asset model trained successfully with ${model.assetNames.length} assets`,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.post('/detect', async (req: Request, res: Response): Promise<void> => {
  try {
    const { modelId, dataIds, thresholdK } = req.body as {
      modelId: string
      dataIds: string[]
      thresholdK?: number
    }

    if (!modelId || !dataIds) {
      res.status(400).json({
        success: false,
        error: 'Missing required parameters: modelId and dataIds',
      })
      return
    }

    const model = dataStore.getMultiAssetModel(modelId)
    if (!model) {
      res.status(404).json({
        success: false,
        error: 'Model not found',
      })
      return
    }

    const datasets: Record<string, number[][]> = {}
    let timestamps: string[] = []
    let dataIdRef = dataIds[0]

    for (const dataId of dataIds) {
      const data = dataStore.getTimeSeriesData(dataId)
      if (!data) {
        res.status(404).json({
          success: false,
          error: `Data not found: ${dataId}`,
        })
        return
      }

      const observations = getObservationsMatrix(data)
      datasets[dataId] = observations

      if (timestamps.length === 0) {
        timestamps = data.dates
        dataIdRef = dataId
      }
    }

    const result = detectMultiAssetAnomalies(
      model,
      datasets,
      dataIdRef,
      timestamps,
      thresholdK || 2
    )

    dataStore.saveMultiAssetAnomalyResult(result)

    const anomalyCount = result.anomalies.filter(Boolean).length
    res.status(200).json({
      success: true,
      data: result,
      message: `Detected ${anomalyCount} anomalies across ${model.assetNames.length} assets`,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.get('/models', async (_req: Request, res: Response): Promise<void> => {
  try {
    const models = dataStore.getAllMultiAssetModels()
    res.status(200).json({
      success: true,
      data: models,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.get('/models/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const model = dataStore.getMultiAssetModel(id)

    if (!model) {
      res.status(404).json({
        success: false,
        error: 'Model not found',
      })
      return
    }

    res.status(200).json({
      success: true,
      data: model,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.delete('/models/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const deleted = dataStore.deleteMultiAssetModel(id)

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: 'Model not found',
      })
      return
    }

    res.status(200).json({
      success: true,
      message: 'Multi-asset model deleted successfully',
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.get('/results', async (_req: Request, res: Response): Promise<void> => {
  try {
    const results = dataStore.getAllMultiAssetAnomalyResults()
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

router.get('/results/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const result = dataStore.getMultiAssetAnomalyResult(id)

    if (!result) {
      res.status(404).json({
        success: false,
        error: 'Anomaly result not found',
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

export default router
