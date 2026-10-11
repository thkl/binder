import {
  type DocumentFormatCapability,
  type DocumentFormatDescriptor,
  type DocumentFormatId,
} from '@binder/common';
import { PdfDocumentFormatAdapter } from './pdf-document-format.adapter.js';
import { ImageDocumentFormatAdapter } from './image-document-format.adapter.js';

const pdfAdapter = new PdfDocumentFormatAdapter();
const imageAdapter = new ImageDocumentFormatAdapter();

/** Format metadata known to the worker build; processing operations stay local to worker adapters. */
export const WORKER_DOCUMENT_FORMATS: readonly DocumentFormatDescriptor[] =
  [pdfAdapter.descriptor, imageAdapter.descriptor];

/** Stable format identifiers the worker is built to process. */
export const WORKER_DOCUMENT_FORMAT_IDS: readonly DocumentFormatId[] =
  WORKER_DOCUMENT_FORMATS.map((format) => format.id);

export interface DetectedWorkerFormat {
  descriptor: DocumentFormatDescriptor;
  mimeType: string;
  extension: string;
}

/**
 * Selects the worker adapter for a stored canonical MIME type and required operation.
 *
 * @param {string} mimeType - Canonical MIME type stored with the document.
 * @param {DocumentFormatCapability} capability - Processing operation required by the job.
 * @returns The worker adapter registered for that format and capability.
 */
export function getWorkerDocumentFormatAdapter(
  mimeType: string,
  capability: DocumentFormatCapability,
): PdfDocumentFormatAdapter | ImageDocumentFormatAdapter {
  const descriptor = WORKER_DOCUMENT_FORMATS.find((format) => format.mimeTypes.includes(mimeType));
  if (!descriptor) throw new Error(`Worker does not support document format '${mimeType}'`);
  if (!descriptor.capabilities.includes(capability)) {
    throw new Error(`The ${descriptor.displayName} format does not support ${capability}`);
  }
  if (descriptor.id === imageAdapter.descriptor.id) return imageAdapter;
  if (descriptor.id !== pdfAdapter.descriptor.id) {
    throw new Error(`Worker has no adapter registered for the ${descriptor.displayName} format`);
  }
  return pdfAdapter;
}

/**
 * Identifies and validates imported bytes using the worker's registered formats.
 *
 * @param {Buffer} buffer - Full file contents supplied by an import source.
 * @returns The canonical shared descriptor for the validated file.
 */
export async function detectAndValidateWorkerFormat(
  buffer: Buffer,
): Promise<DetectedWorkerFormat> {
  if (buffer.length === 0) throw new Error('The uploaded document is empty');
  const header = buffer.subarray(0, Math.min(buffer.length, 1024));
  const descriptor = WORKER_DOCUMENT_FORMATS.find((format) => {
    if (format.id === 'pdf') return header.includes(Buffer.from('%PDF-'));
    if (format.id === 'image') {
      return (
        (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
        header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      );
    }
    return false;
  });
  if (!descriptor) throw new Error('The worker does not support this document format');

  const mimeType = buffer[0] === 0xff ? 'image/jpeg' : 'image/png';
  const canonicalMimeType = descriptor.id === 'pdf' ? descriptor.mimeTypes[0]! : mimeType;
  const adapter = getWorkerDocumentFormatAdapter(canonicalMimeType, 'upload');
  await adapter.validate(buffer, canonicalMimeType);
  return {
    descriptor,
    mimeType: canonicalMimeType,
    extension: descriptor.id === 'image' && canonicalMimeType === 'image/png'
      ? '.png'
      : descriptor.extensions[0]!,
  };
}
