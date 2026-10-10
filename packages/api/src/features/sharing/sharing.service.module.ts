import { Module } from '@nestjs/common';
import { AuthenticationStoreModule } from '../authentication/authentication.store.module';
import { DocumentStoreModule } from '../document/document.store.module';
import { FolderStoreModule } from '../folder/folder.store.module';
import { SharingStoreModule } from './sharing.store.module';
import { SharingService } from './service/sharing.service';

@Module({
  imports: [AuthenticationStoreModule, DocumentStoreModule, FolderStoreModule, SharingStoreModule],
  providers: [SharingService],
  exports: [SharingService, SharingStoreModule],
})
export class SharingServiceModule {}
