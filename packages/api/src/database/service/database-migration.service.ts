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

  constructor(
    private sequelize: Sequelize,
    private readonly configService: ConfigService<BinderConfig>,
  ) {
    this.initializationPromise = new Promise<void>((resolve) => {
      this.resolveInitialization = resolve;
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
      const autoMigrate = this.configService.get<string>('DATABASE_AUTOMIGRATE');
      if (autoMigrate === 'true') {
        this.logger.info('DATABASE_AUTOMIGRATE is active. Checking Versions');
        await this.checkMigration();
      } else {
        this.logger.info('No DATABASE_AUTOMIGRATE set skipping migrations');
      }
    } finally {
      this.isInitialized = true;
      this.resolveInitialization();
    }
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
