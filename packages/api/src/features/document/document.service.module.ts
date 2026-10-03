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
import { DocumentChangeSetStoreModule } from './document-change-set.store.module';
import { DocumentBulkMetadataService } from './service/document-bulk-metadata.service';
import { CalendarStoreModule } from '../calendar/calendar.store.module';
import { ClassificationFeedbackServiceModule } from '../classification-feedback/classification-feedback.service.module';

@Module({
  imports: [
    DocumentStoreModule,
    FolderStoreModule,
    InboxStoreModule,
    AiProviderServiceModule,
    DocumentAuditServiceModule,
    DocumentChangeSetStoreModule,
    PipelineServiceModule,
    MetadataServiceModule,
    IssuerServiceModule,
    SharedModule,
    CalendarStoreModule,
    ClassificationFeedbackServiceModule,
  ],
  providers: [
    DocumentService,
    DocumentStorageService,
    SemanticSearchService,
    TitleSuggestionService,
    DocumentAnalysisService,
    DocumentBulkMetadataService,
  ],
  exports: [
    DocumentService,
    TitleSuggestionService,
    DocumentAnalysisService,
    DocumentAuditServiceModule,
    DocumentBulkMetadataService,
  ],
})
export class DocumentServiceModule {}
