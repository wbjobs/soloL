import mongoose from 'mongoose'

const detectionSchema = new mongoose.Schema({
  sourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'VideoSource', required: true },
  timestamp: { type: Date, default: Date.now, expires: 2592000 },
  detections: [{
    bbox: [Number],
    confidence: Number,
    classId: Number,
    label: String
  }],
  count: { type: Number },
  regions: [{
    regionId: String,
    insideCount: Number,
    breached: Boolean
  }]
})

const Detection = mongoose.model('Detection', detectionSchema)

export default Detection
