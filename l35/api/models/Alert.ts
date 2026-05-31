import mongoose from 'mongoose'

const alertSchema = new mongoose.Schema({
  regionId: { type: mongoose.Schema.Types.ObjectId, ref: 'DefenseRegion', required: true },
  sourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'VideoSource', required: true },
  timestamp: { type: Date, default: Date.now },
  type: { type: String, enum: ['breach', 'overcrowd'] },
  snapshot: { type: String },
  details: { type: String },
  read: { type: Boolean, default: false }
})

const Alert = mongoose.model('Alert', alertSchema)

export default Alert
