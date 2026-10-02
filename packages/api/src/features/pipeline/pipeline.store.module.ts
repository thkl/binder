import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { PipelineJobEventStore } from './store/pipeline-job-event.store';
import { PipelineJobStore } from './store/pipeline-job.store';
import { PipelineWorkerHeartbeatStore } from './store/pipeline-worker-heartbeat.store';

@Module({
  imports: [DatabaseModule],
  providers: [PipelineJobStore, PipelineJobEventStore, PipelineWorkerHeartbeatStore],
  exports: [PipelineJobStore, PipelineJobEventStore, PipelineWorkerHeartbeatStore],
})
export class PipelineStoreModule {}
