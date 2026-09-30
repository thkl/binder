import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { logger } from './logger.js';
import { resolveStoragePath } from './storage.js';
export async function runOcr(storageKey: string, documentUuid: string): Promise<string> {
  const input = resolveStoragePath(storageKey);
  const key = `derived/${documentUuid}/ocr.pdf`;
  const output = resolveStoragePath(key);
  const temporary = `${output}.${randomUUID()}.tmp.pdf`;

  await fs.mkdir(dirname(output), { recursive: true, mode: 0o750 });
  logger.info('Starting OCR', {
    documentUuid,
    languages: config.ocrLanguages,
    input: storageKey,
    output: key,
  });

  try {
    await runExternalCommand(
      'ocrmypdf',
      [
        '--force-ocr',
        '--rotate-pages',
        '--deskew',
        '--language',
        config.ocrLanguages,
        '--output-type',
        'pdf',
        input,
        temporary,
      ],
      documentUuid,
    );
    await fs.rename(temporary, output);
    return key;
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

function runExternalCommand(command: string, args: string[], documentUuid: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4000);
    });
    child.stdout.on('data', (chunk) => {
      logger.debug('OCR tool output', {
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
