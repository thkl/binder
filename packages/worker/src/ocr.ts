import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { logger } from './logger.js';
import { resolveStoragePath } from './storage.js';

export interface OcrOptions {
  forceOcr?: boolean;
}

export async function runOcr(
  storageKey: string,
  documentUuid: string,
  createdAt: Date,
  options: OcrOptions = {},
): Promise<string> {
  const input = resolveStoragePath(storageKey);
  const key = `derived/${createdAt.getUTCFullYear()}/${String(createdAt.getUTCMonth() + 1).padStart(2, '0')}/${documentUuid}/ocr.pdf`;
  const output = resolveStoragePath(key);
  const temporary = `${output}.${randomUUID()}.tmp.pdf`;
  const ocrMode = options.forceOcr ? 'force' : config.ocrDeskew ? 'skip-text' : 'redo';

  await fs.mkdir(dirname(output), { recursive: true, mode: 0o750 });
  logger.info('Starting OCR', {
    documentUuid,
    languages: config.ocrLanguages,
    jobs: config.ocrJobs,
    rotatePages: config.ocrRotatePages,
    deskew: config.ocrDeskew,
    ocrMode,
    input: storageKey,
    output: key,
  });

  try {
    await runExternalCommand(
      'ocrmypdf',
      buildOcrArguments(input, temporary, options),
      documentUuid,
    );
    await fs.rename(temporary, output);
    return key;
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

export function buildOcrArguments(
  input: string,
  output: string,
  options: OcrOptions = {},
): string[] {
  // OCRmyPDF cannot combine --redo-ocr with --deskew. In deskew mode, skip
  // pages that already have text so their content is not needlessly rasterized;
  // the pipeline retries with force OCR if the resulting text is still unusable.
  const ocrMode = options.forceOcr ? 'force' : config.ocrDeskew ? 'skip-text' : 'redo';
  return [
    '--jobs',
    String(config.ocrJobs),
    ocrMode === 'force' ? '--force-ocr' : ocrMode === 'skip-text' ? '--skip-text' : '--redo-ocr',
    ...(config.ocrRotatePages ? ['--rotate-pages'] : []),
    ...(config.ocrDeskew ? ['--deskew'] : []),
    '--language',
    config.ocrLanguages,
    '--output-type',
    'pdf',
    input,
    output,
  ];
}

export function runExternalCommand(
  command: string,
  args: string[],
  documentUuid: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4000);
    });
    child.stdout.on('data', (chunk) => {
      logger.debug('Document processing tool output', {
        documentUuid,
        output: chunk.toString('utf8').trim().slice(-1000),
      });
    });
    child.once('error', (error) => {
      reject(new Error(`Unable to start ${command}: ${error.message}`));
    });
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const reason =
        stderr.trim() ||
        `process exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}`;
      reject(new Error(`${command} failed: ${reason}`));
    });
  });
}
