import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { DocumentServiceModule } from '../document/document.service.module';
import { FolderController } from './controller/folder.controller';
import { FolderServiceModule } from './folder.service.module';

@Module({
  imports: [FolderServiceModule, DocumentServiceModule, AuthenticationServiceModule],
  controllers: [FolderController],
})
export class FolderModule {}
