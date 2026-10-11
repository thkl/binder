import {
  DOCUMENT_FORMAT_CATALOG,
  type DocumentFormatCapability,
  type DocumentFormatDescriptor,
  type DocumentFormatId,
  type DocumentFormatsResponse,
} from '@binder/common';
import { BadRequestException, Injectable } from '@nestjs/common';
import { PdfDocumentFormatAdapter } from './pdf-document-format.adapter';

export interface DetectedDocumentFormat {
  formatId: DocumentFormatId;
  mimeType: string;
  extension: string;
}

/** Provides the format descriptors currently supported by this API build. */
@Injectable()
export class DocumentFormatRegistry {
  constructor(private readonly pdfAdapter: PdfDocumentFormatAdapter) {}

  /**
   * Returns a defensive copy of the descriptors advertised to authenticated clients.
   *
   * @returns {DocumentFormatsResponse} The formats supported by this API release.
   */
  getSupportedFormats(): DocumentFormatsResponse {
    return {
      formats: DOCUMENT_FORMAT_CATALOG.map((format): DocumentFormatDescriptor => ({
        ...format,
        extensions: [...format.extensions],
        mimeTypes: [...format.mimeTypes],
        capabilities: [...format.capabilities],
      })),
    };
  }

  /**
   * Detects a supported format from bytes and validates it with the format parser.
   *
   * Multipart MIME types and filenames are deliberately not consulted here;
   * callers persist the canonical metadata returned by this operation.
   *
   * @param {Buffer} buffer - Complete uploaded file contents.
   * @returns {Promise<DetectedDocumentFormat>} Canonical identity for validated content.
   */
  async detectAndValidate(buffer: Buffer): Promise<DetectedDocumentFormat> {
    if (buffer.length === 0) {
      throw new BadRequestException('The uploaded document is empty');
    }

    const header = buffer.subarray(0, Math.min(buffer.length, 1024));
    const pdfFormat = DOCUMENT_FORMAT_CATALOG.find((format) => format.id === 'pdf');
    if (!pdfFormat || !header.includes(Buffer.from('%PDF-'))) {
      throw new BadRequestException('The uploaded file format is not supported');
    }

    await this.pdfAdapter.validate(buffer);

    return {
      formatId: pdfFormat.id,
      mimeType: pdfFormat.mimeTypes[0]!,
      extension: pdfFormat.extensions[0]!,
    };
  }

  /**
   * Returns the adapter for a document MIME type after checking the requested capability.
   *
   * @param {string} mimeType - Canonical MIME type stored with the document.
   * @param {DocumentFormatCapability} capability - Operation required by the caller.
   * @returns The registered adapter that implements the requested operation.
   */
  getAdapterForMimeType(
    mimeType: string,
    capability: DocumentFormatCapability,
  ): PdfDocumentFormatAdapter {
    const descriptor = DOCUMENT_FORMAT_CATALOG.find((format) => format.mimeTypes.includes(mimeType));
    if (!descriptor) {
      throw new BadRequestException(`The document format '${mimeType}' is not supported`);
    }
    if (!descriptor.capabilities.includes(capability)) {
      throw new BadRequestException(
        `The ${descriptor.displayName} format does not support ${capability}`,
      );
    }
    if (descriptor.id !== this.pdfAdapter.descriptor.id) {
      throw new BadRequestException(`No adapter is registered for the ${descriptor.displayName} format`);
    }
    return this.pdfAdapter;
  }
}
