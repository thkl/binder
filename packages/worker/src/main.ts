import 'dotenv/config';
import { logger } from './logger.js';
import { config, loadRuntimeConfiguration } from './config.js';
import { sequelize } from './database.js';
import { requestShutdown, startPipelineWorker } from './pipeline-worker.js';
import { maintenanceScheduler } from './maintenance.js';

async function main(): Promise<void> {
  await sequelize.authenticate();
  await loadRuntimeConfiguration();
  await maintenanceScheduler.start();
  logger.info('Pipeline worker runtime configuration loaded', {
    storageRoot: config.storageRoot,
    ocrLanguages: config.ocrLanguages,
    pollIntervalMs: config.pollIntervalMs,
    lockTimeoutMs: config.lockTimeoutMs,
    reconcileIntervalMs: config.reconcileIntervalMs,
    maxUploadBytes: config.maxUploadBytes,
    inbox: config.inbox,
    embeddingsEnabled: config.embeddings.enabled,
    malwareScan: {
      required: config.malwareScan.required,
      command: config.malwareScan.command,
      timeoutMs: config.malwareScan.timeoutMs
    }
  });
  await startPipelineWorker();
}

async function shutdown(signal: string): Promise<void> {
  requestShutdown();
  logger.info('Pipeline worker stopping', { signal });
  await maintenanceScheduler.stop();
  await sequelize.close();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
void main().catch((error) => {
  logger.error('Pipeline worker stopped unexpectedly', { error });
  void maintenanceScheduler.stop().finally(() => {
    void sequelize.close().finally(() => process.exit(1));
  });
});
