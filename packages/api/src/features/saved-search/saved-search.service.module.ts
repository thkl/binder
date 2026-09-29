import { Module } from '@nestjs/common';
import { SavedSearchStoreModule } from './saved-search.store.module';
import { SavedSearchService } from './service/saved-search.service';

@Module({
  imports: [SavedSearchStoreModule],
  providers: [SavedSearchService],
  exports: [SavedSearchService]
})
export class SavedSearchServiceModule {}
