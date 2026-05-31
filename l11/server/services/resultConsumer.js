const redis = require('../config/redis');
const db = require('../config/database');
const { EventEmitter } = require('events');

class ResultConsumer extends EventEmitter {
  constructor() {
    super();
    this.streamName = redis.streams.MIDI_RESULTS;
    this.groupName = 'result_processors';
    this.consumerName = `node-consumer-${process.pid}`;
    this.running = false;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    await redis.createConsumerGroup(this.streamName, this.groupName);
    this.initialized = true;
    console.log('✅ Result consumer initialized');
  }

  async start() {
    await this.initialize();
    this.running = true;
    console.log('🚀 Result consumer started, listening for results...');
    this._consumeLoop();
  }

  stop() {
    this.running = false;
    console.log('⏹️  Result consumer stopping...');
  }

  async _consumeLoop() {
    while (this.running) {
      try {
        const messages = await redis.readGroup(
          this.streamName,
          this.groupName,
          this.consumerName,
          10,
          2000
        );

        for (const msg of messages) {
          await this._processResult(msg);
          await redis.acknowledge(this.streamName, this.groupName, msg.id);
        }

        if (messages.length === 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (err) {
        console.error('Error in result consume loop:', err.message);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  async _processResult(msg) {
    const result = msg.data;
    const { success, analysis_id, batch_id, data, error } = result;

    console.log(`📥 Processing result for ${analysis_id}, success: ${success}`);

    try {
      if (success && data) {
        await this._saveAnalysisResult(analysis_id, data);
        this.emit('analysis:complete', { analysis_id, batch_id, success: true });
      } else {
        await this._handleAnalysisFailure(analysis_id, error);
        this.emit('analysis:failed', { analysis_id, batch_id, success: false, error });
      }

      if (batch_id) {
        await this._updateBatchStatus(batch_id);
      }
    } catch (err) {
      console.error(`Failed to process result for ${analysis_id}:`, err.message);
      await this._handleAnalysisFailure(analysis_id, `Result processing failed: ${err.message}`);
    }
  }

  async _saveAnalysisResult(analysisId, resultData) {
    const { midi_analysis, classification } = resultData;
    const meta = midi_analysis.metadata;

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      await client.query(
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
          meta.duration_seconds,
          meta.tempo_bpm,
          meta.time_signature,
          meta.key_signature,
          meta.note_count,
          meta.track_count,
          analysisId
        ]
      );

      await client.query(`DELETE FROM style_tags WHERE analysis_id = $1`, [analysisId]);
      for (const tag of classification.genre) {
        await client.query(
          `INSERT INTO style_tags (analysis_id, genre, confidence) VALUES ($1, $2, $3)`,
          [analysisId, tag.genre, tag.confidence]
        );
      }

      await client.query(`DELETE FROM emotion_tags WHERE analysis_id = $1`, [analysisId]);
      for (const tag of classification.emotion) {
        await client.query(
          `INSERT INTO emotion_tags (analysis_id, emotion, confidence, valence, arousal)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            analysisId,
            tag.emotion,
            tag.confidence,
            classification.valence_arousal?.valence,
            classification.valence_arousal?.arousal
          ]
        );
      }

      await client.query(`DELETE FROM instruments WHERE analysis_id = $1`, [analysisId]);
      for (const inst of classification.instrument_analysis) {
        if (inst.category_summary) continue;
        await client.query(
          `INSERT INTO instruments (analysis_id, program, name, track_number, note_count, is_percussion)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            analysisId,
            inst.program,
            inst.name,
            inst.track_number,
            inst.note_count,
            inst.is_percussion
          ]
        );
      }

      await client.query(`DELETE FROM chords WHERE analysis_id = $1`, [analysisId]);
      for (const chord of midi_analysis.chords) {
        await client.query(
          `INSERT INTO chords (analysis_id, name, start_time, duration, notes)
           VALUES ($1, $2, $3, $4, $5)`,
          [analysisId, chord.name, chord.start_time, chord.duration, chord.notes]
        );
      }

      await client.query(`DELETE FROM notes WHERE analysis_id = $1`, [analysisId]);
      const notesBatch = midi_analysis.notes.slice(0, 1000);
      for (const note of notesBatch) {
        await client.query(
          `INSERT INTO notes (analysis_id, pitch, velocity, start_time, duration, track, channel)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            analysisId,
            note.pitch,
            note.velocity,
            note.start_time,
            note.duration,
            note.track,
            note.channel
          ]
        );
      }

      await client.query(`DELETE FROM sections WHERE analysis_id = $1`, [analysisId]);
      for (const section of midi_analysis.sections) {
        await client.query(
          `INSERT INTO sections (analysis_id, label, start_time, end_time, description)
           VALUES ($1, $2, $3, $4, $5)`,
          [analysisId, section.label, section.start_time, section.end_time, section.description]
        );
      }

      await client.query('COMMIT');
      console.log(`✅ Analysis ${analysisId} saved to database`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async _handleAnalysisFailure(analysisId, errorMessage) {
    await db.query(
      `UPDATE analyses SET status = 'failed', error_message = $1 WHERE id = $2`,
      [errorMessage || 'Unknown error', analysisId]
    );
    console.log(`❌ Analysis ${analysisId} marked as failed: ${errorMessage}`);
  }

  async _updateBatchStatus(batchId) {
    const result = await db.query(
      `SELECT 
         COUNT(*) as total,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
         SUM(CASE WHEN status IN ('pending', 'queued', 'processing') THEN 1 ELSE 0 END) as pending
       FROM analyses WHERE batch_id = $1`,
      [batchId]
    );

    const stats = result.rows[0];
    const total = parseInt(stats.total);
    const completed = parseInt(stats.completed);
    const failed = parseInt(stats.failed);
    const pending = parseInt(stats.pending);

    await db.query(
      `UPDATE batch_jobs SET completed_files = $1 WHERE id = $2`,
      [completed + failed, batchId]
    );

    if (pending === 0) {
      const newStatus = failed > 0 ? 'partial' : 'completed';
      await db.query(
        `UPDATE batch_jobs SET status = $1 WHERE id = $2`,
        [newStatus, batchId]
      );
      console.log(`📦 Batch ${batchId} ${newStatus} (${completed} completed, ${failed} failed)`);
      this.emit('batch:complete', { batch_id: batchId, status: newStatus, completed, failed });
    }
  }

  async getAnalysisStatus(analysisId) {
    try {
      const statusKey = `analysis:status:${analysisId}`;
      const cached = await redis.get(statusKey);
      if (cached) {
        return JSON.parse(cached);
      }
      
      const result = await db.query(
        `SELECT status, error_message FROM analyses WHERE id = $1`,
        [analysisId]
      );
      
      if (result.rows.length === 0) return null;
      
      return {
        status: result.rows[0].status,
        error: result.rows[0].error_message,
        progress: result.rows[0].status === 'completed' ? 100 : 0,
      };
    } catch (err) {
      console.error('Error getting analysis status:', err.message);
      return null;
    }
  }
}

module.exports = new ResultConsumer();
