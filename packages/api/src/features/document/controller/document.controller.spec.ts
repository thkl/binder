import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentController } from './document.controller.js';
import { createPdfFixture } from '../service/pdf-test-fixture.js';

const temporaryDirectories: string[] = [];

async function createUploadFile(contents = createPdfFixture(['Upload fixture'])) {
  const directory = await mkdtemp(join(tmpdir(), 'binder-api-controller-test-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'upload.pdf');
  await writeFile(path, contents);
  return { path, size: contents.length, mimetype: 'application/pdf', originalname: 'upload.pdf' };
}

function createController(upload: ReturnType<typeof vi.fn>) {
  return new DocumentController({ upload } as never, {} as never, {} as never, {} as never);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('document upload controller', () => {
  it('rejects a missing file without invoking the document service', async () => {
    const upload = vi.fn();
    const controller = createController(upload);

    await assert.rejects(
      controller.upload(undefined, { userId: 'owner-1' } as never),
      (error: unknown) =>
        error instanceof BadRequestException && /PDF file is required/.test(error.message),
    );
    expect(upload).not.toHaveBeenCalled();
  });

  it('passes the authenticated owner and uploaded file to the service then deletes the temp file', async () => {
    const upload = vi.fn().mockResolvedValue({ uuid: 'document-1' });
    const controller = createController(upload);
    const file = await createUploadFile();

    const response = await controller.upload(file, { userId: 'owner-1' } as never);

    expect(response).toEqual({ data: { uuid: 'document-1' } });
    expect(upload).toHaveBeenCalledWith('owner-1', file);
    await assert.rejects(readFile(file.path), { code: 'ENOENT' });
  });

  it('deletes the temporary upload even when document processing rejects it', async () => {
    const upload = vi.fn().mockRejectedValue(new BadRequestException('Unsupported document'));
    const controller = createController(upload);
    const file = await createUploadFile(Buffer.from('not a valid document'));

    await assert.rejects(
      controller.upload(file, { userId: 'owner-1' } as never),
      /Unsupported document/,
    );
    await assert.rejects(readFile(file.path), { code: 'ENOENT' });
  });
});
