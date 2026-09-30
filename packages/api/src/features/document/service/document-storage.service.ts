import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createReadStream, ReadStream } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { BinderConfig, ConfigKeys } from '../../../shared/config/config.keys';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';

export interface StoredDocumentFile {
  storageKey: string;
  absolutePath: string;
  checksumSha256: string;
  sizeBytes: number;
}

@Injectable()
export class DocumentStorageService {
  private readonly defaultMaxUploadBytes = 50 * 1024 * 1024;
  private storageRoot: string | null = null;

  constructor(
    private readonly config: ConfigService<BinderConfig>,
    private readonly settings: ApplicationSettingsService,
  ) {}

  async storePdf(
    buffer: Buffer,
    uuid: string,
    originalFilename: string,
  ): Promise<StoredDocumentFile> {
    if (buffer.length === 0) {
      throw new BadRequestException('The uploaded document is empty');
    }

    const maxBytes = Number(
      await this.settings.get('documents.maxUploadBytes', String(this.defaultMaxUploadBytes)),
    );
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new Error('documents.maxUploadBytes must be a positive integer');
    }
    if (buffer.length > maxBytes) {
      throw new BadRequestException(`The document exceeds the maximum size of ${maxBytes} bytes`);
    }

    const root = await this.getStorageRoot();
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const storageKey = `documents/${year}/${month}/${uuid}.pdf`;
    const absolutePath = await this.resolveStoragePath(storageKey);
    const temporaryPath = join(root, 'tmp', `${uuid}.upload`);
    const checksumSha256 = createHash('sha256').update(buffer).digest('hex');

    await fs.mkdir(dirname(absolutePath), { recursive: true, mode: 0o750 });
    await fs.mkdir(dirname(temporaryPath), { recursive: true, mode: 0o750 });
    await fs.writeFile(temporaryPath, buffer, { mode: 0o640 });
    await fs.rename(temporaryPath, absolutePath);

    return { storageKey, absolutePath, checksumSha256, sizeBytes: buffer.length };
  }

  async validatePdf(buffer: Buffer): Promise<void> {
    const header = buffer.subarray(0, Math.min(buffer.length, 1024));
    if (!header.includes(Buffer.from('%PDF-'))) {
      throw new BadRequestException('The uploaded file does not contain a valid PDF signature');
    }

    try {
      const mupdf = await import('mupdf');
      const document = mupdf.Document.openDocument(buffer, 'application/pdf');
      try {
        if (document.countPages() < 1) {
          throw new BadRequestException('The uploaded PDF contains no pages');
        }
      } finally {
        document.destroy();
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('The uploaded file is not a valid PDF');
    }
  }

  async createThumbnail(storageKey: string, uuid: string): Promise<string> {
    const pdfBuffer = await fs.readFile(await this.resolveStoragePath(storageKey));
    const thumbnailKey = `derived/${uuid}/thumbnail.png`;
    const thumbnailPath = await this.resolveStoragePath(thumbnailKey);
    const temporaryPath = `${thumbnailPath}.${randomUUID()}.tmp`;
    const mupdf = await import('mupdf');
    const document = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');

    try {
      if (document.countPages() < 1) {
        throw new Error('PDF contains no pages');
      }

      const page = document.loadPage(0);
      try {
        const bounds = page.getBounds();
        const pageWidth = Math.max(1, bounds[2] - bounds[0]);
        const scale = 480 / pageWidth;
        const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB);
        try {
          await fs.mkdir(dirname(thumbnailPath), { recursive: true, mode: 0o750 });
          await fs.writeFile(temporaryPath, pixmap.asPNG(), { mode: 0o640 });
          await fs.rename(temporaryPath, thumbnailPath);
        } finally {
          pixmap.destroy();
        }
      } finally {
        page.destroy();
      }
    } finally {
      document.destroy();
    }

    return thumbnailKey;
  }

  async remove(storageKey: string): Promise<void> {
    await fs.rm(await this.resolveStoragePath(storageKey), { force: true });
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await fs.access(await this.resolveStoragePath(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  async openReadStream(storageKey: string): Promise<ReadStream> {
    return createReadStream(await this.resolveStoragePath(storageKey));
  }

  private async getStorageRoot(): Promise<string> {
    if (this.storageRoot) return this.storageRoot;
    const appRoot = this.config.get<string>(ConfigKeys.APP_ROOT_PATH) ?? process.cwd();
    const envStorageRoot = this.config.get<string>(ConfigKeys.DOCUMENT_STORAGE_ROOT);
    const configuredRoot =
      envStorageRoot ??
      (await this.settings.get('documents.storageRoot', join(appRoot, 'storage'))) ??
      join(appRoot, 'storage');
    this.storageRoot = isAbsolute(configuredRoot)
      ? configuredRoot
      : resolve(appRoot, configuredRoot);
    return this.storageRoot;
  }

  async resolveStoragePath(storageKey: string): Promise<string> {
    const root = await this.getStorageRoot();
    const absolutePath = normalize(join(root, storageKey));
    const relativePath = relative(root, absolutePath);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new BadRequestException('Invalid document storage path');
    }
    return absolutePath;
  }
}
