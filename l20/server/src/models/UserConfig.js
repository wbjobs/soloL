import mongoose from 'mongoose';

const userConfigSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  background: {
    type: { type: String, enum: ['image', 'video', 'blur', 'none'], default: 'none' },
    url: String,
    blurAmount: { type: Number, default: 10 }
  },
  avatar: { type: String, default: 'default' },
  avatars: [{
    id: String,
    name: String,
    modelUrl: String,
    thumbnail: String
  }]
}, { timestamps: true });

export const UserConfig = mongoose.model('UserConfig', userConfigSchema);
