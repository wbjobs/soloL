import mongoose from 'mongoose'

const gradientSchema = new mongoose.Schema({
  clientId: { type: String, required: true },
  sourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'VideoSource' },
  modelVersion: { type: String, required: true },
  gradients: [{
    layerName: { type: String, required: true },
    shape: [Number],
    data: [Number],
    norm: Number
  }],
  numSamples: { type: Number, required: true },
  epsilon: { type: Number, default: 1.0 },
  delta: { type: Number, default: 1e-5 },
  receivedAt: { type: Date, default: Date.now },
  aggregated: { type: Boolean, default: false }
})

const Gradient = mongoose.model('Gradient', gradientSchema)

export default Gradient
