const { PythonShell } = require('python-shell');
const path = require('path');
const db = require('../config/database');
require('dotenv').config();

const PYTHON_PATH = process.env.PYTHON_PATH || 'python';
const PYTHON_SCRIPTS_DIR = path.join(__dirname, '..', '..', 'python');

class ComparisonService {
  constructor() {
    this.options = {
      pythonPath: PYTHON_PATH,
      scriptPath: PYTHON_SCRIPTS_DIR,
      mode: 'json',
      stderrParser: (line) => line,
      pythonOptions: ['-u'],
    };
  }

  async getFullAnalysis(analysisId) {
    const [analysis, notes, chords] = await Promise.all([
      db.query(
        `SELECT a.*, 
                (SELECT genre FROM style_tags WHERE analysis_id = a.id ORDER BY confidence DESC LIMIT 1) as primary_genre,
                (SELECT emotion FROM emotion_tags WHERE analysis_id = a.id ORDER BY confidence DESC LIMIT 1) as primary_emotion
         FROM analyses a WHERE a.id = $1`,
        [analysisId]
      ),
      db.query(
        `SELECT pitch, velocity, start_time, duration, track, channel 
         FROM notes WHERE analysis_id = $1 ORDER BY start_time ASC`,
        [analysisId]
      ),
      db.query(
        `SELECT name, start_time, duration, notes 
         FROM chords WHERE analysis_id = $1 ORDER BY start_time ASC`,
        [analysisId]
      ),
    ]);

    if (analysis.rows.length === 0) {
      return null;
    }

    return {
      analysis: analysis.rows[0],
      notes: notes.rows,
      chords: chords.rows,
    };
  }

  async compare(analysisId1, analysisId2) {
    if (analysisId1 === analysisId2) {
      throw new Error('Cannot compare an analysis with itself');
    }

    const [data1, data2] = await Promise.all([
      this.getFullAnalysis(analysisId1),
      this.getFullAnalysis(analysisId2),
    ]);

    if (!data1) {
      throw new Error(`Analysis ${analysisId1} not found`);
    }
    if (!data2) {
      throw new Error(`Analysis ${analysisId2} not found`);
    }

    return this._runComparison(data1, data2);
  }

  async _runComparison(data1, data2) {
    return new Promise((resolve, reject) => {
      const script = 'comparison_analysis.py';
      const inputData = JSON.stringify({
        analysis1: data1.analysis,
        analysis2: data2.analysis,
        notes1: data1.notes,
        notes2: data2.notes,
        chords1: data1.chords,
        chords2: data2.chords,
      });

      const pyshell = new PythonShell(script, this.options);
      let result = null;
      let errorOutput = [];

      pyshell.send(inputData);

      pyshell.on('message', (message) => {
        if (typeof message === 'object') {
          result = message;
        }
      });

      pyshell.on('stderr', (stderr) => {
        errorOutput.push(stderr);
      });

      pyshell.end((err) => {
        if (err) {
          const errorMsg = errorOutput.length > 0
            ? errorOutput.join('\n')
            : `Python script error: ${err.message}`;
          
          try {
            const errorJson = JSON.parse(errorOutput.join('\n'));
            if (errorJson.error) {
              reject(new Error(errorJson.error));
              return;
            }
          } catch (e) {}
          
          reject(new Error(errorMsg));
        } else if (result && !result.error) {
          resolve(result);
        } else if (result && result.error) {
          reject(new Error(result.error));
        } else {
          reject(new Error('No result from comparison'));
        }
      });
    });
  }

  async searchByTags(query, limit = 20) {
    const searchQuery = `%${query}%`;
    
    const result = await db.query(
      `SELECT DISTINCT a.*,
              (SELECT genre FROM style_tags WHERE analysis_id = a.id ORDER BY confidence DESC LIMIT 1) as primary_genre,
              (SELECT emotion FROM emotion_tags WHERE analysis_id = a.id ORDER BY confidence DESC LIMIT 1) as primary_emotion
       FROM analyses a
       LEFT JOIN style_tags s ON s.analysis_id = a.id
       LEFT JOIN emotion_tags e ON e.analysis_id = a.id
       LEFT JOIN instruments i ON i.analysis_id = a.id
       WHERE a.status = 'completed'
       AND (
         s.genre ILIKE $1
         OR e.emotion ILIKE $1
         OR i.name ILIKE $1
         OR a.original_name ILIKE $1
       )
       ORDER BY a.upload_time DESC
       LIMIT $2`,
      [searchQuery, limit]
    );

    return result.rows;
  }
}

module.exports = new ComparisonService();
