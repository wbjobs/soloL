const { pool } = require('../config/database');

const initDatabase = async () => {
  try {
    console.log('Creating database tables...');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS analyses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        file_size INTEGER NOT NULL,
        upload_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) DEFAULT 'pending',
        error_message TEXT,
        duration_seconds NUMERIC(10, 2),
        tempo_bpm INTEGER,
        time_signature VARCHAR(20),
        key_signature VARCHAR(20),
        note_count INTEGER,
        track_count INTEGER
      );

      CREATE TABLE IF NOT EXISTS style_tags (
        id SERIAL PRIMARY KEY,
        analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE,
        genre VARCHAR(50) NOT NULL,
        confidence NUMERIC(5, 4) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS emotion_tags (
        id SERIAL PRIMARY KEY,
        analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE,
        emotion VARCHAR(50) NOT NULL,
        confidence NUMERIC(5, 4) NOT NULL,
        valence NUMERIC(5, 4),
        arousal NUMERIC(5, 4)
      );

      CREATE TABLE IF NOT EXISTS instruments (
        id SERIAL PRIMARY KEY,
        analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE,
        program INTEGER NOT NULL,
        name VARCHAR(100) NOT NULL,
        track_number INTEGER,
        note_count INTEGER,
        is_percussion BOOLEAN DEFAULT FALSE
      );

      CREATE TABLE IF NOT EXISTS chords (
        id SERIAL PRIMARY KEY,
        analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE,
        name VARCHAR(50) NOT NULL,
        start_time NUMERIC(10, 4) NOT NULL,
        duration NUMERIC(10, 4) NOT NULL,
        notes INTEGER[] NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE,
        pitch INTEGER NOT NULL,
        velocity INTEGER NOT NULL,
        start_time NUMERIC(10, 4) NOT NULL,
        duration NUMERIC(10, 4) NOT NULL,
        track INTEGER NOT NULL,
        channel INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sections (
        id SERIAL PRIMARY KEY,
        analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE,
        label VARCHAR(50) NOT NULL,
        start_time NUMERIC(10, 4) NOT NULL,
        end_time NUMERIC(10, 4) NOT NULL,
        description TEXT
      );

      CREATE TABLE IF NOT EXISTS batch_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) DEFAULT 'processing',
        total_files INTEGER NOT NULL,
        completed_files INTEGER DEFAULT 0
      );

      ALTER TABLE analyses ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES batch_jobs(id);

      CREATE INDEX IF NOT EXISTS idx_analyses_upload_time ON analyses(upload_time DESC);
      CREATE INDEX IF NOT EXISTS idx_style_tags_analysis_id ON style_tags(analysis_id);
      CREATE INDEX IF NOT EXISTS idx_emotion_tags_analysis_id ON emotion_tags(analysis_id);
      CREATE INDEX IF NOT EXISTS idx_instruments_analysis_id ON instruments(analysis_id);
      CREATE INDEX IF NOT EXISTS idx_chords_analysis_id ON chords(analysis_id);
      CREATE INDEX IF NOT EXISTS idx_notes_analysis_id ON notes(analysis_id);
    `);

    console.log('Database tables created successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  }
};

initDatabase();
