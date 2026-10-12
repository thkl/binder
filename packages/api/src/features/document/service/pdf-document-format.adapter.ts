import { Injectable } from '@nestjs/common';
import type { DocumentFormatDescriptor } from '@binder/common';
import { DocumentStorageService, type StoredDocumentFile } from './document-storage.service';

/** PDF-specific operations implemented with the API's MuPDF storage helpers. */
@Injectable()
export class PdfDocumentFormatAdapter {
  readonly descriptor: DocumentFormatDescriptor = {
    id: 'pdf',
    displayName: 'PDF',
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
    capabilities: [
      'upload',
      'download',
      'preview',
      'text-extraction',
      'ocr',
      'file-analysis',
      'page-count',
      'page-rotation',
      'split',
      'compose',
      'pdfa',
    ],
  };

  constructor(private readonly storage: DocumentStorageService) {}

  validate(buffer: Buffer): Promise<void> {
    return this.storage.validatePdf(buffer);
  }

  storeOriginal(
    buffer: Buffer,
    uuid: string,
    originalFilename: string,
    _mimeType?: string,
  ): Promise<StoredDocumentFile> {
    return this.storage.storePdf(buffer, uuid, originalFilename);
  }

  split(storageKey: string, splitAfterPage: number): Promise<[Buffer, Buffer]> {
    return this.storage.splitPdf(storageKey, splitAfterPage);
  }

  rotatePage(
    storageKey: string,
    pageNumber: number,
    rotationDegrees: -90 | 90 | 180,
  ): Promise<Buffer> {
    return this.storage.rotatePdfPage(storageKey, pageNumber, rotationDegrees);
  }

  compose(
    targetStorageKey: string,
    sources: Array<{ storageKey: string; startPage: number; endPage: number }>,
    insertAfterPage: number,
  ): Promise<{ buffer: Buffer; pageCount: number }> {
    return this.storage.composePdf(targetStorageKey, sources, insertAfterPage);
  }

  createPreview(storageKey: string, uuid: string, createdAt: Date): Promise<string> {
    return this.storage.createThumbnail(storageKey, uuid, createdAt);
  }
}
