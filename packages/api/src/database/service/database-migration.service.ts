import { Injectable } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { OnEvent } from '@nestjs/event-emitter';
import { DatabaseMigrator } from './database.migrator';
import { BinderLogger } from '../../shared/service/logger.helper';
import { ConfigService } from '@nestjs/config';
import { BinderConfig } from '../../shared/config/config.keys';

@Injectable()
export class DatabaseMigrationService {
  protected readonly logger = new BinderLogger(DatabaseMigrationService.name);
  private isInitialized = false;
  private readonly initializationPromise: Promise<void>;
  private resolveInitialization!: () => void;
  private rejectInitialization!: (error: Error) => void;

  constructor(
    private sequelize: Sequelize,
    private readonly configService: ConfigService<BinderConfig>,
  ) {
    this.initializationPromise = new Promise<void>((resolve, reject) => {
      this.resolveInitialization = resolve;
      this.rejectInitialization = reject;
    });
    this.logger.debug('DatabaseMigrationService initialized');
  }

  waitUntilInitialized(): Promise<void> {
    return this.initializationPromise;
  }

  /**
   * this will run when the database will emit a connected message
   * @returns
   */
  @OnEvent('database.connected')
  private async doInit(): Promise<void> {
    this.logger.debug('database connected event');
    //make sure we do not run after a reconnection so set a global flag
    if (this.isInitialized === true) {
      return;
    }
    try {
      if (this.configService.get<string>('DATABASE_AUTOMIGRATE') !== 'true') {
        this.logger.warn('DATABASE_AUTOMIGRATE is not enabled; running required migrations anyway');
      }
      if (!(await this.checkMigration())) {
        throw new Error('Database migrations could not be completed');
      }
      await this.verifyRequiredSchema();
      this.isInitialized = true;
      this.resolveInitialization();
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Database initialization failed: ${failure.message}`);
      this.rejectInitialization(failure);
      throw failure;
    }
  }

  private async verifyRequiredSchema(): Promise<void> {
    await this.repairRequiredSchema();
    const [rows] = await this.sequelize.query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'maintenance_requests' AND column_name = 'payload')
           OR (table_name = 'maintenance_runs' AND column_name = 'progress'))`,
    );
    const columns = new Set(
      (rows as Array<{ table_name: string; column_name: string }>).map(
        (row) => `${row.table_name}.${row.column_name}`,
      ),
    );
    const missing = ['maintenance_requests.payload', 'maintenance_runs.progress'].filter(
      (column) => !columns.has(column),
    );
    if (missing.length > 0) {
      throw new Error(`Required database schema is incomplete: ${missing.join(', ')}`);
    }
  }

  private async repairRequiredSchema(): Promise<void> {
    await this.sequelize.query(
      `ALTER TABLE maintenance_requests
         ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb`,
    );
    await this.sequelize.query(
      `ALTER TABLE maintenance_runs
         ADD COLUMN IF NOT EXISTS progress JSONB NOT NULL DEFAULT '[]'::jsonb`,
    );
    await this.sequelize.query(
      'ALTER TABLE maintenance_requests DROP CONSTRAINT IF EXISTS maintenance_requests_job_check',
    );
    await this.sequelize.query(
      `ALTER TABLE maintenance_requests
         ADD CONSTRAINT maintenance_requests_job_check
         CHECK (job_key IN ('backup', 'restore'))`,
    );
  }

  findMigrationpath(): string {
    const rootPath = this.configService.get<string>('APP_ROOT_PATH');
    if (!rootPath) {
      throw new Error('APP_ROOT_PATH is not set');
    }
    const migrationpath = path.join(rootPath, 'migrations');
    if (!fs.existsSync(migrationpath)) {
      this.logger.error('Database Migration Path is not set.');
    }
    return migrationpath;
  }

  findVersion(): Promise<boolean> {
    return new Promise(async (resolve) => {});
  }

  /**
   * this will check and perform the database migration
   * @returns
   */
  async checkMigration(): Promise<boolean> {
    this.logger.info('Running DB Migration Check');
    const migrationpath = this.findMigrationpath();

    if (!fs.existsSync(migrationpath)) {
      this.logger.info(`Migration Path ${migrationpath} not found. Skip DB Migration Check`);
      return false;
    }

    try {
      const migrator = new DatabaseMigrator(this.sequelize, migrationpath);
      await migrator.migrate();
      return true;
    } catch (error) {
      this.logger.error(error);
      this.logger.info('Please migrate manually');
      return false;
    }
  }
}
