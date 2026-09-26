import { Module } from '@nestjs/common';
import { DocumentStoreModule } from './document.store.module';
import { DocumentService } from './service/document.service';
import { DocumentStorageService } from './service/document-storage.service';
import { PipelineServiceModule } from '../pipeline/pipeline.service.module';
import { MetadataServiceModule } from '../metadata/metadata.service.module';
import { SharedModule } from '../../shared/shared.service.module';
import { SemanticSearchService } from './service/semantic-search.service';

@Module({
  imports: [DocumentStoreModule, PipelineServiceModule, MetadataServiceModule, SharedModule],
  providers: [DocumentService, DocumentStorageService, SemanticSearchService],
  exports: [DocumentService]
})
export class DocumentServiceModule {}
