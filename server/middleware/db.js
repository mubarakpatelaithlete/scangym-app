/**
 * Database connection pool - shared across all routes.
 * Uses the same Supabase PostgreSQL as the main app.
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'off' ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Database pool error:', err.message);
});

pool.query('SELECT NOW()')
  .then(() => console.log('Database connected'))
  .catch((err) => console.error('Database connection failed:', err.message));

module.exports = pool;
