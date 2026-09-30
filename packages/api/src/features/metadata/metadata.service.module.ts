import { Module } from '@nestjs/common';
import { MetadataStoreModule } from './metadata.store.module';
import { MetadataService } from './service/metadata.service';
import { FolderServiceModule } from '../folder/folder.service.module';

@Module({
  imports: [MetadataStoreModule, FolderServiceModule],
  providers: [MetadataService],
  exports: [MetadataService],
})
export class MetadataServiceModule {}
