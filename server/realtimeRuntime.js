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
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/miro_clone',
  });

  let schemaReady = null;
  const ensureSchema = () => {
    if (!schemaReady) {
      schemaReady = pool.query(schemaSql).catch(error => {
        schemaReady = null;
        throw error;
      });
    }
    return schemaReady;
  };
  void ensureSchema().catch(error => console.error('DB Init Error (local Yjs storage remains active):', error));

  const configuration = {
    timeout: 30000,
    extensions: [
      new Database({
        fetch: async ({ documentName }) => {
          await ensureSchema();
          const result = await pool.query('SELECT state FROM boards WHERE id = $1', [documentName]);
          return result.rows[0]?.state || null;
        },
        store: async ({ documentName, state }) => {
          await ensureSchema();
          await pool.query(
            'INSERT INTO boards (id, state) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = CURRENT_TIMESTAMP',
            [documentName, state]
          );
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
