import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import type { DocumentFormatDescriptor } from '@binder/common';
import { config } from './config.js';
import { requiresOcr } from './extraction.js';
import { resolveStoragePath, createImageThumbnail } from './storage.js';
import type { ExtractedDocumentText } from './pdf-document-format.adapter.js';
import type { OcrOptions } from './ocr.js';

/** JPEG and PNG worker operations: validation, cached previews, and OCR text extraction. */
export class ImageDocumentFormatAdapter {
  readonly descriptor: DocumentFormatDescriptor = {
    id: 'image',
    displayName: 'Image',
    extensions: ['.jpg', '.jpeg', '.png'],
    mimeTypes: ['image/jpeg', 'image/png'],
    capabilities: ['upload', 'download', 'preview', 'text-extraction', 'ocr', 'page-count'],
  };

  async validate(buffer: Buffer, mimeType?: string): Promise<void> {
    const detectedMimeType: 'image/jpeg' | 'image/png' =
      mimeType === 'image/png' || (!mimeType && buffer[0] !== 0xff) ? 'image/png' : 'image/jpeg';
    const validSignature = detectedMimeType === 'image/jpeg'
      ? buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
      : buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!validSignature) throw new Error('The file does not match its detected image format');

    const mupdf = await import('mupdf');
    let document: ReturnType<typeof mupdf.Document.openDocument>;
    try {
      document = mupdf.Document.openDocument(buffer, detectedMimeType);
    } catch {
      throw new Error('The file is not a valid JPEG or PNG image');
    }
    try {
      if (document.countPages() !== 1) throw new Error('An image document must contain one image');
      const page = document.loadPage(0);
      try {
        const bounds = page.getBounds();
        const width = Math.ceil((bounds[2] - bounds[0]) * (4 / 3));
        const height = Math.ceil((bounds[3] - bounds[1]) * (4 / 3));
        if (
          !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
          width < 1 || height < 1 || width > 20_000 || height > 20_000 ||
          width * height > 100_000_000
        ) {
          throw new Error('Image dimensions exceed the supported 20,000-pixel edge or 100-megapixel limit');
        }
      } finally {
        page.destroy();
      }
    } finally {
      document.destroy();
    }
  }

  async extractText(_storageKey: string): Promise<ExtractedDocumentText> {
    return { segments: [], pageCount: 1, text: '', requiresOcr: true };
  }

  createPreview(
    storageKey: string,
    documentUuid: string,
    createdAt: Date,
    mimeType?: string,
  ): Promise<void> {
    const detectedMimeType = mimeType === 'image/png' || (!mimeType && storageKey.endsWith('.png'))
      ? 'image/png'
      : 'image/jpeg';
    return createImageThumbnail(storageKey, documentUuid, createdAt, detectedMimeType);
  }

  async runOcr(
    storageKey: string,
    _documentUuid: string,
    _createdAt: Date,
    _options: OcrOptions = {},
  ): Promise<ExtractedDocumentText> {
    const text = await runTesseract(resolveStoragePath(storageKey), config.ocrLanguages);
    const normalized = text.replace(/\r\n?/gu, '\n').trim();
    // Tesseract exits successfully with empty output for valid images that
    // contain no readable text; that is a completed extraction, not a retry.
    const needsAnotherPass = normalized.length > 0 && requiresOcr(normalized);
    return {
      segments: normalized ? [{ segmentIndex: 1, pageNumber: 1, text: normalized }] : [],
      pageCount: 1,
      text: normalized,
      requiresOcr: needsAnotherPass,
    };
  }

  createArchive(): never {
    throw new Error('Images do not support PDF/A archives');
  }
}

/** Runs Tesseract directly on the validated source image without a shell. */
async function runTesseract(imagePath: string, languages: string): Promise<string> {
  await fs.access(imagePath);
  return new Promise((resolve, reject) => {
    const child = spawn('tesseract', [imagePath, 'stdout', '-l', languages], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('Tesseract timed out while processing the image'));
    }, 120_000);
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(stdout);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (Buffer.byteLength(stdout, 'utf8') > 4 * 1024 * 1024) {
        child.kill('SIGKILL');
        finish(new Error('Tesseract output exceeded the supported limit'));
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4000);
    });
    child.once('error', (error) => finish(new Error(`Unable to start Tesseract: ${error.message}`)));
    child.once('close', (code) => {
      if (code === 0) finish();
      else finish(new Error(`Tesseract failed: ${stderr.trim() || `exit code ${code ?? 'unknown'}`}`));
    });
  });
}
