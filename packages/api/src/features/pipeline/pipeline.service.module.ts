import { Module } from '@nestjs/common';
import { PipelineStoreModule } from './pipeline.store.module';
import { PipelineService } from './service/pipeline.service';
import { DocumentStoreModule } from '../document/document.store.module';

@Module({
  imports: [PipelineStoreModule, DocumentStoreModule],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineServiceModule {}
