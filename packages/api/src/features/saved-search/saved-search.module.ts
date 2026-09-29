import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { SavedSearchController } from './controller/saved-search.controller';
import { SavedSearchServiceModule } from './saved-search.service.module';

@Module({
  imports: [SavedSearchServiceModule, AuthenticationServiceModule],
  controllers: [SavedSearchController]
})
export class SavedSearchModule {}
