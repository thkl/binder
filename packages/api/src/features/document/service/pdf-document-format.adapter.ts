import { Injectable } from '@nestjs/common';
import { PDF_DOCUMENT_FORMAT } from '@binder/common';
import { DocumentStorageService, type StoredDocumentFile } from './document-storage.service';

/** PDF-specific operations implemented with the API's MuPDF storage helpers. */
@Injectable()
export class PdfDocumentFormatAdapter {
  readonly descriptor = PDF_DOCUMENT_FORMAT;

  constructor(private readonly storage: DocumentStorageService) {}

  validate(buffer: Buffer): Promise<void> {
    return this.storage.validatePdf(buffer);
  }

  storeOriginal(buffer: Buffer, uuid: string, originalFilename: string): Promise<StoredDocumentFile> {
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
    sourceStorageKey: string,
    insertAfterPage: number,
  ): Promise<{ buffer: Buffer; pageCount: number }> {
    return this.storage.composePdf(targetStorageKey, sourceStorageKey, insertAfterPage);
  }

  createPreview(storageKey: string, uuid: string, createdAt: Date): Promise<string> {
    return this.storage.createThumbnail(storageKey, uuid, createdAt);
  }
}
