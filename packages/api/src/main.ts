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
import { DatabaseConnectionService } from './database/service/database-connection.service';
import { DatabaseMigrationService } from './database/service/database-migration.service';
import { AuthenticationService } from './features/authentication/service/authentication.service';

const mainlogger = new Logger('MAIN');

function checkConfiguration(config: ConfigService<BinderConfig>): void {
  const appRootPath = config.get<string>(ConfigKeys.APP_ROOT_PATH);
  const rootUri = config.get<string>(ConfigKeys.ROOT_URI);

  if (!rootUri) {
    throw new Error(`Missing required configuration key: ${ConfigKeys.ROOT_URI}`);
  }

  if (!appRootPath) {
    throw new Error(`Missing required configuration key: ${ConfigKeys.APP_ROOT_PATH}`);
  }

  const resolvedClientPath = resolve(appRootPath, 'client');
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

  const rootUri = nestConfigService.get<string>(ConfigKeys.ROOT_URI)!;
  const secureCookies = rootUri.startsWith('https://');
  if (secureCookies) {
    // Traefik terminates TLS and forwards the original protocol in
    // X-Forwarded-Proto. Trust the proxy chain so express-session can safely
    // determine that the external request is HTTPS.
    app.getHttpAdapter().getInstance().set('trust proxy', true);
  }

  const corsOptions = {
    origin: rootUri,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true
  };

  if (nestConfigService.get<string>(ConfigKeys.NODE_ENV)!=='development') {
    app.enableCors(corsOptions);
  } else {
    logger.debug!('Skip Cors');
  }

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
    proxy: secureCookies,
    store: new PgSession({
      pool: pgPool,
      tableName: 'user_sessions'
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'lax',
      maxAge: Number(nestConfigService.get<string>(ConfigKeys.SESSION_TTL_MS) ?? 86_400_000)
    }
  }));
  logger.log(`Session cookies configured as ${secureCookies ? 'secure HTTPS' : 'HTTP-compatible'}`);

  app.setGlobalPrefix(nestConfigService.get<string>(ConfigKeys.API_PREFIX) ?? 'api/v1');

  // Complete Nest initialization, including event subscriber registration,
  // before starting the database connection and opening the HTTP listener.
  await app.init();
  logger.log("Initialization is done. Start App")
  await app.get(DatabaseConnectionService).start();
  await app.get(DatabaseMigrationService).waitUntilInitialized();
  await app.listen(Number(nestConfigService.get<string>(ConfigKeys.API_PORT) ?? 3000));

  void app.get(AuthenticationService).ensureBootstrapAdmin().catch((error: unknown) => {
    logger.error(`Bootstrap administrator initialization failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

void bootstrap().catch((error: unknown) => {
  mainlogger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
