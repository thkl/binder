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
import { SecretsService } from './shared/config/secrets.service';

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
  const secrets = app.get(SecretsService);
  checkConfiguration(nestConfigService);

  const rootUri = nestConfigService.get<string>(ConfigKeys.ROOT_URI)!;
  const secureCookies = rootUri.startsWith('https://');
  const trustedProxies = nestConfigService
    .get<string>(ConfigKeys.TRUST_PROXY)
  if (trustedProxies === 'true') {
    app.getHttpAdapter().getInstance().set('trust proxy', true);
  } else {
    const tp = trustedProxies?.split(',')
      .map((proxy) => proxy.trim()).filter(Boolean);
    if (secureCookies && !tp?.length) {
      throw new Error(
        `${ConfigKeys.TRUST_PROXY} must list the trusted reverse proxy IPs/CIDRs when ROOT_URI uses HTTPS`,
      );
    }
    if (tp?.length) {
      // Only accept forwarded headers from explicitly configured proxy addresses.
      app.getHttpAdapter().getInstance().set('trust proxy', tp);
    }

  }

  const developmentOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  const rootOrigin = new URL(rootUri).origin;
  const isDevelopment = nestConfigService.get<string>(ConfigKeys.NODE_ENV) === 'development';
  const corsOptions = {
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      const allowed =
        !origin || origin === rootOrigin || (isDevelopment && developmentOrigin.test(origin));
      callback(null, allowed);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  };
  app.enableCors(corsOptions);

  const sessionSecret = secrets.require(ConfigKeys.SESSION_SECRET);

  const pgPool = new Pool({
    host: nestConfigService.get<string>(ConfigKeys.DATABASE_HOST),
    port: nestConfigService.get<number>(ConfigKeys.DATABASE_PORT) ?? 5432,
    database: nestConfigService.get<string>(ConfigKeys.DATABASE_NAME),
    user: nestConfigService.get<string>(ConfigKeys.DATABASE_USER),
    password: secrets.require(ConfigKeys.DATABASE_PASSWORD),
  });
  const PgSession = connectPgSimple(session);

  app.use(
    session({
      // Honor Express's explicitly configured trusted-proxy list when deciding
      // whether a secure cookie can be sent. Setting proxy:false here would
      // ignore X-Forwarded-Proto even for the trusted HAProxy and suppress the
      // session cookie on HTTPS deployments that terminate TLS at the proxy.
      store: new PgSession({
        pool: pgPool,
        tableName: 'user_sessions',
      }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: secureCookies,
        sameSite: secureCookies ? 'none' : 'lax',
        maxAge: Number(nestConfigService.get<string>(ConfigKeys.SESSION_TTL_MS) ?? 86_400_000),
      },
    }),
  );
  logger.log(`Session cookies configured as ${secureCookies ? 'secure HTTPS' : 'HTTP-compatible'}`);

  app.setGlobalPrefix(nestConfigService.get<string>(ConfigKeys.API_PREFIX) ?? 'api/v1');

  // Complete Nest initialization, including event subscriber registration,
  // before starting the database connection and opening the HTTP listener.
  await app.init();
  logger.log('Initialization is done. Start App');
  await app.get(DatabaseConnectionService).start();
  await app.get(DatabaseMigrationService).waitUntilInitialized();
  await app.listen(Number(nestConfigService.get<string>(ConfigKeys.API_PORT) ?? 3000));

  void app
    .get(AuthenticationService)
    .ensureBootstrapAdmin()
    .catch((error: unknown) => {
      logger.error(
        `Bootstrap administrator initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
}

void bootstrap().catch((error: unknown) => {
  mainlogger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
