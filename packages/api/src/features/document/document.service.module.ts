import { Module } from '@nestjs/common';
import { DocumentStoreModule } from './document.store.module';
import { DocumentService } from './service/document.service';
import { DocumentStorageService } from './service/document-storage.service';
import { PipelineServiceModule } from '../pipeline/pipeline.service.module';
import { MetadataServiceModule } from '../metadata/metadata.service.module';

@Module({
  imports: [DocumentStoreModule, PipelineServiceModule, MetadataServiceModule],
  providers: [DocumentService, DocumentStorageService],
  exports: [DocumentService]
})
export class DocumentServiceModule {}
