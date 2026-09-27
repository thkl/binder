import { Module } from '@nestjs/common';
import { DocumentStoreModule } from './document.store.module';
import { DocumentService } from './service/document.service';
import { DocumentStorageService } from './service/document-storage.service';
import { PipelineServiceModule } from '../pipeline/pipeline.service.module';
import { MetadataServiceModule } from '../metadata/metadata.service.module';
import { SharedModule } from '../../shared/shared.service.module';
import { SemanticSearchService } from './service/semantic-search.service';
import { TitleSuggestionService } from './service/title-suggestion.service';
import { IssuerServiceModule } from '../issuer/issuer.service.module';

@Module({
  imports: [DocumentStoreModule, PipelineServiceModule, MetadataServiceModule, IssuerServiceModule, SharedModule],
  providers: [DocumentService, DocumentStorageService, SemanticSearchService, TitleSuggestionService],
  exports: [DocumentService, TitleSuggestionService]
})
export class DocumentServiceModule {}
