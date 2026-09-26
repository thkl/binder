import { Module } from '@nestjs/common';
import { DocumentStoreModule } from './document.store.module';
import { DocumentService } from './service/document.service';
import { DocumentStorageService } from './service/document-storage.service';

@Module({
  imports: [DocumentStoreModule],
  providers: [DocumentService, DocumentStorageService],
  exports: [DocumentService]
})
export class DocumentServiceModule {}

