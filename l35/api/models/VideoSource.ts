import mongoose from 'mongoose'

const videoSourceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, enum: ['file', 'rtsp'], required: true },
  url: { type: String },
  status: { type: String, enum: ['connecting', 'live', 'error', 'offline'], default: 'connecting' },
  resolution: { type: String },
  bitrate: { type: Number },
  createdAt: { type: Date, default: Date.now }
})

const VideoSource = mongoose.model('VideoSource', videoSourceSchema)

export default VideoSource
