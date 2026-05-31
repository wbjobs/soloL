import mongoose from 'mongoose'

const defenseRegionSchema = new mongoose.Schema({
  sourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'VideoSource', required: true },
  name: { type: String, required: true },
  polygon: [{ x: Number, y: Number }],
  rules: {
    maxPeople: Number,
    direction: { type: String, enum: ['in', 'out', 'both'] },
    schedule: { start: String, end: String }
  },
  enabled: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
})

const DefenseRegion = mongoose.model('DefenseRegion', defenseRegionSchema)

export default DefenseRegion
