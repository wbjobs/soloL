const { pool } = require('../config/database');

const addGinIndexes = async () => {
  try {
    console.log('Adding GIN indexes for fast tag and emotion search...');

    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
    `);
    console.log('✅ pg_trgm extension enabled');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_style_tags_genre_gin 
      ON style_tags USING gin (genre gin_trgm_ops);
    `);
    console.log('✅ GIN index on style_tags.genre created');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_emotion_tags_emotion_gin 
      ON emotion_tags USING gin (emotion gin_trgm_ops);
    `);
    console.log('✅ GIN index on emotion_tags.emotion created');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_instruments_name_gin 
      ON instruments USING gin (name gin_trgm_ops);
    `);
    console.log('✅ GIN index on instruments.name created');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chords_name_gin 
      ON chords USING gin (name gin_trgm_ops);
    `);
    console.log('✅ GIN index on chords.name created');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sections_label_gin 
      ON sections USING gin (label gin_trgm_ops);
    `);
    console.log('✅ GIN index on sections.label created');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_analyses_genre_composite 
      ON analyses(id, status);
    `);
    console.log('✅ Composite index on analyses created');

    await pool.query(`
      CREATE OR REPLACE VIEW analysis_tag_summary AS
      SELECT 
        a.id as analysis_id,
        a.original_name,
        a.upload_time,
        a.duration_seconds,
        a.tempo_bpm,
        array_agg(DISTINCT s.genre) as genres,
        array_agg(DISTINCT e.emotion) as emotions,
        array_agg(DISTINCT i.name) as instruments
      FROM analyses a
      LEFT JOIN style_tags s ON s.analysis_id = a.id
      LEFT JOIN emotion_tags e ON e.analysis_id = a.id
      LEFT JOIN instruments i ON i.analysis_id = a.id
      WHERE a.status = 'completed'
      GROUP BY a.id, a.original_name, a.upload_time, a.duration_seconds, a.tempo_bpm;
    `);
    console.log('✅ Materialized view analysis_tag_summary created');

    console.log('\n🎉 All GIN indexes and views created successfully!');
    console.log('\n📊 Index Summary:');
    console.log('  - idx_style_tags_genre_gin: Fast genre search');
    console.log('  - idx_emotion_tags_emotion_gin: Fast emotion search');
    console.log('  - idx_instruments_name_gin: Fast instrument search');
    console.log('  - idx_chords_name_gin: Fast chord search');
    console.log('  - idx_sections_label_gin: Fast section search');
    console.log('  - analysis_tag_summary: Unified tag view for search');
    
    process.exit(0);
  } catch (error) {
    console.error('Error adding GIN indexes:', error);
    process.exit(1);
  }
};

addGinIndexes();
