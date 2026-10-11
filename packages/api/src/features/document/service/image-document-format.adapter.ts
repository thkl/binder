import { BadRequestException, Injectable } from '@nestjs/common';
import type { DocumentFormatDescriptor } from '@binder/common';
import { DocumentStorageService, type StoredDocumentFile } from './document-storage.service';

/** JPEG and PNG operations supported by the API's safe image handling path. */
@Injectable()
export class ImageDocumentFormatAdapter {
  readonly descriptor: DocumentFormatDescriptor = {
    id: 'image',
    displayName: 'Image',
    extensions: ['.jpg', '.jpeg', '.png'],
    mimeTypes: ['image/jpeg', 'image/png'],
    capabilities: ['upload', 'download', 'preview', 'text-extraction', 'ocr', 'page-count'],
  };

  constructor(private readonly storage: DocumentStorageService) {}

  validate(buffer: Buffer, mimeType?: string): Promise<void> {
    const detectedMimeType: 'image/jpeg' | 'image/png' =
      mimeType === 'image/png' || (!mimeType && buffer[0] !== 0xff) ? 'image/png' : 'image/jpeg';
    const validSignature =
      detectedMimeType === 'image/jpeg'
        ? buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
        : buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!validSignature) {
      throw new BadRequestException('The uploaded file does not match its detected image format');
    }
    return this.storage.validateImage(buffer, detectedMimeType);
  }

  storeOriginal(
    buffer: Buffer,
    uuid: string,
    _originalFilename: string,
    mimeType?: string,
  ): Promise<StoredDocumentFile> {
    return this.storage.storeImage(
      buffer,
      uuid,
      mimeType === 'image/png' || (!mimeType && buffer[0] === 0x89) ? '.png' : '.jpg',
    );
  }

  createPreview(storageKey: string, uuid: string, createdAt: Date): Promise<string> {
    const mimeType = storageKey.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    return this.storage.createImageThumbnail(storageKey, uuid, createdAt, mimeType);
  }

  split(_storageKey: string, _splitAfterPage: number): never {
    throw new BadRequestException('Image documents cannot be split');
  }

  rotatePage(
    _storageKey: string,
    _pageNumber: number,
    _rotationDegrees: -90 | 90 | 180,
  ): never {
    throw new BadRequestException('Image documents cannot be rotated through the page-rotation action');
  }

  compose(
    _targetStorageKey: string,
    _sources: Array<{ storageKey: string; startPage: number; endPage: number }>,
    _insertAfterPage: number,
  ): never {
    throw new BadRequestException('Image documents cannot be combined as PDFs');
  }

  createArchive(): never {
    throw new BadRequestException('Image documents do not support PDF/A archives');
  }
}
