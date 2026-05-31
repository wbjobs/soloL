import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import path from 'path'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import sourcesRouter from './routes/sources.js'
import detectionsRouter from './routes/detections.js'
import regionsRouter from './routes/regions.js'
import alertsRouter from './routes/alerts.js'
import pushRouter from './routes/push.js'
import behaviorRouter from './routes/behavior.js'
import annotationsRouter from './routes/annotations.js'
import federatedRouter from './routes/federated.js'
import snapshotsRouter from './routes/snapshots.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config()

const app: express.Application = express()

app.use(express.json({ limit: '10mb' }))
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
});
app.use(cors())
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

app.use('/api/sources', sourcesRouter)
app.use('/api/detections', detectionsRouter)
app.use('/api/regions', regionsRouter)
app.use('/api/alerts', alertsRouter)
app.use('/api/push', pushRouter)
app.use('/api/behavior', behaviorRouter)
app.use('/api/annotations', annotationsRouter)
app.use('/api/federated', federatedRouter)
app.use('/api/snapshots', snapshotsRouter)

app.use(
  '/api/health',
  (req: Request, res: Response, next: NextFunction): void => {
    res.status(200).json({
      success: true,
      message: 'ok',
    })
  },
)

app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  res.status(500).json({
    success: false,
    error: 'Server internal error',
  })
})

app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

export default app
