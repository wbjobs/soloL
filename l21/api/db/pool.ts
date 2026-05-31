import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

export const useDatabase = !!DATABASE_URL;

let pool: pg.Pool | null = null;

if (useDatabase) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  });

  pool.on('error', (err: Error) => {
    console.error('Unexpected error on idle client', err);
  });

  console.log('PostgreSQL connection pool initialized');
} else {
  console.warn('DATABASE_URL not set - using in-memory mode for versions');
}

export default pool as pg.Pool;
