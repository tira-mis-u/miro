import { Database } from '@hocuspocus/extension-database';
import pg from 'pg';

const { Pool } = pg;

const schemaSql = `
  CREATE TABLE IF NOT EXISTS boards (
    id VARCHAR(255) PRIMARY KEY,
    state BYTEA NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

export function createRealtimeRuntime() {
  const hasCustomUrl = Boolean(process.env.DATABASE_URL);
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/miro_clone',
    connectionTimeoutMillis: 2000,
  });

  // Prevent unhandled error events from terminating the process if PostgreSQL is unreachable or drops
  pool.on('error', () => {});

  let dbAvailable = false;
  let schemaReady = null;

  const ensureSchema = async () => {
    if (!dbAvailable) return null;
    if (!schemaReady) {
      schemaReady = pool.query(schemaSql).catch(error => {
        schemaReady = null;
        dbAvailable = false;
        throw error;
      });
    }
    return schemaReady;
  };

  // Safe non-blocking connection probe
  pool.query('SELECT 1')
    .then(async () => {
      dbAvailable = true;
      await ensureSchema();
      console.log('📦 [realtime] Connected to PostgreSQL. Persistence enabled.');
    })
    .catch(error => {
      dbAvailable = false;
      if (hasCustomUrl) {
        console.warn(`⚠️ [realtime] Failed to connect to DATABASE_URL (${error.code || error.message}). Local Yjs memory storage active.`);
      } else {
        console.log('ℹ️ [realtime] PostgreSQL not running on localhost:5432. Local Yjs memory storage active (collaboration works normally).');
      }
    });

  const configuration = {
    timeout: 30000,
    extensions: [
      new Database({
        fetch: async ({ documentName }) => {
          if (!dbAvailable) return null;
          try {
            await ensureSchema();
            const result = await pool.query('SELECT state FROM boards WHERE id = $1', [documentName]);
            return result.rows[0]?.state || null;
          } catch {
            return null;
          }
        },
        store: async ({ documentName, state }) => {
          if (!dbAvailable) return;
          try {
            await ensureSchema();
            await pool.query(
              'INSERT INTO boards (id, state) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = CURRENT_TIMESTAMP',
              [documentName, state]
            );
          } catch {
            // Memory storage remains active
          }
        },
      }),
    ],
    async onAuthenticate() {
      // Inject auth Logic here
      return { user: { id: 'anonymous' } };
    },
  };

  return { configuration, pool };
}

