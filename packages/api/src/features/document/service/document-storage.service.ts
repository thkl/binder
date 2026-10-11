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
    await this.assertUploadSize(buffer.length);

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

  async storeImage(
    buffer: Buffer,
    uuid: string,
    extension: '.jpg' | '.png',
  ): Promise<StoredDocumentFile> {
    await this.assertUploadSize(buffer.length);

    const root = await this.getStorageRoot();
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const storageKey = `documents/${year}/${month}/${uuid}${extension}`;
    const absolutePath = await this.resolveStoragePath(storageKey);
    const temporaryPath = join(root, 'tmp', `${uuid}.upload`);
    const checksumSha256 = createHash('sha256').update(buffer).digest('hex');

    await fs.mkdir(dirname(absolutePath), { recursive: true, mode: 0o750 });
    await fs.mkdir(dirname(temporaryPath), { recursive: true, mode: 0o750 });
    await fs.writeFile(temporaryPath, buffer, { mode: 0o640 });
    await fs.rename(temporaryPath, absolutePath);

    return { storageKey, absolutePath, checksumSha256, sizeBytes: buffer.length };
  }

  /**
   * Checks an upload size before document parsers inspect its contents.
   *
   * @param {number} sizeBytes - Number of bytes in the uploaded file.
   * @returns {Promise<void>} Resolves when the file is nonempty and within the configured limit.
   */
  async assertUploadSize(sizeBytes: number): Promise<void> {
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
      throw new BadRequestException('The uploaded document has an invalid size');
    }
    if (sizeBytes === 0) {
      throw new BadRequestException('The uploaded document is empty');
    }

    const maxBytes = Number(
      await this.settings.get('documents.maxUploadBytes', String(this.defaultMaxUploadBytes)),
    );
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new Error('documents.maxUploadBytes must be a positive integer');
    }
    if (sizeBytes > maxBytes) {
      throw new BadRequestException(`The document exceeds the maximum size of ${maxBytes} bytes`);
    }
  }

  async splitPdf(storageKey: string, splitAfterPage: number): Promise<[Buffer, Buffer]> {
    const sourceBuffer = await fs.readFile(await this.resolveStoragePath(storageKey));
    const mupdf = await import('mupdf');
    const source = new mupdf.PDFDocument(sourceBuffer);
    const pageCount = source.countPages();
    if (splitAfterPage < 1 || splitAfterPage >= pageCount) {
      source.destroy();
      throw new BadRequestException('The split must leave at least one page in each document');
    }

    const createPart = (start: number, end: number): Buffer => {
      const output = new mupdf.PDFDocument();
      for (let pageNumber = start; pageNumber < end; pageNumber += 1) {
        const page = source.loadPage(pageNumber);
        const bounds = page.getBounds();
        output.addPage(bounds, 0, null, new Uint8Array());
        output.graftPage(pageNumber - start, source, pageNumber);
        page.destroy();
      }
      const saved = output.saveToBuffer({ garbage: 4 });
      const result = Buffer.from(saved.asUint8Array());
      output.destroy();
      return result;
    };

    try {
      return [createPart(0, splitAfterPage), createPart(splitAfterPage, pageCount)];
    } finally {
      source.destroy();
    }
  }

  async rotatePdfPage(
    storageKey: string,
    pageNumber: number,
    rotationDegrees: -90 | 90 | 180,
  ): Promise<Buffer> {
    const sourceBuffer = await fs.readFile(await this.resolveStoragePath(storageKey));
    const mupdf = await import('mupdf');
    const source = new mupdf.PDFDocument(sourceBuffer);
    const pageCount = source.countPages();
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
      source.destroy();
      throw new BadRequestException(`The page number must be between 1 and ${pageCount}`);
    }

    const page = source.loadPage(pageNumber - 1);
    try {
      // /Rotate is an inheritable PDF page attribute expressed clockwise.
      // Read the effective value, then write a normalized override on this page.
      const pageObject = page.getObject();
      try {
        const inheritedRotation = pageObject.getInheritable('Rotate');
        try {
          const currentRotation = inheritedRotation.isNumber() ? inheritedRotation.asNumber() : 0;
          const nextRotation = (((currentRotation + rotationDegrees) % 360) + 360) % 360;
          pageObject.put('Rotate', nextRotation);
        } finally {
          inheritedRotation.destroy();
        }
      } finally {
        pageObject.destroy();
      }

      const saved = source.saveToBuffer({ garbage: 4 });
      return Buffer.from(saved.asUint8Array());
    } finally {
      page.destroy();
      source.destroy();
    }
  }

  async composePdf(
    targetStorageKey: string,
    sources: string | Array<{ storageKey: string; startPage: number; endPage: number }>,
    insertAfterPage: number,
  ): Promise<{ buffer: Buffer; pageCount: number }> {
    // Keep the original storage helper signature usable by internal callers
    // while the adapter passes explicit source page ranges.
    const sourceSelections = typeof sources === 'string'
      ? [{ storageKey: sources, startPage: 1, endPage: undefined }]
      : sources;
    const [targetBuffer, ...sourceBuffers] = await Promise.all([
      fs.readFile(await this.resolveStoragePath(targetStorageKey)),
      ...sourceSelections.map(async (source) => fs.readFile(await this.resolveStoragePath(source.storageKey))),
    ]);
    const mupdf = await import('mupdf');
    const target = new mupdf.PDFDocument(targetBuffer);
    const sourceDocuments = sourceBuffers.map((buffer) => new mupdf.PDFDocument(buffer));
    const targetPageCount = target.countPages();
    if (insertAfterPage < 0 || insertAfterPage > targetPageCount) {
      target.destroy();
      sourceDocuments.forEach((source) => source.destroy());
      throw new BadRequestException(
        `The insertion point must be between page 0 and page ${targetPageCount}`,
      );
    }

    const resolvedSelections = sourceSelections.map((source, index) => {
      const pageCount = sourceDocuments[index]!.countPages();
      const endPage = source.endPage ?? pageCount;
      if (source.startPage < 1 || endPage < source.startPage || endPage > pageCount) {
        target.destroy();
        sourceDocuments.forEach((document) => document.destroy());
        throw new BadRequestException(
          `The selected source page range must be between page 1 and page ${pageCount}`,
        );
      }
      return { ...source, endPage };
    });

    const output = new mupdf.PDFDocument();
    let outputPage = 0;
    const graftPages = (document: typeof target, start: number, end: number): void => {
      for (let pageNumber = start; pageNumber < end; pageNumber += 1) {
        const page = document.loadPage(pageNumber);
        const bounds = page.getBounds();
        output.addPage(bounds, 0, null, new Uint8Array());
        output.graftPage(outputPage, document, pageNumber);
        outputPage += 1;
        page.destroy();
      }
    };

    try {
      graftPages(target, 0, insertAfterPage);
      for (const [index, source] of resolvedSelections.entries()) {
        graftPages(sourceDocuments[index]!, source.startPage - 1, source.endPage);
      }
      graftPages(target, insertAfterPage, targetPageCount);
      const saved = output.saveToBuffer({ garbage: 4 });
      return { buffer: Buffer.from(saved.asUint8Array()), pageCount: outputPage };
    } finally {
      output.destroy();
      target.destroy();
      sourceDocuments.forEach((source) => source.destroy());
    }
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

  async validateImage(buffer: Buffer, mimeType: 'image/jpeg' | 'image/png'): Promise<void> {
    try {
      const mupdf = await import('mupdf');
      const document = mupdf.Document.openDocument(buffer, mimeType);
      try {
        if (document.countPages() !== 1) {
          throw new BadRequestException('An image document must contain exactly one image');
        }
        const page = document.loadPage(0);
        try {
          const bounds = page.getBounds();
          const width = Math.ceil((bounds[2] - bounds[0]) * (4 / 3));
          const height = Math.ceil((bounds[3] - bounds[1]) * (4 / 3));
          if (
            !Number.isSafeInteger(width) ||
            !Number.isSafeInteger(height) ||
            width < 1 ||
            height < 1 ||
            width > 20_000 ||
            height > 20_000 ||
            width * height > 100_000_000
          ) {
            throw new BadRequestException('The image dimensions exceed the supported limit');
          }
        } finally {
          page.destroy();
        }
      } finally {
        document.destroy();
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('The uploaded file is not a valid JPEG or PNG image');
    }
  }

  async createImageThumbnail(
    storageKey: string,
    uuid: string,
    createdAt: Date,
    mimeType: 'image/jpeg' | 'image/png',
  ): Promise<string> {
    const imageBuffer = await fs.readFile(await this.resolveStoragePath(storageKey));
    const thumbnailKey = `${this.derivedDirectory(uuid, createdAt)}/thumbnail.png`;
    const thumbnailPath = await this.resolveStoragePath(thumbnailKey);
    const temporaryPath = `${thumbnailPath}.${randomUUID()}.tmp`;
    const mupdf = await import('mupdf');
    const document = mupdf.Document.openDocument(imageBuffer, mimeType);

    try {
      const page = document.loadPage(0);
      try {
        const bounds = page.getBounds();
        const width = Math.max(1, bounds[2] - bounds[0]);
        const height = Math.max(1, bounds[3] - bounds[1]);
        const scale = Math.min(480 / width, 1280 / height);
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

  async createThumbnail(storageKey: string, uuid: string, createdAt = new Date()): Promise<string> {
    const pdfBuffer = await fs.readFile(await this.resolveStoragePath(storageKey));
    const thumbnailKey = `${this.derivedDirectory(uuid, createdAt)}/thumbnail.png`;
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

  async removeDerived(uuid: string, createdAt: Date): Promise<void> {
    await Promise.all(
      [this.derivedDirectory(uuid, createdAt), `derived/${uuid}`].map((key) =>
        this.resolveStoragePath(key).then((path) => fs.rm(path, { recursive: true, force: true })),
      ),
    );
  }

  private derivedDirectory(uuid: string, createdAt: Date): string {
    const year = createdAt.getUTCFullYear();
    const month = String(createdAt.getUTCMonth() + 1).padStart(2, '0');
    return `derived/${year}/${month}/${uuid}`;
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
