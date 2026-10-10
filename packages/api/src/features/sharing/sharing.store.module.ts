import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { DocumentShare } from './models/document-share.entity';
import { FolderShare } from './models/folder-share.entity';
import { DocumentShareStore } from './store/document-share.store';
import { FolderShareStore } from './store/folder-share.store';

@Module({
  imports: [SequelizeModule.forFeature([DocumentShare, FolderShare])],
  providers: [DocumentShareStore, FolderShareStore],
  exports: [DocumentShareStore, FolderShareStore],
})
export class SharingStoreModule {}
