import mongoose from 'mongoose'

const annotationSchema = new mongoose.Schema({
  sourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'VideoSource', required: true },
  annotatorId: { type: String, required: true },
  timestamp: { type: Date, required: true },
  frameData: { type: String, required: true },
  detections: [{
    bbox: [Number],
    confidence: Number,
    label: String,
    actionLabel: String,
    isCorrection: { type: Boolean, default: false },
    originalDetection: { type: mongoose.Schema.Types.ObjectId }
  }],
  version: { type: Number, default: 1 },
  status: { type: String, enum: ['draft', 'committed', 'training'], default: 'draft' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
})

annotationSchema.pre('save', function(next) {
  this.updatedAt = new Date()
  next()
})

const Annotation = mongoose.model('Annotation', annotationSchema)

export default Annotation
