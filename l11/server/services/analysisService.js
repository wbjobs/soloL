const db = require('../config/database');
const pythonBridge = require('./pythonBridge');
const path = require('path');
const fs = require('fs').promises;

class AnalysisService {
  async createAnalysisRecord(file, batchId = null) {
    const result = await db.query(
      `INSERT INTO analyses (filename, original_name, file_size, batch_id, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id`,
      [file.filename, file.originalname, file.size, batchId]
    );
    return result.rows[0].id;
  }

  async createBatchJob(totalFiles) {
    const result = await db.query(
      `INSERT INTO batch_jobs (total_files, status)
       VALUES ($1, 'processing')
       RETURNING id`,
      [totalFiles]
    );
    return result.rows[0].id;
  }

  async updateBatchProgress(batchId, completed) {
    await db.query(
      `UPDATE batch_jobs SET completed_files = $1 WHERE id = $2`,
      [completed, batchId]
    );
  }

  async completeBatch(batchId, success = true) {
    await db.query(
      `UPDATE batch_jobs SET status = $1 WHERE id = $2`,
      [success ? 'completed' : 'failed', batchId]
    );
  }

  async processMidiFile(analysisId, filePath) {
    try {
      await db.query(
        `UPDATE analyses SET status = 'processing' WHERE id = $1`,
        [analysisId]
      );

      const result = await pythonBridge.analyzeMidi(filePath);
      const { midi_analysis, classification } = result;

      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        const meta = midi_analysis.metadata;
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

        for (const tag of classification.genre) {
          await client.query(
            `INSERT INTO style_tags (analysis_id, genre, confidence)
             VALUES ($1, $2, $3)`,
            [analysisId, tag.genre, tag.confidence]
          );
        }

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

        const categorySummary = classification.instrument_analysis.find(i => i.category_summary);
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

        for (const chord of midi_analysis.chords) {
          await client.query(
            `INSERT INTO chords (analysis_id, name, start_time, duration, notes)
             VALUES ($1, $2, $3, $4, $5)`,
            [analysisId, chord.name, chord.start_time, chord.duration, chord.notes]
          );
        }

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

        for (const section of midi_analysis.sections) {
          await client.query(
            `INSERT INTO sections (analysis_id, label, start_time, end_time, description)
             VALUES ($1, $2, $3, $4, $5)`,
            [analysisId, section.label, section.start_time, section.end_time, section.description]
          );
        }

        await client.query('COMMIT');
      } catch (dbError) {
        await client.query('ROLLBACK');
        throw dbError;
      } finally {
        client.release();
      }

      return { success: true, analysisId };
    } catch (error) {
      await db.query(
        `UPDATE analyses SET status = 'failed', error_message = $1 WHERE id = $2`,
        [error.message, analysisId]
      );
      throw error;
    }
  }

  async getAnalysisById(analysisId) {
    const [analysis, genres, emotions, instruments, chords, sections, notes] = await Promise.all([
      db.query(`SELECT * FROM analyses WHERE id = $1`, [analysisId]),
      db.query(`SELECT * FROM style_tags WHERE analysis_id = $1 ORDER BY confidence DESC`, [analysisId]),
      db.query(`SELECT * FROM emotion_tags WHERE analysis_id = $1 ORDER BY confidence DESC`, [analysisId]),
      db.query(`SELECT * FROM instruments WHERE analysis_id = $1 ORDER BY note_count DESC`, [analysisId]),
      db.query(`SELECT * FROM chords WHERE analysis_id = $1 ORDER BY start_time ASC`, [analysisId]),
      db.query(`SELECT * FROM sections WHERE analysis_id = $1 ORDER BY start_time ASC`, [analysisId]),
      db.query(`SELECT * FROM notes WHERE analysis_id = $1 ORDER BY start_time ASC LIMIT 500`, [analysisId]),
    ]);

    if (analysis.rows.length === 0) {
      return null;
    }

    return {
      ...analysis.rows[0],
      style_tags: genres.rows,
      emotion_tags: emotions.rows,
      instruments: instruments.rows,
      chords: chords.rows,
      sections: sections.rows,
      notes: notes.rows,
    };
  }

  async getAnalysisHistory(limit = 20, offset = 0) {
    const result = await db.query(
      `SELECT a.*, 
              (SELECT genre FROM style_tags WHERE analysis_id = a.id ORDER BY confidence DESC LIMIT 1) as primary_genre,
              (SELECT emotion FROM emotion_tags WHERE analysis_id = a.id ORDER BY confidence DESC LIMIT 1) as primary_emotion
       FROM analyses a
       ORDER BY upload_time DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await db.query(`SELECT COUNT(*) FROM analyses`);

    return {
      items: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit,
      offset,
    };
  }

  async getBatchStatus(batchId) {
    const result = await db.query(
      `SELECT b.*,
              COUNT(a.id) as total_processed,
              SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END) as completed_count,
              SUM(CASE WHEN a.status = 'failed' THEN 1 ELSE 0 END) as failed_count
       FROM batch_jobs b
       LEFT JOIN analyses a ON a.batch_id = b.id
       WHERE b.id = $1
       GROUP BY b.id`,
      [batchId]
    );

    if (result.rows.length === 0) return null;

    const analyses = await db.query(
      `SELECT id, original_name, status FROM analyses WHERE batch_id = $1 ORDER BY upload_time`,
      [batchId]
    );

    return {
      ...result.rows[0],
      analyses: analyses.rows,
    };
  }

  async deleteAnalysis(analysisId) {
    const result = await db.query(
      `DELETE FROM analyses WHERE id = $1 RETURNING filename`,
      [analysisId]
    );

    if (result.rows.length > 0) {
      const uploadDir = process.env.UPLOAD_DIR || './uploads';
      const filePath = path.join(uploadDir, result.rows[0].filename);
      try {
        await fs.unlink(filePath);
      } catch (e) {
        console.warn(`Could not delete file ${filePath}:`, e.message);
      }
    }

    return result.rows.length > 0;
  }

  async exportToJson(analysisId) {
    const analysis = await this.getAnalysisById(analysisId);
    if (!analysis) return null;

    const exportData = {
      export_version: '1.0',
      export_time: new Date().toISOString(),
      analysis: {
        id: analysis.id,
        original_name: analysis.original_name,
        upload_time: analysis.upload_time,
        duration_seconds: analysis.duration_seconds,
        tempo_bpm: analysis.tempo_bpm,
        time_signature: analysis.time_signature,
        key_signature: analysis.key_signature,
        note_count: analysis.note_count,
        track_count: analysis.track_count,
      },
      style_classification: analysis.style_tags.map(t => ({
        genre: t.genre,
        confidence: t.confidence,
      })),
      emotion_analysis: analysis.emotion_tags.map(t => ({
        emotion: t.emotion,
        confidence: t.confidence,
        valence: t.valence,
        arousal: t.arousal,
      })),
      instruments: analysis.instruments.map(i => ({
        name: i.name,
        program: i.program,
        track_number: i.track_number,
        note_count: i.note_count,
        is_percussion: i.is_percussion,
      })),
      chord_progression: analysis.chords.map(c => ({
        name: c.name,
        start_time: c.start_time,
        duration: c.duration,
        notes: c.notes,
      })),
      structure: analysis.sections.map(s => ({
        label: s.label,
        start_time: s.start_time,
        end_time: s.end_time,
        description: s.description,
      })),
      waveform_data: this.generateWaveformData(analysis.notes, analysis.duration_seconds),
    };

    return exportData;
  }

  generateWaveformData(notes, duration, bins = 100) {
    if (!notes || notes.length === 0 || duration <= 0) {
      return Array(bins).fill(0);
    }

    const binSize = duration / bins;
    const waveform = Array(bins).fill(0);

    for (const note of notes) {
      const binIdx = Math.min(Math.floor(note.start_time / binSize), bins - 1);
      const velocity = note.velocity || 64;
      waveform[binIdx] += velocity / 127.0;
    }

    const max = Math.max(...waveform, 1);
    return waveform.map(v => v / max);
  }

  async exportBatchToJson(analysisIds) {
    const results = [];
    for (const id of analysisIds) {
      const data = await this.exportToJson(id);
      if (data) {
        results.push(data);
      }
    }
    return {
      export_version: '1.0',
      export_time: new Date().toISOString(),
      batch_analyses: results,
    };
  }
}

module.exports = new AnalysisService();
