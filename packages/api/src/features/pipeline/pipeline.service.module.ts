import { Module } from '@nestjs/common';
import { PipelineStoreModule } from './pipeline.store.module';
import { PipelineService } from './service/pipeline.service';

@Module({
  imports: [PipelineStoreModule],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineServiceModule {}
