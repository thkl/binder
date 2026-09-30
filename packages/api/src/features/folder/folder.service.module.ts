import { Module } from '@nestjs/common';
import { DocumentStoreModule } from '../document/document.store.module';
import { FolderStoreModule } from './folder.store.module';
import { FolderService } from './service/folder.service';

@Module({
  imports: [FolderStoreModule, DocumentStoreModule],
  providers: [FolderService],
  exports: [FolderService, FolderStoreModule],
})
export class FolderServiceModule {}
