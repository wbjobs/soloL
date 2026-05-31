const redis = require('../config/redis');
const db = require('../config/database');

class TaskQueue {
  constructor() {
    this.streamName = redis.streams.MIDI_ANALYSIS;
    this.groupName = 'midi_analysis_workers';
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    await redis.createConsumerGroup(this.streamName, this.groupName);
    this.initialized = true;
  }

  async enqueueTask(taskData) {
    await this.initialize();
    
    const task = {
      id: taskData.analysis_id || require('uuid').v4(),
      analysis_id: taskData.analysis_id,
      file_path: taskData.file_path,
      batch_id: taskData.batch_id || null,
      original_name: taskData.original_name,
      priority: taskData.priority || 5,
      created_at: Date.now(),
      status: 'queued',
    };

    await db.query(
      `UPDATE analyses SET status = 'queued' WHERE id = $1`,
      [task.analysis_id]
    );

    const messageId = await redis.addToStream(this.streamName, task);
    console.log(`📋 Task enqueued: ${task.analysis_id} (${task.original_name}) -> ${messageId}`);
    
    return { messageId, ...task };
  }

  async completeTask(analysisId, resultData) {
    try {
      await db.query(
        `UPDATE analyses 
         SET status = 'completed',
             duration_seconds = $1,
             tempo_bpm = $2,
             time_signature = $3,
             key_signature = $4,
             note_count = $5,
             track_count = $6
         WHERE id = $7`,
        [
          resultData.metadata.duration_seconds,
          resultData.metadata.tempo_bpm,
          resultData.metadata.time_signature,
          resultData.metadata.key_signature,
          resultData.metadata.note_count,
          resultData.metadata.track_count,
          analysisId
        ]
      );
      return true;
    } catch (err) {
      console.error('Error completing task:', err.message);
      return false;
    }
  }

  async failTask(analysisId, errorMessage) {
    try {
      await db.query(
        `UPDATE analyses SET status = 'failed', error_message = $1 WHERE id = $2`,
        [errorMessage, analysisId]
      );
      return true;
    } catch (err) {
      console.error('Error failing task:', err.message);
      return false;
    }
  }

  async getQueueLength() {
    try {
      const length = await redis.client.xlen(this.streamName);
      return length;
    } catch (err) {
      console.error('Error getting queue length:', err.message);
      return 0;
    }
  }

  async clearQueue() {
    try {
      await redis.client.del(this.streamName);
      return true;
    } catch (err) {
      console.error('Error clearing queue:', err.message);
      return false;
    }
  }
}

module.exports = new TaskQueue();
