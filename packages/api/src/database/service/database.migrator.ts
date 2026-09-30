/* eslint-disable @typescript-eslint/naming-convention */
import { Sequelize, QueryTypes, DataTypes, Model } from 'sequelize';
import * as fs from 'fs';
import * as path from 'path';
import { BinderLogger } from '../../shared/service/logger.helper';
import { SafePropertyAccess } from '../../shared/util/savepropertyaccess';

interface MigrationFile {
  version: number;
  filename: string;
  path: string;
}

// Define the version model
class DbVersion extends Model {
  declare version: number;
  declare applied_at: Date;
}

export class DatabaseMigrator {
  protected readonly logger = new BinderLogger(DatabaseMigrator.name);

  private sequelize: Sequelize;
  private migrationsDir: string;
  private versionTableName = 'db_version';
  private targetVersion: number;

  constructor(sequelize: Sequelize, migrationsDir: string) {
    this.sequelize = sequelize;
    this.migrationsDir = migrationsDir;

    // Get the target version based on available migration files
    this.targetVersion = this.getTargetVersion();
  }

  /**
   * Run migrations to bring the database up to the target version
   */
  public async migrate(): Promise<void> {
    try {
      this.logger.info('Starting database migration process...');

      // Ensure version table exists
      await this.ensureVersionTableExists();

      // Get current version
      let currentVersion: number | null = await this.getCurrentVersion();
      this.logger.info(`Current database version: ${currentVersion}`);
      this.logger.info(`Target database version: ${this.targetVersion}`);
      if (currentVersion === null || currentVersion === -1) {
        this.logger.info('Running FindVersion');
        currentVersion = await this.findVersion();
        if (currentVersion !== null) {
          await DbVersion.create({ version: currentVersion });
        }
      }
      this.logger.info(`Running CheckCurrentVersion ${currentVersion}`);
      // double check the version with tables
      const v = await this.checkCurrentVersion(currentVersion);
      this.logger.info(`checkCurrentVersion returned ${v}`);
      if (v < currentVersion) {
        currentVersion = v;
      }

      if (currentVersion === null || currentVersion === -1) {
        this.logger.info('Unable to detect current database version. Skip');
        return;
      }
      // do not migrate old stuff
      if (currentVersion >= this.targetVersion && this.targetVersion < 12) {
        this.logger.info('Database is already up to date.');
        return;
      }

      // Get migrations that need to be applied
      const pendingMigrations = await this.getPendingMigrations(currentVersion);

      if (pendingMigrations.length === 0) {
        this.logger.info('No migrations to apply.');
        return;
      }

      this.logger.info(`Found ${pendingMigrations.length} migrations to apply.`);

      // Apply migrations in a transaction
      const transaction = await this.sequelize.transaction();

      try {
        for (const migration of pendingMigrations) {
          this.logger.info(
            `Applying migration: ${migration.filename} (version ${migration.version})`,
          );

          // Read and execute the SQL file
          const sql = fs.readFileSync(migration.path, 'utf8');
          if (this.checkSafeInstructions(sql)) {
            const parts = sql.split('---');
            await Promise.all(
              parts.map(async (cmd) => {
                await this.sequelize.query(cmd, {
                  type: QueryTypes.RAW,
                  transaction,
                });
              }),
            );
            try {
              // Update the version number
              await this.updateVersion(migration.version, transaction);
              this.logger.info(`Successfully applied migration to version ${migration.version}`);
            } catch (e) {
              this.logger.error(e);
              this.logger.warn('Failed to save migration Version');
            }
          } else {
            this.logger.error(`unable to run migration unsafe sql detected in ${migration.path}`);
            throw new Error(`Migration failed: Unsafe SQL`);
          }
        }

        await transaction.commit();
        this.logger.info('Database migration completed successfully.');
      } catch (error) {
        const transactionState = (transaction as unknown as { finished?: string }).finished;
        if (!transactionState) {
          await transaction.rollback();
        }
        this.logger.error('Migration failed:', error);
        throw new Error(`Migration failed: ${(error as Error).message}`);
      }
    } catch (error) {
      this.logger.error('Migration process error:', error);
      throw error;
    }
  }

  private checkSafeInstructions(sql: string): boolean {
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      const lowered = stmt.toLocaleLowerCase();
      const safeConstraintDrop =
        /^alter\s+table\s+(?:"?[a-z_][a-z0-9_$]*"?\.)?"?[a-z_][a-z0-9_$]*"?\s+drop\s+constraint\s+(?:if\s+exists\s+)?"?[a-z_][a-z0-9_$]*"?$/i.test(
          stmt,
        );
      const destructiveStatement =
        /^(drop|truncate|delete|merge|exec|execute|backup|restore|grant|revoke|deny)\b/i.test(stmt);
      if (
        (destructiveStatement && !safeConstraintDrop) ||
        /\bsp_executesql\b/i.test(stmt) ||
        /\bcreate\s+or\s+replace\b/i.test(stmt)
      ) {
        return false;
      }

      // Replacing a named CHECK constraint requires dropping the old constraint
      // before adding the new one. This is safe DDL when restricted to a named
      // constraint; data-destructive DROP statements remain blocked above.
      if (lowered.includes('alter')) {
        if (safeConstraintDrop) {
          continue;
        }

        if (!/alter+\stable\s+\S+\s+(check|add)\s/i.test(stmt)) {
          return false;
        }
      }
    }
    return true;
  }

  async getVersion() {
    return await DbVersion.max('version');
  }

  /**
   * Ensure the version tracking table exists using Sequelize models
   */
  async ensureVersionTableExists(): Promise<void> {
    try {
      // Initialize the DbVersion model
      DbVersion.init(
        {
          version: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            allowNull: false,
          },
          applied_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
          },
        },
        {
          sequelize: this.sequelize,
          tableName: this.versionTableName,
          timestamps: false,
        },
      );

      // Sync the model with the database (creates the table if it doesn't exist)
      await DbVersion.sync();

      // Check if there are any records in the table
      const count = await DbVersion.count();

      // If the table is empty, insert the initial version 0
      if (count === 0) {
        this.logger.info('Try find the current version');
        const existingVersion = await this.findVersion();
        if (existingVersion > -1) {
          await DbVersion.create({ version: existingVersion || 0 });
          this.logger.info(`Initialized version table with version ${existingVersion || 0}.`);
        } else {
          this.logger.info(`Unable to predict version of db`);
        }
      }

      this.logger.info('Version table setup complete.');
    } catch (error) {
      this.logger.error('Error ensuring version table exists:', error);
      throw error;
    }
  }

  checkVersion(data: any, existingTables: string[], version2Check: number) {
    let detectedVersion = 0;
    const versions = Object.keys(data)
      .map(Number)
      .filter((version) => Number.isInteger(version) && version > 0)
      .sort((a, b) => a - b);

    for (const version of versions) {
      const versionData: any = SafePropertyAccess.get(data, String(version));
      const tablesToCheck = versionData?.created ?? versionData?.required ?? [];
      const hasAllTables = tablesToCheck.every((table: string) => existingTables.includes(table));

      if (!hasAllTables) {
        break;
      }

      detectedVersion = version;
    }

    this.logger.debug(`Detected database version ${detectedVersion}`);
    return detectedVersion;
  }

  /**
   * this will try to find the database version using a list of tables in the manifest file which were present by a specific version
   * of the database
   * @returns a promise which will return the version of the database which was fetched from tables
   */
  public findVersion(): Promise<number> {
    let dbVersion = 0;
    return new Promise(async (resolve) => {
      try {
        const manifest = path.join(this.migrationsDir, 'manifest.json');
        if (!fs.existsSync(manifest)) {
          resolve(0);
          return;
        }

        const mfData = JSON.parse(fs.readFileSync(manifest).toString());
        const data = mfData['migrations'];
        if (!data) {
          resolve(0);
          return;
        }

        this.logger.debug(`migration data found checking tables`);
        // query the SELECT * FROM sys.tables
        const existingTablesResult = await this.sequelize.query(
          "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename;",
          {
            type: QueryTypes.RAW,
          },
        );
        let existingTables: string[] = [];
        if (Array.isArray(existingTablesResult)) {
          this.logger.debug(`existing table List found`);
          existingTables = existingTablesResult[0].map((record: any) => record['tablename']);
        } else {
          this.logger.error(
            'unable to detemine the existing tables Migration is not possible here',
          );
          resolve(dbVersion);
          return;
        }
        if (existingTables.length === 0) {
          this.logger.error('looks likle there are no tables this is bad');
          resolve(dbVersion);
          return;
        }
        // filter the db_version
        if (existingTables.filter((tbl) => tbl !== 'db_version').length === 0) {
          resolve(0); // its a empty database
          return;
        }
        let completed = false;
        let version2Check = 1;
        while (!completed) {
          const versionData: any = SafePropertyAccess.get(data, String(version2Check));
          if (versionData) {
            let tables2Check = versionData['created'];
            if (!tables2Check) {
              tables2Check = versionData['required'];
            }
            if (tables2Check) {
              const hasAll = tables2Check.every((str: string) => existingTables.includes(str));
              if (!hasAll) {
                dbVersion = version2Check - 1;
                this.logger.debug(`Looks like we are on version ${version2Check - 1}`);
                completed = true;
                resolve(dbVersion);
              } else {
                version2Check = version2Check + 1;
              }
            } else {
              this.logger.debug(`${version2Check} : no tablesFound`);
              completed = true;
            }
          } else {
            completed = true;
            this.logger.debug(`Looks like we are on version ${version2Check - 1}`);
            resolve(version2Check - 1);
          }
        }
        resolve(version2Check);
      } catch (e) {
        this.logger.error('Unable to predict the current version. we should skip automigration');
        this.logger.error(e);
        resolve(dbVersion);
      }
    });
  }

  /**
   * Get the current database version
   */
  private async getCurrentVersion(): Promise<number> {
    return new Promise(async (resolve) => {
      try {
        // Use the model to  get the max version
        const maxVersion = await DbVersion.max('version');
        resolve(maxVersion as number);
      } catch (error) {
        this.logger.error('Error getting current version:', error);
        throw error;
      }
    });
  }

  private async checkCurrentVersion(version: number): Promise<number> {
    this.logger.debug(`checkCurrentVersion ${version}`);
    let result: any = version;
    //get the manifest and check if we have the tables specified in the manifest
    const manifest = path.join(this.migrationsDir, 'manifest.json');
    if (fs.existsSync(manifest)) {
      this.logger.debug('Manifest exists ...');
      const mfData = JSON.parse(fs.readFileSync(manifest).toString());
      const data = mfData['migrations'];
      if (data) {
        this.logger.debug('Migration List exists in manifest');
        const existingTablesResult = await this.sequelize.query(
          "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename",
          {
            type: QueryTypes.RAW,
          },
        );
        let existingTables = [];
        if (Array.isArray(existingTablesResult)) {
          this.logger.debug(`existing table List found`);
          existingTables = existingTablesResult[0].map((record: any) => record['tablename']);
          result = this.checkVersion(data, existingTables, version);
        } else {
          this.logger.debug('existingTablesResult is not an array');
        }
      }
    } else {
      this.logger.error(`manifest is missing at ${manifest}`);
    }
    return result;
  }

  /**
   * Update the database version
   */
  private async updateVersion(version: number, transaction: any): Promise<void> {
    this.logger.debug(`updateVersion ${version}`);
    const newRecord = { version };
    try {
      await DbVersion.create(newRecord, { transaction });
    } catch (e) {
      this.logger.error('Unable to save migration status');
      this.logger.error(e);
    }
  }

  async updateVersionWOT(version: number): Promise<void> {
    this.logger.debug(`updateVersionWOT ${version}`);
    await DbVersion.create({ version });
  }

  /**
   * Get all migrations that need to be applied
   */
  private async getPendingMigrations(currentVersion: number): Promise<MigrationFile[]> {
    const migrationFiles = this.getMigrationFiles();

    return migrationFiles
      .filter((migration) => migration.version > currentVersion)
      .sort((a, b) => a.version - b.version);
  }

  /**
   * Get all migration files from the migrations directory
   */
  private getMigrationFiles(): MigrationFile[] {
    try {
      const files = fs.readdirSync(this.migrationsDir);

      return files
        .filter((file) => file.endsWith('.sql'))
        .map((file) => {
          // Extract version from filename (e.g., "V1__create_users.sql" -> 1)
          const versionMatch = file.match(/^V(\d+)__/);
          if (!versionMatch) {
            throw new Error(
              `Invalid migration filename format: ${file}. Expected format: V<version>__<description>.sql`,
            );
          }

          const version = parseInt(versionMatch[1], 10);

          return {
            version,
            filename: file,
            path: path.join(this.migrationsDir, file),
          };
        });
    } catch (error) {
      this.logger.error('Error reading migration files:', error);
      throw error;
    }
  }

  /**
   * Get the target version based on available migration files
   */
  private getTargetVersion(): number {
    const migrations = this.getMigrationFiles();
    if (migrations.length === 0) {
      return 0;
    }

    return Math.max(...migrations.map((m) => m.version));
  }
}
