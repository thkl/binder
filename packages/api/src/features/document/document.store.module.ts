import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DocumentStore } from './store/document.store';
import { DocumentStorageIssueStore } from './store/document-storage-issue.store';
import { DocumentAnalysisSessionStore } from './store/document-analysis-session.store';

@Module({
  imports: [DatabaseModule],
  providers: [DocumentStore, DocumentStorageIssueStore, DocumentAnalysisSessionStore],
  exports: [DocumentStore, DocumentStorageIssueStore, DocumentAnalysisSessionStore],
})
export class DocumentStoreModule {}
