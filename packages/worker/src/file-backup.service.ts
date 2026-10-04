import { execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { Encrypter } from 'age-encryption';
import { Op } from 'sequelize';
import { ApplicationSetting } from './models.js';
import { config, decryptSettingSecret, readRequiredEnvironment } from './config.js';
import { FileProviderFactory } from './file-provider/file-provider-factory.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

export interface FileBackupSettings {
  root: string;
  encryptionPassword: string;
  scope: 'database' | 'full';
  provider: string;
  remoteFolder: string;
}

export interface FileBackupResult {
  artifactName: string;
  sizeBytes: number;
  uploaded: boolean;
}

export class FileBackupService {
  constructor(private readonly providers = new FileProviderFactory()) {}

  async create(settings: FileBackupSettings): Promise<FileBackupResult> {
    logger.info('Starting backup', {
      scope: settings.scope,
      provider: settings.provider,
      backupRoot: settings.root,
      remoteFolder: settings.remoteFolder,
    });
    if (settings.provider !== 'none' && !settings.encryptionPassword) {
      throw new Error('External file providers require an encrypted backup password');
    }
    if (settings.scope === 'full' && !settings.encryptionPassword) {
      throw new Error('Full backups require an encrypted backup password');
    }
    await fs.mkdir(settings.root, { recursive: true, mode: 0o770 });
    const timestamp = this.timestamp(new Date());
    const dumpName = `binder-${timestamp}.dump`;
    const dumpPath = path.join(settings.root, `.${dumpName}.${process.pid}.tmp`);

    try {
      await this.createDatabaseDump(dumpPath);
      await fs.chmod(dumpPath, 0o660);
      if (!settings.encryptionPassword) {
        const artifactPath = path.join(settings.root, dumpName);
        await fs.rename(dumpPath, artifactPath);
        const sizeBytes = (await fs.stat(artifactPath)).size;
        await this.writeManifest(
          path.join(settings.root, `${dumpName}.json`),
          dumpName,
          sizeBytes,
          'pg_dump-custom',
        );
        logger.info('Database backup stored locally; external upload skipped', {
          artifactName: dumpName,
          provider: settings.provider,
        });
        return { artifactName: dumpName, sizeBytes, uploaded: false };
      }

      const encryptedName = dumpName.replace(/\.dump$/, '.tar.gz.age');
      const encryptedPath = path.join(settings.root, encryptedName);
      const bundleRoot = await fs.mkdtemp(path.join(settings.root, '.binder-bundle-'));
      try {
        await fs.rename(dumpPath, path.join(bundleRoot, 'database.dump'));
        await fs.writeFile(
          path.join(bundleRoot, 'manifest.json'),
          `${JSON.stringify(
            {
              format: 'age-encrypted-tar-gzip',
              version: 1,
              createdAt: new Date().toISOString(),
              database: readRequiredEnvironment('DATABASE_NAME'),
              applicationVersion: process.env.APP_VERSION ?? 'unknown',
              scope: settings.scope,
              includes:
                settings.scope === 'full'
                  ? ['database.dump', 'storage/']
                  : ['database.dump', 'manifest.json'],
            },
            null,
            2,
          )}\n`,
          { mode: 0o660 },
        );
        await this.encryptBundle(
          bundleRoot,
          encryptedPath,
          settings.encryptionPassword,
          settings.scope,
        );
      } finally {
        await fs.rm(bundleRoot, { recursive: true, force: true });
      }

      const sizeBytes = (await fs.stat(encryptedPath)).size;
      logger.info('Backup artifact created', {
        artifactName: encryptedName,
        sizeBytes,
        scope: settings.scope,
      });
      await this.writeManifest(
        path.join(settings.root, `${encryptedName}.json`),
        encryptedName,
        sizeBytes,
        'age-encrypted-tar-gzip',
      );
      const provider = await this.providers.create();
      if (!provider) {
        logger.warn('Skipping external backup upload: no provider is configured', {
          artifactName: encryptedName,
          configuredProvider: settings.provider,
        });
        return { artifactName: encryptedName, sizeBytes, uploaded: false };
      }
      const remotePath = `${settings.remoteFolder.replace(/\/$/, '')}/${encryptedName}`;
      logger.info('Uploading backup to external file provider', {
        artifactName: encryptedName,
        remotePath,
      });
      await provider.storeFile(encryptedPath, remotePath);
      logger.info('Backup uploaded to external file provider', {
        artifactName: encryptedName,
        remotePath,
      });
      return { artifactName: encryptedName, sizeBytes, uploaded: true };
    } catch (error) {
      await fs.rm(dumpPath, { force: true }).catch(() => undefined);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private async createDatabaseDump(targetPath: string): Promise<void> {
    const { stderr } = await execFileAsync(
      process.env.PG_DUMP_PATH ?? 'pg_dump',
      [
        '--format=custom',
        '--file',
        targetPath,
        '--host',
        readRequiredEnvironment('DATABASE_HOST'),
        '--port',
        String(process.env.DATABASE_PORT ?? 5432),
        '--username',
        readRequiredEnvironment('DATABASE_USER'),
        readRequiredEnvironment('DATABASE_NAME'),
      ],
      {
        env: { ...process.env, PGPASSWORD: readRequiredEnvironment('DATABASE_PASSWORD') },
        maxBuffer: 1024 * 1024,
      },
    );
    if (stderr.trim())
      logger.warn('pg_dump reported warnings', { stderr: stderr.trim().slice(0, 2000) });
  }

  private async encryptBundle(
    sourceRoot: string,
    targetPath: string,
    password: string,
    scope: 'database' | 'full',
  ): Promise<void> {
    const tarArgs = ['-czf', '-'];
    if (scope === 'full') {
      tarArgs.push('-C', path.dirname(config.storageRoot), path.basename(config.storageRoot));
    }
    tarArgs.push('-C', sourceRoot, 'database.dump', 'manifest.json');
    const tar = spawn('tar', tarArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    tar.stderr?.on('data', (chunk: Buffer) => {
      const message = chunk.toString().trim();
      if (message) logger.warn('Backup archive tool reported a warning', { message });
    });
    const tarExit = new Promise<void>((resolve, reject) => {
      tar.once('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`tar exited with code ${code}`)),
      );
      tar.once('error', reject);
    });
    const encrypter = new Encrypter();
    encrypter.setPassphrase(password);
    const tarStream = Readable.toWeb(tar.stdout!) as unknown as ReadableStream<Uint8Array>;
    const encryptedStream = await encrypter.encrypt(tarStream);
    await pipeline(
      Readable.fromWeb(encryptedStream as any),
      createWriteStream(targetPath, { mode: 0o660 }),
    );
    await tarExit;
  }

  private async writeManifest(
    target: string,
    artifactName: string,
    sizeBytes: number,
    format: string,
  ) {
    await fs.writeFile(
      target,
      `${JSON.stringify(
        {
          format,
          createdAt: new Date().toISOString(),
          database: readRequiredEnvironment('DATABASE_NAME'),
          applicationVersion: process.env.APP_VERSION ?? 'unknown',
          artifactName,
          sizeBytes,
        },
        null,
        2,
      )}\n`,
      { mode: 0o660 },
    );
  }

  static async loadSettings(): Promise<FileBackupSettings> {
    const rows = await ApplicationSetting.findAll({
      where: {
        key: {
          [Op.in]: [
            'backup.root',
            'backup.encryptionPassword',
            'backup.scope',
            'backup.provider',
            'backup.remoteFolder',
          ],
        },
      },
    });
    const values = new Map(
      rows.map((setting) => [
        setting.key,
        setting.isEncrypted && setting.valueIv
          ? decryptSettingSecret(setting.value, setting.valueIv)
          : setting.value,
      ]),
    );
    const root =
      values.get('backup.root')?.trim() ||
      path.resolve(process.env.APP_ROOT_PATH ?? process.cwd(), 'backup');
    return {
      root: path.isAbsolute(root)
        ? path.normalize(root)
        : path.resolve(process.env.APP_ROOT_PATH ?? process.cwd(), root),
      encryptionPassword: values.get('backup.encryptionPassword') ?? '',
      scope: values.get('backup.scope') === 'database' ? 'database' : 'full',
      provider: values.get('backup.provider')?.trim() || 'none',
      remoteFolder: values.get('backup.remoteFolder')?.trim() || '/Binder backups',
    };
  }

  private timestamp(date: Date): string {
    return date
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z')
      .replace('T', '-')
      .replace('Z', '');
  }
}
