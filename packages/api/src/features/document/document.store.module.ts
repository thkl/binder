import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DocumentStore } from './store/document.store';

@Module({
  imports: [DatabaseModule],
  providers: [DocumentStore],
  exports: [DocumentStore]
})
export class DocumentStoreModule {}

