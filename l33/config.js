module.exports = {
  scheduler: {
    host: '0.0.0.0',
    port: 50051,
    httpPort: 3000
  },
  web: {
    port: 8080
  },
  paths: {
    uploads: './uploads',
    renders: './renders',
    output: './output',
    checkpoints: './checkpoints'
  },
  blender: {
    path: 'blender',
    defaultEngine: 'CYCLES',
    defaultResolution: { x: 1920, y: 1080 }
  },
  task: {
    maxRetries: 3,
    timeoutMs: 300000,
    checkpointInterval: 5
  },
  node: {
    heartbeatIntervalMs: 10000,
    heartbeatTimeoutMs: 30000,
    maxReconnectAttempts: 10,
    reconnectDelayMs: 5000
  },
  checkpoint: {
    enabled: true,
    intervalFrames: 5,
    storagePath: './checkpoints',
    maxAgeDays: 7
  },
  assetCache: {
    enabled: true,
    defaultSizeMB: 51200,
    cacheSubdir: 'asset_cache'
  },
  budget: {
    defaultMaxFrames: 0,
    defaultMaxGpuHours: 0,
    defaultCostPerGpuHour: 0.50
  }
};
