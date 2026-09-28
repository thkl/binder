import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { FolderStore } from './store/folder.store';

@Module({
  imports: [DatabaseModule],
  providers: [FolderStore],
  exports: [FolderStore]
})
export class FolderStoreModule {}
