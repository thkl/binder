import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AiProviderStore } from './store/ai-provider.store';

@Module({
  imports: [DatabaseModule],
  providers: [AiProviderStore],
  exports: [AiProviderStore],
})
export class AiProviderStoreModule {}
