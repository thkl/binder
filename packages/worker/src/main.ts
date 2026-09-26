import 'dotenv/config';
import { logger } from './logger.js';
import { config, loadRuntimeConfiguration } from './config.js';
import { sequelize } from './database.js';
import { requestShutdown, startPipelineWorker } from './pipeline-worker.js';

async function main(): Promise<void> {
  await sequelize.authenticate();
  await loadRuntimeConfiguration();
  logger.info('Pipeline worker runtime configuration loaded', {
    storageRoot: config.storageRoot,
    ocrLanguages: config.ocrLanguages,
    pollIntervalMs: config.pollIntervalMs,
    lockTimeoutMs: config.lockTimeoutMs,
    reconcileIntervalMs: config.reconcileIntervalMs,
    embeddingsEnabled: config.embeddings.enabled
  });
  await startPipelineWorker();
}

function shutdown(signal: string): void {
  requestShutdown();
  logger.info('Pipeline worker stopping', { signal });
  void sequelize.close().then(() => process.exit(0));
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
void main().catch((error) => {
  logger.error('Pipeline worker stopped unexpectedly', { error });
  void sequelize.close().finally(() => process.exit(1));
});
