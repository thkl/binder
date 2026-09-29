import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SavedSearchStore } from './store/saved-search.store';

@Module({
  imports: [DatabaseModule],
  providers: [SavedSearchStore],
  exports: [SavedSearchStore]
})
export class SavedSearchStoreModule {}
