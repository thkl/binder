declare module 'connect-pg-simple' {
  import session from 'express-session';
  import { Pool } from 'pg';

  interface PostgreSqlStoreOptions {
    pool: Pool;
    tableName?: string;
  }

  const connectPgSimple: (sessionModule: typeof session) => {
    new (options: PostgreSqlStoreOptions): session.Store;
  };

  export = connectPgSimple;
}
