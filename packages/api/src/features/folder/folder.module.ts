import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { DocumentServiceModule } from '../document/document.service.module';
import { FolderController } from './controller/folder.controller';
import { FolderServiceModule } from './folder.service.module';
import { SharingServiceModule } from '../sharing/sharing.service.module';

@Module({
  imports: [FolderServiceModule, DocumentServiceModule, AuthenticationServiceModule, SharingServiceModule],
  controllers: [FolderController],
})
export class FolderModule {}
