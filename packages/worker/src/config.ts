import { createDecipheriv } from 'node:crypto';
import { hostname } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { Op } from 'sequelize';
import { ApplicationSetting } from './models.js';
import { logger } from './logger.js';

export interface WorkerConfig {
  storageRoot: string; ocrLanguages: string; workerId: string;
  pollIntervalMs: number; lockTimeoutMs: number; reconcileIntervalMs: number;
  embeddings: { enabled: boolean; provider: string; endpoint: string; model: string; apiKey: string; chunkSize: number; chunkOverlap: number };
}

export const config: WorkerConfig = {
  storageRoot: getDefaultStorageRoot(), ocrLanguages: 'deu+eng',
  workerId: process.env.PIPELINE_WORKER_ID ?? `${hostname()}-${process.pid}`,
  pollIntervalMs: 2_000, lockTimeoutMs: 15 * 60 * 1_000, reconcileIntervalMs: 30_000,
  embeddings: { enabled: false, provider: 'openai-compatible', endpoint: 'https://api.openai.com/v1/embeddings', model: 'text-embedding-3-small', apiKey: '', chunkSize: 1200, chunkOverlap: 200 }
};

export async function loadRuntimeConfiguration(): Promise<void> {
  const keys = ['documents.storageRoot', 'pipeline.ocrLanguages', 'pipeline.pollIntervalMs', 'pipeline.lockTimeoutMs', 'pipeline.reconcileIntervalMs',
    'embeddings.enabled', 'embeddings.endpoint', 'embeddings.model', 'embeddings.chunkSize', 'embeddings.chunkOverlap',
    'ai.provider', 'ai.apiKey', 'embeddings.provider', 'embeddings.apiKey'];
  const settings = await ApplicationSetting.findAll({ where: { key: { [Op.in]: keys } } });
  const values = new Map(settings.map((setting) => [setting.key, setting]));
  const appRoot = process.env.APP_ROOT_PATH ?? process.cwd();
  const storage = values.get('documents.storageRoot')?.value ?? join(appRoot, 'storage');
  config.storageRoot = isAbsolute(storage) ? storage : resolve(appRoot, storage);
  const languages = values.get('pipeline.ocrLanguages')?.value;
  if (languages && /^[a-z]{3}(?:\+[a-z]{3})*$/.test(languages)) config.ocrLanguages = languages;
  config.pollIntervalMs = readSettingInteger(values, 'pipeline.pollIntervalMs', config.pollIntervalMs);
  config.lockTimeoutMs = readSettingInteger(values, 'pipeline.lockTimeoutMs', config.lockTimeoutMs);
  config.reconcileIntervalMs = readSettingInteger(values, 'pipeline.reconcileIntervalMs', config.reconcileIntervalMs);
  config.embeddings.enabled = values.get('embeddings.enabled')?.value.toLowerCase() === 'true';
  config.embeddings.provider = values.get('ai.provider')?.value || values.get('embeddings.provider')?.value || config.embeddings.provider;
  config.embeddings.endpoint = values.get('embeddings.endpoint')?.value || config.embeddings.endpoint;
  config.embeddings.model = values.get('embeddings.model')?.value || config.embeddings.model;
  config.embeddings.chunkSize = readSettingInteger(values, 'embeddings.chunkSize', config.embeddings.chunkSize);
  config.embeddings.chunkOverlap = Math.min(readSettingInteger(values, 'embeddings.chunkOverlap', config.embeddings.chunkOverlap), config.embeddings.chunkSize - 1);
  const key = values.get('ai.apiKey')?.value ? values.get('ai.apiKey') : values.get('embeddings.apiKey');
  config.embeddings.apiKey = key?.isEncrypted && key.valueIv ? decryptSecret(key.value, key.valueIv) : (key?.value ?? '');
  if (config.embeddings.enabled && !config.embeddings.apiKey) logger.warn('Embeddings enabled but no API key is configured');
}

function decryptSecret(value: string, ivHex: string): string {
  const encoded = process.env.ENCRYPTION_KEY;
  if (!encoded) throw new Error('ENCRYPTION_KEY is required to decrypt embedding settings');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must decode to 32 bytes');
  const decipher = createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(value, 'base64')), decipher.final()]).toString('utf8');
}

function readSettingInteger(values: Map<string, ApplicationSetting>, key: string, fallback: number): number {
  const parsed = Number(values.get(key)?.value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function getDefaultStorageRoot(): string { return resolve(process.env.APP_ROOT_PATH ?? process.cwd(), 'storage'); }
export function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}
