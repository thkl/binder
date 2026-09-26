import { Module } from '@nestjs/common';
import { DocumentStoreModule } from '../document/document.store.module';
import { DatabaseModule } from '../../database/database.module';
import { MetadataStore } from './store/metadata.store';

@Module({
  imports: [DatabaseModule, DocumentStoreModule],
  providers: [MetadataStore],
  exports: [MetadataStore]
})
export class MetadataStoreModule {}
