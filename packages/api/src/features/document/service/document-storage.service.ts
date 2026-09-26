import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createReadStream, ReadStream } from 'node:fs';
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { BinderConfig, ConfigKeys } from '../../../shared/config/config.keys';

export interface StoredDocumentFile {
  storageKey: string;
  absolutePath: string;
  checksumSha256: string;
  sizeBytes: number;
}

@Injectable()
export class DocumentStorageService {
  private readonly defaultMaxUploadBytes = 50 * 1024 * 1024;

  constructor(private readonly config: ConfigService<BinderConfig>) {}

  async storePdf(buffer: Buffer, uuid: string, originalFilename: string): Promise<StoredDocumentFile> {
    if (buffer.length === 0) {
      throw new BadRequestException('The uploaded document is empty');
    }

    const maxBytes = Number(this.config.get<string>(ConfigKeys.DOCUMENT_MAX_UPLOAD_BYTES)
      ?? this.defaultMaxUploadBytes);
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new Error(`${ConfigKeys.DOCUMENT_MAX_UPLOAD_BYTES} must be a positive integer`);
    }
    if (buffer.length > maxBytes) {
      throw new BadRequestException(`The document exceeds the maximum size of ${maxBytes} bytes`);
    }

    const root = this.getStorageRoot();
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const storageKey = `documents/${year}/${month}/${uuid}.pdf`;
    const absolutePath = this.resolveStoragePath(storageKey);
    const temporaryPath = join(root, 'tmp', `${uuid}.upload`);
    const checksumSha256 = createHash('sha256').update(buffer).digest('hex');

    await fs.mkdir(dirname(absolutePath), { recursive: true, mode: 0o750 });
    await fs.mkdir(dirname(temporaryPath), { recursive: true, mode: 0o750 });
    await fs.writeFile(temporaryPath, buffer, { mode: 0o640 });
    await fs.rename(temporaryPath, absolutePath);

    return { storageKey, absolutePath, checksumSha256, sizeBytes: buffer.length };
  }

  async remove(storageKey: string): Promise<void> {
    await fs.rm(this.resolveStoragePath(storageKey), { force: true });
  }

  openReadStream(storageKey: string): ReadStream {
    return createReadStream(this.resolveStoragePath(storageKey));
  }

  getStorageRoot(): string {
    const configuredRoot = this.config.get<string>(ConfigKeys.DOCUMENT_STORAGE_ROOT) ?? './storage';
    return isAbsolute(configuredRoot) ? configuredRoot : resolve(process.cwd(), configuredRoot);
  }

  private resolveStoragePath(storageKey: string): string {
    const root = this.getStorageRoot();
    const absolutePath = normalize(join(root, storageKey));
    const relativePath = relative(root, absolutePath);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new BadRequestException('Invalid document storage path');
    }
    return absolutePath;
  }
}

