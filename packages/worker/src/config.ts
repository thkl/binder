import { createDecipheriv } from 'node:crypto';
import { hostname } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { Op } from 'sequelize';
import { AiProviderProfile, ApplicationSetting } from './models.js';
import { logger } from './logger.js';

export interface WorkerConfig {
  storageRoot: string;
  ocrLanguages: string;
  ocrJobs: number;
  ocrRotatePages: boolean;
  ocrDeskew: boolean;
  workerId: string;
  pollIntervalMs: number;
  lockTimeoutMs: number;
  reconcileIntervalMs: number;
  maxUploadBytes: number;
  inbox: {
    enabled: boolean;
    path: string;
    importOwnerUuid: string;
    pollIntervalMs: number;
    stabilityMs: number;
    completionStage: 'import' | 'ai-analysis';
  };
  embeddings: {
    enabled: boolean;
    provider: string;
    endpoint: string;
    model: string;
    apiKey: string;
    chunkSize: number;
    chunkOverlap: number;
  };
  pdfa: {
    enabled: boolean;
  };
  malwareScan: { required: boolean; command: string; timeoutMs: number };
}

export const config: WorkerConfig = {
  storageRoot: getDefaultStorageRoot(),
  ocrLanguages: 'deu+eng',
  ocrJobs: 1,
  ocrRotatePages: true,
  ocrDeskew: false,
  workerId: process.env.PIPELINE_WORKER_ID ?? `${hostname()}-${process.pid}`,
  pollIntervalMs: 2_000,
  lockTimeoutMs: 15 * 60 * 1_000,
  reconcileIntervalMs: 30_000,
  maxUploadBytes: 50 * 1024 * 1024,
  inbox: {
    enabled: false,
    path: 'inbox',
    importOwnerUuid: '',
    pollIntervalMs: 5_000,
    stabilityMs: 2_000,
    completionStage: 'ai-analysis',
  },
  embeddings: {
    enabled: false,
    provider: 'openai-compatible',
    endpoint: 'https://api.openai.com/v1/embeddings',
    model: 'text-embedding-3-small',
    apiKey: '',
    chunkSize: 1200,
    chunkOverlap: 200,
  },
  pdfa: { enabled: false },
  malwareScan: { required: true, command: 'clamdscan', timeoutMs: 120_000 },
};

const RUNTIME_CONFIGURATION_POLL_INTERVAL_MS = 10_000;
let runtimeConfigurationFingerprint: string | null = null;
let runtimeConfigurationTimer: NodeJS.Timeout | undefined;
let runtimeConfigurationReloading = false;

export async function loadRuntimeConfiguration(): Promise<boolean> {
  const keys = [
    'documents.storageRoot',
    'documents.maxUploadBytes',
    'documents.pdfa.enabled',
    'pipeline.ocrLanguages',
    'pipeline.pollIntervalMs',
    'pipeline.lockTimeoutMs',
    'pipeline.reconcileIntervalMs',
    'inbox.enabled',
    'inbox.path',
    'inbox.importOwnerUuid',
    'inbox.pollIntervalMs',
    'inbox.stabilityMs',
    'inbox.completionStage',
    'pipeline.ocrJobs',
    'pipeline.ocrRotatePages',
    'pipeline.ocrDeskew',
    'security.malwareScan.required',
    'security.malwareScan.command',
    'security.malwareScan.timeoutMs',
    'embeddings.enabled',
    'embeddings.endpoint',
    'embeddings.model',
    'embeddings.chunkSize',
    'embeddings.chunkOverlap',
    'ai.provider',
    'ai.apiKey',
    'ai.embeddingProviderUuid',
    'embeddings.provider',
    'embeddings.apiKey',
  ];
  const settings = await ApplicationSetting.findAll({ where: { key: { [Op.in]: keys } } });
  const fingerprint = settings
    .map((setting) => `${setting.key}:${setting.value}:${setting.valueIv ?? ''}`)
    .sort()
    .join('|');
  if (runtimeConfigurationFingerprint === fingerprint) return false;

  const values = new Map(settings.map((setting) => [setting.key, setting]));
  const appRoot = process.env.APP_ROOT_PATH ?? process.cwd();
  const storage = values.get('documents.storageRoot')?.value ?? join(appRoot, 'storage');
  config.storageRoot = isAbsolute(storage) ? storage : resolve(appRoot, storage);
  config.maxUploadBytes = readSettingInteger(
    values,
    'documents.maxUploadBytes',
    config.maxUploadBytes,
  );
  config.pdfa.enabled = readSettingBoolean(values, 'documents.pdfa.enabled', config.pdfa.enabled);
  const languages = values.get('pipeline.ocrLanguages')?.value;
  if (languages && /^[a-z]{3}(?:\+[a-z]{3})*$/.test(languages)) config.ocrLanguages = languages;
  config.ocrJobs = readSettingInteger(values, 'pipeline.ocrJobs', config.ocrJobs);
  config.ocrRotatePages = readSettingBoolean(
    values,
    'pipeline.ocrRotatePages',
    config.ocrRotatePages,
  );
  config.ocrDeskew = readSettingBoolean(values, 'pipeline.ocrDeskew', config.ocrDeskew);
  config.pollIntervalMs = readSettingInteger(
    values,
    'pipeline.pollIntervalMs',
    config.pollIntervalMs,
  );
  config.lockTimeoutMs = readSettingInteger(values, 'pipeline.lockTimeoutMs', config.lockTimeoutMs);
  config.reconcileIntervalMs = readSettingInteger(
    values,
    'pipeline.reconcileIntervalMs',
    config.reconcileIntervalMs,
  );
  config.inbox.enabled = values.get('inbox.enabled')?.value.toLowerCase() === 'true';
  config.inbox.path = values.get('inbox.path')?.value?.trim() || config.inbox.path;
  config.inbox.importOwnerUuid = values.get('inbox.importOwnerUuid')?.value?.trim() || '';
  config.inbox.pollIntervalMs = readSettingInteger(
    values,
    'inbox.pollIntervalMs',
    config.inbox.pollIntervalMs,
  );
  config.inbox.stabilityMs = readSettingInteger(
    values,
    'inbox.stabilityMs',
    config.inbox.stabilityMs,
  );
  const completionStage = values.get('inbox.completionStage')?.value?.trim();
  if (completionStage === 'import' || completionStage === 'ai-analysis')
    config.inbox.completionStage = completionStage;
  config.malwareScan.required = readSettingBoolean(
    values,
    'security.malwareScan.required',
    config.malwareScan.required,
  );
  config.malwareScan.command =
    values.get('security.malwareScan.command')?.value?.trim() ?? config.malwareScan.command;
  config.malwareScan.timeoutMs = readSettingInteger(
    values,
    'security.malwareScan.timeoutMs',
    config.malwareScan.timeoutMs,
  );
  config.embeddings.enabled = values.get('embeddings.enabled')?.value.toLowerCase() === 'true';
  config.embeddings.provider =
    values.get('ai.provider')?.value ||
    values.get('embeddings.provider')?.value ||
    config.embeddings.provider;
  config.embeddings.endpoint =
    values.get('embeddings.endpoint')?.value || config.embeddings.endpoint;
  config.embeddings.model = values.get('embeddings.model')?.value || config.embeddings.model;
  config.embeddings.chunkSize = readSettingInteger(
    values,
    'embeddings.chunkSize',
    config.embeddings.chunkSize,
  );
  config.embeddings.chunkOverlap = Math.min(
    readSettingInteger(values, 'embeddings.chunkOverlap', config.embeddings.chunkOverlap),
    config.embeddings.chunkSize - 1,
  );
  const selectedEmbeddingProviderUuid = values.get('ai.embeddingProviderUuid')?.value?.trim();
  const selectedEmbeddingProvider = selectedEmbeddingProviderUuid
    ? await AiProviderProfile.findByPk(selectedEmbeddingProviderUuid)
    : null;

  if (selectedEmbeddingProvider?.enabled) {
    config.embeddings.provider = selectedEmbeddingProvider.providerType;
    config.embeddings.endpoint = selectedEmbeddingProvider.embeddingEndpoint ?? '';
    config.embeddings.model = selectedEmbeddingProvider.embeddingModel ?? '';
    config.embeddings.apiKey =
      selectedEmbeddingProvider.apiKey && selectedEmbeddingProvider.apiKeyIv
        ? decryptSettingSecret(selectedEmbeddingProvider.apiKey, selectedEmbeddingProvider.apiKeyIv)
        : '';
  } else {
    const key = values.get('ai.apiKey')?.value
      ? values.get('ai.apiKey')
      : values.get('embeddings.apiKey');
    config.embeddings.apiKey =
      key?.isEncrypted && key.valueIv
        ? decryptSettingSecret(key.value, key.valueIv)
        : (key?.value ?? '');
  }
  if (config.embeddings.enabled && !config.embeddings.apiKey)
    logger.warn('Embeddings enabled but no API key is configured');
  if (config.malwareScan.required && !config.malwareScan.command)
    logger.warn('Malware scanning is required but no scanner command is configured');

  runtimeConfigurationFingerprint = fingerprint;
  return true;
}

export function startRuntimeConfigurationReload(): void {
  if (runtimeConfigurationTimer) return;
  runtimeConfigurationTimer = setInterval(() => {
    if (runtimeConfigurationReloading) return;
    runtimeConfigurationReloading = true;
    void loadRuntimeConfiguration()
      .then((changed) => {
        if (changed) {
          logger.info('Pipeline worker runtime configuration reloaded', {
            ocrLanguages: config.ocrLanguages,
            ocrJobs: config.ocrJobs,
            ocrRotatePages: config.ocrRotatePages,
            ocrDeskew: config.ocrDeskew,
            malwareScanRequired: config.malwareScan.required,
            embeddingsEnabled: config.embeddings.enabled,
            pdfaEnabled: config.pdfa.enabled,
          });
        }
      })
      .catch((error: unknown) => {
        logger.warn('Unable to reload pipeline worker runtime configuration', {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        runtimeConfigurationReloading = false;
      });
  }, RUNTIME_CONFIGURATION_POLL_INTERVAL_MS);
}

export function stopRuntimeConfigurationReload(): void {
  if (runtimeConfigurationTimer) clearInterval(runtimeConfigurationTimer);
  runtimeConfigurationTimer = undefined;
  runtimeConfigurationReloading = false;
}

export function decryptSettingSecret(value: string, ivHex: string): string {
  const encoded = process.env.ENCRYPTION_KEY;
  if (!encoded) throw new Error('ENCRYPTION_KEY is required to decrypt embedding settings');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must decode to 32 bytes');
  const iv = Buffer.from(ivHex, 'hex');
  if (iv.length !== 12) throw new Error('Encrypted setting nonce must be 12 bytes');

  const [prefix, tagBase64, ciphertext] = value.split(':');
  if (prefix !== 'gcm' || !tagBase64) {
    throw new Error('Encrypted setting is not an AES-256-GCM value');
  }

  const authenticationTag = Buffer.from(tagBase64, 'base64');
  if (authenticationTag.length !== 16) {
    throw new Error('Encrypted setting authentication tag must be 16 bytes');
  }

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authenticationTag);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext ?? '', 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function readSettingInteger(
  values: Map<string, ApplicationSetting>,
  key: string,
  fallback: number,
): number {
  const parsed = Number(values.get(key)?.value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function readSettingBoolean(
  values: Map<string, ApplicationSetting>,
  key: string,
  fallback: boolean,
): boolean {
  const value = values.get(key)?.value?.trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}
function getDefaultStorageRoot(): string {
  return resolve(process.env.APP_ROOT_PATH ?? process.cwd(), 'storage');
}
export function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

export function readRequiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
