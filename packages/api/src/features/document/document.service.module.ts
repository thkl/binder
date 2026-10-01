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
import { FolderStoreModule } from '../folder/folder.store.module';
import { InboxStoreModule } from '../inbox/inbox.store.module';
import { AiProviderServiceModule } from '../ai-provider/ai-provider.service.module';
import { DocumentAnalysisService } from './service/document-analysis.service';
import { DocumentAuditServiceModule } from './document-audit.service.module';

@Module({
  imports: [
    DocumentStoreModule,
    FolderStoreModule,
    InboxStoreModule,
    AiProviderServiceModule,
    DocumentAuditServiceModule,
    PipelineServiceModule,
    MetadataServiceModule,
    IssuerServiceModule,
    SharedModule,
  ],
  providers: [
    DocumentService,
    DocumentStorageService,
    SemanticSearchService,
    TitleSuggestionService,
    DocumentAnalysisService,
  ],
  exports: [
    DocumentService,
    TitleSuggestionService,
    DocumentAnalysisService,
    DocumentAuditServiceModule,
  ],
})
export class DocumentServiceModule {}
