import { Server } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import pg from 'pg';

const { Pool } = pg;
const port = process.env.PORT || 1234;

// Connect to Neon Postgres or local
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/miro_clone',
});

// Setup Initial DB Table if not exists
pool.query(`
  CREATE TABLE IF NOT EXISTS boards (
    id VARCHAR(255) PRIMARY KEY,
    state BYTEA NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`).catch(err => console.error('DB Init Error:', err));

const server = Server.configure({
  port,
  timeout: 30000,
  extensions: [
    new Database({
      fetch: async ({ documentName }) => {
        try {
          const res = await pool.query('SELECT state FROM boards WHERE id = $1', [documentName]);
          return res.rows[0]?.state || null;
        } catch (e) {
          console.error(e);
          return null;
        }
      },
      store: async ({ documentName, state }) => {
        try {
          await pool.query(
            'INSERT INTO boards (id, state) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = CURRENT_TIMESTAMP',
            [documentName, state]
          );
        } catch (e) {
          console.error('Save error:', e);
        }
      },
    }),
  ],
  async onAuthenticate(data) {
    // Inject auth Logic here
    return { user: { id: 'anonymous' } };
  }
});

server.listen().then(() => {
  console.log(`🚀 Realtime Board Server running on ws://localhost:${port}`);
});
