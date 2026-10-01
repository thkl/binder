import { Module } from '@nestjs/common';
import { SharedModule } from '../../shared/shared.service.module';
import { AiProviderStoreModule } from './ai-provider.store.module';
import { AiProviderService } from './service/ai-provider.service';

@Module({
  imports: [AiProviderStoreModule, SharedModule],
  providers: [AiProviderService],
  exports: [AiProviderService],
})
export class AiProviderServiceModule {}
