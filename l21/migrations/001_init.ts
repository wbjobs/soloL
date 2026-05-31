import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

async function runMigration() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
  });

  try {
    console.log('Running migration 001_init...');

    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        current_content TEXT NOT NULL DEFAULT '',
        current_version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS versions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        message VARCHAR(500),
        user_id VARCHAR(100) NOT NULL,
        user_name VARCHAR(100) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(room_id, version)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS locked_sections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        section_id VARCHAR(100) NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        locked_by VARCHAR(100) NOT NULL,
        locked_by_user_name VARCHAR(100) NOT NULL,
        locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        UNIQUE(room_id, section_id)
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_versions_room_id ON versions(room_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_versions_created_at ON versions(created_at DESC);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_locked_sections_expires ON locked_sections(expires_at);
    `);

    console.log('Migration completed successfully!');

    await pool.query(`
      INSERT INTO rooms (id, name, current_content, current_version)
      VALUES (
        '00000000-0000-0000-0000-000000000001',
        'Demo Room',
        'T:Twinkle Twinkle Little Star\nC:Mozart\nM:4/4\nL:1/8\nQ:1/4=120\nK:C\n|: c c g g | a a g2 | f f e e | d d c2 |\n   g g f f | e e d2 | g g f f | e e d2 |\n   c c g g | a a g2 | f f e e | d d c2 :|\n',
        1
      )
      ON CONFLICT (id) DO NOTHING;
    `);

    console.log('Demo room created!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
