import { Router, type Request, type Response } from 'express'
import type {
  HMMConfig,
  HMMModel,
  AnomalyResult,
  TrainingStatus,
} from '../../shared/types.js'
import { dataStore } from '../lib/datastore.js'
import { trainHMM, detectAnomalies } from '../lib/hmm.js'
import { getObservationsMatrix } from '../lib/featureEngineer.js'

const router = Router()

router.post('/train', async (req: Request, res: Response): Promise<void> => {
  try {
    const { dataId, config, features } = req.body as {
      dataId: string
      config: HMMConfig
      features?: string[]
    }

    if (!dataId || !config) {
      res.status(400).json({
        success: false,
        error: 'Missing required parameters: dataId and config',
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

    const trainingStatusId = dataStore.generateId()
    const trainingStatus: TrainingStatus = {
      id: trainingStatusId,
      status: 'training',
      progress: 0,
      message: 'Initializing training...',
      currentIteration: 0,
      logLikelihood: -Infinity,
    }
    dataStore.saveTrainingStatus(trainingStatus)

    setImmediate(async () => {
      try {
        const observations = getObservationsMatrix(data, features)

        const onProgress = (iteration: number, logLikelihood: number) => {
          const progress = (iteration / config.maxIterations) * 100
          dataStore.updateTrainingStatus(trainingStatusId, {
            progress,
            currentIteration: iteration,
            logLikelihood,
            message: `Training iteration ${iteration}/${config.maxIterations}`,
          })
        }

        const model = trainHMM(observations, config, undefined, onProgress)
        dataStore.saveHMMModel(model)

        dataStore.updateTrainingStatus(trainingStatusId, {
          status: 'completed',
          progress: 100,
          message: 'Training completed successfully',
          result: model,
        })
      } catch (error) {
        dataStore.updateTrainingStatus(trainingStatusId, {
          status: 'error',
          message: `Training failed: ${(error as Error).message}`,
          error: (error as Error).message,
        })
      }
    })

    res.status(202).json({
      success: true,
      message: 'Training started',
      trainingId: trainingStatusId,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.post('/update', async (req: Request, res: Response): Promise<void> => {
  try {
    const { modelId, dataId, config, features } = req.body as {
      modelId: string
      dataId: string
      config: HMMConfig
      features?: string[]
    }

    if (!modelId || !dataId || !config) {
      res.status(400).json({
        success: false,
        error: 'Missing required parameters: modelId, dataId, and config',
      })
      return
    }

    const existingModel = dataStore.getHMMModel(modelId)
    if (!existingModel) {
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

    const observations = getObservationsMatrix(data, features)
    const updatedModel = trainHMM(observations, config, existingModel)
    dataStore.saveHMMModel(updatedModel)

    res.status(200).json({
      success: true,
      data: updatedModel,
      message: 'Model updated incrementally',
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
    const { modelId, dataId, thresholdK, features } = req.body as {
      modelId: string
      dataId: string
      thresholdK?: number
      features?: string[]
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

    const observations = getObservationsMatrix(data, features)
    const detectionResult = detectAnomalies(
      model,
      observations,
      thresholdK || 2,
    )

    const anomalyResult: AnomalyResult = {
      id: dataStore.generateId(),
      timestamps: data.dates,
      logLikelihoods: detectionResult.logLikelihoods,
      anomalyScores: detectionResult.anomalyScores,
      anomalies: detectionResult.anomalies,
      states: detectionResult.states,
      threshold: detectionResult.threshold,
      meanLogLikelihood: detectionResult.meanLogLikelihood,
      stdLogLikelihood: detectionResult.stdLogLikelihood,
      predictedScores: detectionResult.predictedScores,
      predictedAnomalies: detectionResult.predictedAnomalies,
      dataId,
      modelId,
    }

    dataStore.saveAnomalyResult(anomalyResult)

    res.status(200).json({
      success: true,
      data: anomalyResult,
      message: `Detected ${detectionResult.anomalies.filter(Boolean).length} anomalies`,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.get('/training/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const status = dataStore.getTrainingStatus(id)

    if (!status) {
      res.status(404).json({
        success: false,
        error: 'Training status not found',
      })
      return
    }

    res.status(200).json({
      success: true,
      data: status,
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
    const models = dataStore.getAllHMMModels()
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
    const model = dataStore.getHMMModel(id)

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
    const deleted = dataStore.deleteHMMModel(id)

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: 'Model not found',
      })
      return
    }

    res.status(200).json({
      success: true,
      message: 'Model deleted successfully',
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.get('/anomalies/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const result = dataStore.getAnomalyResult(id)

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

router.get('/anomalies/data/:dataId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { dataId } = req.params
    const results = dataStore.getAnomalyResultsByDataId(dataId)

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

export default router
