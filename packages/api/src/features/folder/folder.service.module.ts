import { Module } from '@nestjs/common';
import { DocumentStoreModule } from '../document/document.store.module';
import { FolderStoreModule } from './folder.store.module';
import { FolderService } from './service/folder.service';
import { DocumentAuditServiceModule } from '../document/document-audit.service.module';

@Module({
  imports: [FolderStoreModule, DocumentStoreModule, DocumentAuditServiceModule],
  providers: [FolderService],
  exports: [FolderService, FolderStoreModule],
})
export class FolderServiceModule {}
