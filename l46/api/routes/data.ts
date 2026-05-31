import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import type { TimeSeriesData, DataUploadResponse } from '../../shared/types.js'
import { dataStore } from '../lib/datastore.js'
import {
  engineerFeatures,
  generateSampleData,
  type FeatureConfig,
} from '../lib/featureEngineer.js'

const router = Router()

const storage = multer.memoryStorage()
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
})

function parseCSV(content: string): {
  headers: string[]
  rows: Record<string, string>[]
} {
  const lines = content.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length === 0) {
    return { headers: [], rows: [] }
  }

  const headers = lines[0].split(',').map((h) => h.trim())
  const rows: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',')
    const row: Record<string, string> = {}
    headers.forEach((header, idx) => {
      row[header] = values[idx]?.trim() || ''
    })
    rows.push(row)
  }

  return { headers, rows }
}

function rowsToTimeSeries(
  rows: Record<string, string>[],
  headers: string[],
  filename: string,
): TimeSeriesData {
  const dateColumns = ['date', 'Date', 'time', 'Time', 'datetime', 'Datetime', 'timestamp']
  const dateColumn = headers.find((h) => dateColumns.includes(h)) || headers[0]

  const numericColumns = headers.filter((h) => {
    if (dateColumns.includes(h)) return false
    for (const row of rows.slice(0, 10)) {
      const val = parseFloat(row[h])
      if (isNaN(val)) return false
    }
    return true
  })

  const dates: string[] = []
  const features: Record<string, number[]> = {}

  numericColumns.forEach((col) => {
    features[col] = []
  })

  for (const row of rows) {
    dates.push(row[dateColumn] || new Date().toISOString())
    numericColumns.forEach((col) => {
      const val = parseFloat(row[col])
      features[col].push(isNaN(val) ? 0 : val)
    })
  }

  return {
    id: dataStore.generateId(),
    name: filename.replace(/\.csv$/i, ''),
    dates,
    features,
    selectedFeatures: numericColumns.slice(0, Math.min(2, numericColumns.length)),
    length: rows.length,
  }
}

router.post(
  '/upload',
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({
          success: false,
          error: 'No file uploaded',
        })
        return
      }

      const content = req.file.buffer.toString('utf-8')
      const { headers, rows } = parseCSV(content)

      if (headers.length === 0 || rows.length === 0) {
        res.status(400).json({
          success: false,
          error: 'Invalid CSV file',
        })
        return
      }

      const timeSeriesData = rowsToTimeSeries(rows, headers, req.file.originalname)
      dataStore.saveTimeSeriesData(timeSeriesData)

      const response: DataUploadResponse = {
        success: true,
        data: timeSeriesData,
        message: `Successfully uploaded ${rows.length} rows`,
      }

      res.status(200).json(response)
    } catch (error) {
      res.status(500).json({
        success: false,
        error: (error as Error).message,
      })
    }
  },
)

router.get('/sample', async (req: Request, res: Response): Promise<void> => {
  try {
    const nPoints = parseInt(req.query.nPoints as string) || 500
    const nStates = parseInt(req.query.nStates as string) || 3

    const sampleData = generateSampleData(nPoints, nStates)
    dataStore.saveTimeSeriesData(sampleData)

    res.status(200).json({
      success: true,
      data: sampleData,
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
    const data = dataStore.getTimeSeriesData(id)

    if (!data) {
      res.status(404).json({
        success: false,
        error: 'Data not found',
      })
      return
    }

    res.status(200).json({
      success: true,
      data,
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
    const dataList = dataStore.getAllTimeSeriesData()
    res.status(200).json({
      success: true,
      data: dataList,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.get('/:id/preview', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const limit = parseInt(req.query.limit as string) || 100
    const offset = parseInt(req.query.offset as string) || 0

    const data = dataStore.getTimeSeriesData(id)

    if (!data) {
      res.status(404).json({
        success: false,
        error: 'Data not found',
      })
      return
    }

    const previewDates = data.dates.slice(offset, offset + limit)
    const previewFeatures: Record<string, number[]> = {}

    for (const feature of Object.keys(data.features)) {
      previewFeatures[feature] = data.features[feature].slice(
        offset,
        offset + limit,
      )
    }

    res.status(200).json({
      success: true,
      data: {
        id: data.id,
        name: data.name,
        dates: previewDates,
        features: previewFeatures,
        selectedFeatures: data.selectedFeatures,
        totalLength: data.length,
        offset,
        limit,
      },
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.post('/:id/features', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const config = req.body as FeatureConfig

    const data = dataStore.getTimeSeriesData(id)

    if (!data) {
      res.status(404).json({
        success: false,
        error: 'Data not found',
      })
      return
    }

    const enhancedData = engineerFeatures(data, config)
    dataStore.saveTimeSeriesData(enhancedData)

    res.status(200).json({
      success: true,
      data: enhancedData,
      message: `Generated ${Object.keys(enhancedData.features).length - Object.keys(data.features).length} new features`,
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
    const deleted = dataStore.deleteTimeSeriesData(id)

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: 'Data not found',
      })
      return
    }

    res.status(200).json({
      success: true,
      message: 'Data deleted successfully',
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

export default router
