/**
 * This is a API server
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import path from 'path'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { ensureDataDirs } from './services/fileService.js'
import segyRoutes from './routes/segy.js'
import gridRoutes from './routes/grid.js'
import trajectoryRoutes from './routes/trajectory.js'
import sliceRoutes from './routes/slice.js'
import fileRoutes from './routes/files.js'
import potreeRoutes from './routes/potree.js'
import geosteeringRoutes from './routes/geosteering.js'
import simulationRoutes from './routes/simulation.js'
import collaborationRoutes from './routes/collaboration.js'

// for esm mode
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// load env
dotenv.config()

const app: express.Application = express()

const dataDir = path.join(process.cwd(), 'data')
ensureDataDirs(dataDir)

app.use(cors())
app.use(express.json({ limit: '500mb' }))
app.use(express.urlencoded({ extended: true, limit: '500mb' }))

/**
 * API Routes
 */
app.use('/api/segy', segyRoutes)
app.use('/api/grid', gridRoutes)
app.use('/api/trajectory', trajectoryRoutes)
app.use('/api/slice', sliceRoutes)
app.use('/api', fileRoutes)
app.use('/api/potree', potreeRoutes)
app.use('/api/geosteering', geosteeringRoutes)
app.use('/api/simulation', simulationRoutes)
app.use('/api/collaboration', collaborationRoutes)

/**
 * health
 */
app.use(
  '/api/health',
  (req: Request, res: Response, next: NextFunction): void => {
    res.status(200).json({
      success: true,
      message: 'ok',
    })
  },
)

/**
 * error handler middleware
 */
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  res.status(500).json({
    success: false,
    error: 'Server internal error',
  })
})

/**
 * 404 handler
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

export default app
