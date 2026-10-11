import {
  DOCUMENT_FORMAT_CATALOG,
  type DocumentFormatCapability,
  type DocumentFormatDescriptor,
  type DocumentFormatId,
} from '@binder/common';
import { PdfDocumentFormatAdapter } from './pdf-document-format.adapter.js';

const pdfAdapter = new PdfDocumentFormatAdapter();

/** Format metadata known to the worker build; processing operations stay local to worker adapters. */
export const WORKER_DOCUMENT_FORMATS: readonly DocumentFormatDescriptor[] =
  DOCUMENT_FORMAT_CATALOG;

/** Stable format identifiers the worker is built to process. */
export const WORKER_DOCUMENT_FORMAT_IDS: readonly DocumentFormatId[] =
  WORKER_DOCUMENT_FORMATS.map((format) => format.id);

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
): PdfDocumentFormatAdapter {
  const descriptor = WORKER_DOCUMENT_FORMATS.find((format) => format.mimeTypes.includes(mimeType));
  if (!descriptor) throw new Error(`Worker does not support document format '${mimeType}'`);
  if (!descriptor.capabilities.includes(capability)) {
    throw new Error(`The ${descriptor.displayName} format does not support ${capability}`);
  }
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
): Promise<DocumentFormatDescriptor> {
  if (buffer.length === 0) throw new Error('The uploaded document is empty');
  const header = buffer.subarray(0, Math.min(buffer.length, 1024));
  const descriptor = WORKER_DOCUMENT_FORMATS.find(
    (format) => format.id === 'pdf' && header.includes(Buffer.from('%PDF-')),
  );
  if (!descriptor) throw new Error('The worker does not support this document format');

  const adapter = getWorkerDocumentFormatAdapter(descriptor.mimeTypes[0]!, 'upload');
  await adapter.validate(buffer);
  return descriptor;
}
