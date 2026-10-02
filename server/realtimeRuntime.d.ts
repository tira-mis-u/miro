import type { Configuration } from '@hocuspocus/server';
import type { Pool } from 'pg';

export declare function createRealtimeRuntime(): {
  configuration: Partial<Configuration>;
  pool: Pool;
};
