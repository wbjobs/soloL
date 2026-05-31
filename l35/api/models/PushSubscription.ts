import mongoose from 'mongoose'

const pushSubscriptionSchema = new mongoose.Schema({
  sourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'VideoSource', required: true },
  subscription: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now }
})

const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema)

export default PushSubscription
