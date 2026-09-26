import { Module } from '@nestjs/common';
import { DocumentStoreModule } from './document.store.module';
import { DocumentService } from './service/document.service';
import { DocumentStorageService } from './service/document-storage.service';
import { PipelineServiceModule } from '../pipeline/pipeline.service.module';

@Module({
  imports: [DocumentStoreModule, PipelineServiceModule],
  providers: [DocumentService, DocumentStorageService],
  exports: [DocumentService]
})
export class DocumentServiceModule {}
