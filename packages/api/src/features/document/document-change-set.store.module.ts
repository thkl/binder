import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DocumentMetadataChangeSetStore } from './store/document-metadata-change-set.store';

@Module({
  imports: [DatabaseModule],
  providers: [DocumentMetadataChangeSetStore],
  exports: [DocumentMetadataChangeSetStore],
})
export class DocumentChangeSetStoreModule {}
