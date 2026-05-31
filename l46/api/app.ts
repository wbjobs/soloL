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
import authRoutes from './routes/auth.js'
import dataRoutes from './routes/data.js'
import hmmRoutes from './routes/hmm.js'
import shapRoutes from './routes/shap.js'
import backtestRoutes from './routes/backtest.js'
import multiAssetRoutes from './routes/multiasset.js'
import reportRoutes from './routes/report.js'
import streamRoutes from './routes/stream.js'
import sqlRuleRoutes from './routes/sqlrule.js'

// for esm mode
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// load env
dotenv.config()

const app: express.Application = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

/**
 * API Routes
 */
app.use('/api/auth', authRoutes)
app.use('/api/data', dataRoutes)
app.use('/api/hmm', hmmRoutes)
app.use('/api/shap', shapRoutes)
app.use('/api/backtest', backtestRoutes)
app.use('/api/multiasset', multiAssetRoutes)
app.use('/api/report', reportRoutes)
app.use('/api/stream', streamRoutes)
app.use('/api/sql', sqlRuleRoutes)

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
