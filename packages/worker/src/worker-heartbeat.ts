import { PipelineWorkerHeartbeat } from './models.js';
import { config } from './config.js';
import { logger } from './logger.js';

let heartbeatTimer: NodeJS.Timeout | undefined;
const startedAt = new Date();

export async function startWorkerHeartbeat(): Promise<void> {
  await writeHeartbeat();
  heartbeatTimer = setInterval(() => void writeHeartbeat(), 15_000);
}

export async function stopWorkerHeartbeat(): Promise<void> {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = undefined;
  await PipelineWorkerHeartbeat.destroy({ where: { workerId: config.workerId } }).catch(
    () => undefined,
  );
}

async function writeHeartbeat(): Promise<void> {
  try {
    await PipelineWorkerHeartbeat.upsert({
      workerId: config.workerId,
      lastSeenAt: new Date(),
      startedAt,
      version: process.env.APP_VERSION ?? 'unknown',
      capabilities: {
        ocrLanguages: config.ocrLanguages,
        malwareScanner: config.malwareScan.command,
        malwareScanRequired: config.malwareScan.required,
        pdfa: config.pdfa.enabled,
        embeddings: config.embeddings.enabled,
      },
    });
  } catch (error) {
    logger.warn('Unable to update pipeline worker heartbeat', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
