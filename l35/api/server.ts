import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import mongoose from 'mongoose'
import webpush from 'web-push'
import app from './app.js'
import { streamProxy, influxDB, federatedLearning, lstmService } from './services/index.js'
import Annotation from './models/Annotation.js'

const PORT = process.env.PORT || 3001

export { streamProxy }

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/edge-detection'

mongoose.connect(MONGODB_URI).then(() => {
  console.log('Connected to MongoDB')
}).catch((err) => {
  console.error('MongoDB connection error:', err)
})

influxDB.init()
federatedLearning.init()
lstmService.init()

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@edge-detection.local'

if (vapidPublicKey && vapidPrivateKey) {
  try {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
    console.log('VAPID keys configured')
  } catch (err) {
    console.warn('Invalid VAPID keys, push notifications disabled:', err)
  }
} else {
  try {
    const vapidKeys = webpush.generateVAPIDKeys()
    webpush.setVapidDetails(vapidSubject, vapidKeys.publicKey, vapidKeys.privateKey)
    console.log('Generated VAPID keys:')
    console.log('  VAPID_PUBLIC_KEY=' + vapidKeys.publicKey)
    console.log('  VAPID_PRIVATE_KEY=' + vapidKeys.privateKey)
  } catch (err) {
    console.warn('Failed to generate VAPID keys:', err)
  }
}

const server = createServer(app)

const wss = new WebSocketServer({ server, path: '/ws' })

interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'get-keyframes' | 'annotation-draw' | 'annotation-update' | 'annotation-delete' | 'annotation-commit'
  sourceId?: string
  payload: any
}

function broadcastMessage(wss: WebSocketServer, sender: WebSocket, message: any) {
  wss.clients.forEach((client) => {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message))
    }
  })
}

wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    try {
      const message: SignalingMessage = JSON.parse(data.toString())

      switch (message.type) {
        case 'offer':
        case 'answer':
        case 'ice-candidate': {
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify(message))
            }
          })
          break
        }
        case 'get-keyframes': {
          const sourceId = message.sourceId
          if (sourceId && ws.readyState === WebSocket.OPEN) {
            const keyframes = streamProxy.getLatestKeyframes(sourceId, 5)
            ws.send(JSON.stringify({
              type: 'keyframes',
              sourceId,
              keyframes: keyframes.map(kf => ({
                timestamp: kf.timestamp,
                size: kf.size,
                data: kf.data.toString('base64')
              }))
            }))
          }
          break
        }
        case 'annotation-draw': {
          broadcastMessage(wss, ws, message)
          break
        }
        case 'annotation-update': {
          const { id, updates, version } = message.payload
          const annotation = await Annotation.findById(id)
          if (annotation && annotation.version === version) {
            annotation.set(updates)
            annotation.version = version + 1
            await annotation.save()
            message.payload.version = annotation.version
            broadcastMessage(wss, ws, message)
          } else if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'annotation-version-conflict',
              payload: { id, currentVersion: annotation?.version }
            }))
          }
          break
        }
        case 'annotation-delete': {
          const { id } = message.payload
          await Annotation.findByIdAndDelete(id)
          broadcastMessage(wss, ws, message)
          break
        }
        case 'annotation-commit': {
          const { id } = message.payload
          const annotation = await Annotation.findById(id)
          if (annotation) {
            annotation.status = 'committed'
            annotation.version = (annotation.version || 1) + 1
            await annotation.save()
            broadcastMessage(wss, ws, message)
          }
          break
        }
        default:
          break
      }
    } catch (err) {
      console.error('WebSocket message error:', err)
    }
  })

  ws.send(JSON.stringify({ type: 'connected' }))
})

server.listen(PORT, () => {
  console.log(`Server ready on port ${PORT}`)
})

process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received')
  streamProxy.stopAll()
  federatedLearning.stop()
  lstmService.stop()
  wss.close()
  await influxDB.close()
  server.close(() => {
    mongoose.connection.close()
    console.log('Server closed')
    process.exit(0)
  })
})

process.on('SIGINT', async () => {
  console.log('SIGINT signal received')
  streamProxy.stopAll()
  federatedLearning.stop()
  lstmService.stop()
  wss.close()
  await influxDB.close()
  server.close(() => {
    mongoose.connection.close()
    console.log('Server closed')
    process.exit(0)
  })
})

export default app
