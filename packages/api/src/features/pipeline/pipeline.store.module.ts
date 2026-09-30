import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { PipelineJobEventStore } from './store/pipeline-job-event.store';
import { PipelineJobStore } from './store/pipeline-job.store';

@Module({
  imports: [DatabaseModule],
  providers: [PipelineJobStore, PipelineJobEventStore],
  exports: [PipelineJobStore, PipelineJobEventStore],
})
export class PipelineStoreModule {}
