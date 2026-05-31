import { Router, type Request, type Response } from 'express'
import * as fs from 'fs'
import * as path from 'path'
import type {
  ReportConfig,
  ReportResult,
  HMMConfig,
} from '../../shared/types.js'
import { dataStore } from '../lib/datastore.js'
import { generateAndSaveReport } from '../lib/report.js'

const router = Router()

router.post('/generate', async (req: Request, res: Response): Promise<void> => {
  try {
    const { anomalyResultId, dataId, shapResultId, config } = req.body as {
      anomalyResultId: string
      dataId: string
      shapResultId?: string
      config: ReportConfig
    }

    if (!anomalyResultId || !dataId || !config) {
      res.status(400).json({
        success: false,
        error: 'Missing required parameters: anomalyResultId, dataId, and config',
      })
      return
    }

    const anomalyResult = dataStore.getAnomalyResult(anomalyResultId)
    if (!anomalyResult) {
      res.status(404).json({
        success: false,
        error: 'Anomaly result not found',
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

    let shapResult = null
    if (shapResultId) {
      shapResult = dataStore.getSHAPResult(shapResultId)
    }

    const hmmModel = dataStore.getHMMModel(anomalyResult.modelId)
    const fullConfig = config as ReportConfig & { hmmConfig: HMMConfig }
    
    if (hmmModel) {
      fullConfig.hmmConfig = {
        nStates: hmmModel.pi.length,
        learningRate: (hmmModel as any).learningRate || 0.01,
        anomalyThreshold: (hmmModel as any).anomalyThreshold || 2,
        maxIterations: (hmmModel as any).maxIterations || 100,
        convergenceTolerance: 1e-6,
      }
    } else {
      fullConfig.hmmConfig = {
        nStates: 3,
        learningRate: 0.01,
        anomalyThreshold: 2,
        maxIterations: 100,
        convergenceTolerance: 1e-6,
      }
    }

    const report = await generateAndSaveReport(
      anomalyResult,
      data,
      shapResult,
      fullConfig
    )

    dataStore.saveReportResult(report)

    res.status(200).json({
      success: true,
      data: report,
      message: 'Report generated successfully',
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.get('/download/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const report = dataStore.getReportResult(id)

    if (!report) {
      res.status(404).json({
        success: false,
        error: 'Report not found',
      })
      return
    }

    const reportsDir = path.join(process.cwd(), 'public', 'reports')
    const filePath = path.join(reportsDir, report.fileName)

    if (!fs.existsSync(filePath)) {
      res.status(404).json({
        success: false,
        error: 'Report file not found on disk',
      })
      return
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${report.fileName}"`
    )
    res.setHeader('Content-Length', report.fileSize)

    const fileStream = fs.createReadStream(filePath)
    fileStream.pipe(res)
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.get('/list', async (_req: Request, res: Response): Promise<void> => {
  try {
    const reports = dataStore.getAllReportResults()
    res.status(200).json({
      success: true,
      data: reports,
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
    const report = dataStore.getReportResult(id)

    if (!report) {
      res.status(404).json({
        success: false,
        error: 'Report not found',
      })
      return
    }

    const reportsDir = path.join(process.cwd(), 'public', 'reports')
    const filePath = path.join(reportsDir, report.fileName)

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    dataStore.deleteReportResult(id)

    res.status(200).json({
      success: true,
      message: 'Report deleted successfully',
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

export default router
