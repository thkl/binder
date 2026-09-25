import 'reflect-metadata';
import 'dotenv/config';
import * as fs from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { LoggingService } from './shared/service/logging.service';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';
import { BinderConfig, ConfigKeys } from './shared/config/config.keys';
import { AuthenticationService } from './features/authentication/authentication.service';
import { DatabaseConnectionService } from './database/service/database-connection.service';
import { DatabaseMigrationService } from './database/service/database-migration.service';

const mainlogger = new Logger('MAIN');

function checkConfiguration(config: ConfigService<BinderConfig>): void {
  const clientPath = config.get<string>(ConfigKeys.CLIENT_PATH);
  const rootUri = config.get<string>(ConfigKeys.ROOT_URI);

  if (!rootUri) {
    throw new Error(`Missing required configuration key: ${ConfigKeys.ROOT_URI}`);
  }

  if (!clientPath) {
    throw new Error(`Missing required configuration key: ${ConfigKeys.CLIENT_PATH}`);
  }

  const resolvedClientPath = resolve(process.cwd(), clientPath);
  if (!fs.existsSync(resolvedClientPath)) {
    console.warn(`Configured client path does not exist: ${resolvedClientPath}`);
  }
}

async function bootstrap(): Promise<void> {
  // Keep Nest's bootstrap logger enabled so configuration and database
  // initialization failures are visible before the Winston logger is installed.
  const app = await NestFactory.create(AppModule);
  const loggingService = app.get(LoggingService);
  const logger = loggingService.initializeLogging();
  app.useLogger(logger);
  const nestConfigService = app.get(ConfigService<BinderConfig>);
  checkConfiguration(nestConfigService);

  const corsOptions = {
    origin: nestConfigService.get<string>(ConfigKeys.ROOT_URI),
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true
  };

  app.enableCors(corsOptions);

  const sessionSecret = nestConfigService.get<string>(ConfigKeys.SESSION_SECRET);
  if (!sessionSecret) {
    throw new Error(`Missing required configuration key: ${ConfigKeys.SESSION_SECRET}`);
  }

  const pgPool = new Pool({
    host: nestConfigService.get<string>(ConfigKeys.DATABASE_HOST),
    port: nestConfigService.get<number>(ConfigKeys.DATABASE_PORT) ?? 5432,
    database: nestConfigService.get<string>(ConfigKeys.DATABASE_NAME),
    user: nestConfigService.get<string>(ConfigKeys.DATABASE_USER),
    password: nestConfigService.get<string>(ConfigKeys.DATABASE_PASSWORD)
  });
  const PgSession = connectPgSimple(session);

  app.use(session({
    store: new PgSession({
      pool: pgPool,
      tableName: 'user_sessions'
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: nestConfigService.get<string>(ConfigKeys.NODE_ENV) === 'production',
      sameSite: 'lax',
      maxAge: Number(nestConfigService.get<string>(ConfigKeys.SESSION_TTL_MS) ?? 86_400_000)
    }
  }));

  app.setGlobalPrefix(nestConfigService.get<string>(ConfigKeys.API_PREFIX) ?? 'api/v1');

  // Complete Nest initialization, including event subscriber registration,
  // before starting the database connection and opening the HTTP listener.
  await app.init();
  console.log("Init Database");
  await app.get(DatabaseConnectionService).start();
  await app.get(DatabaseMigrationService).waitUntilInitialized();
  console.log("Listen to port whatever");
  await app.listen(Number(nestConfigService.get<string>(ConfigKeys.API_PORT) ?? 3000));

  void app.get(AuthenticationService).ensureBootstrapAdmin().catch((error: unknown) => {
    logger.error(`Bootstrap administrator initialization failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

void bootstrap().catch((error: unknown) => {
  mainlogger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
