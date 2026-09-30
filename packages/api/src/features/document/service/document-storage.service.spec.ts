import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import test from 'node:test';
import { DocumentStorageService } from './document-storage.service.js';
import type { ApplicationSettingsService } from '../../settings/service/application-settings.service.js';

function storage(): DocumentStorageService {
  return new DocumentStorageService(
    { get: () => '/tmp/binder-test' } as never,
    { get: async () => '52428800' } as unknown as ApplicationSettingsService,
  );
}

test('rejects uploads without a PDF signature', async () => {
  await assert.rejects(
    storage().validatePdf(Buffer.from('this is not a PDF')),
    (error: unknown) =>
      error instanceof BadRequestException && /valid PDF signature/.test(error.message),
  );
});
