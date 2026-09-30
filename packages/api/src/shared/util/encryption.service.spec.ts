import assert from 'node:assert/strict';
import test from 'node:test';
import { EncryptionService } from './encryption.service.js';

function service(): EncryptionService {
  const key = Buffer.alloc(32, 7).toString('base64');
  return new EncryptionService({
    get: () => key,
  } as never);
}

test('encrypts and decrypts values with AES-GCM', () => {
  const encryption = service();
  encryption.onModuleInit();

  const encrypted = encryption.encrypt('secret value');

  assert.match(encrypted.encrypted, /^gcm:[^:]+:[^:]+$/);
  assert.equal(encryption.decrypt(encrypted.encrypted, encrypted.iv), 'secret value');
});

test('rejects modified AES-GCM ciphertext', () => {
  const encryption = service();
  encryption.onModuleInit();

  const encrypted = encryption.encrypt('secret value');
  const [prefix, tag, ciphertext] = encrypted.encrypted.split(':');
  const modifiedTag = `${tag[0] === 'A' ? 'B' : 'A'}${tag.slice(1)}`;

  assert.throws(() => encryption.decrypt(`${prefix}:${modifiedTag}:${ciphertext}`, encrypted.iv));
});
