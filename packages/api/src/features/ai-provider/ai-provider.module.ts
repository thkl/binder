import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { AiProviderServiceModule } from './ai-provider.service.module';
import { AiProviderController } from './controller/ai-provider.controller';

@Module({
  imports: [AiProviderServiceModule, AuthenticationServiceModule],
  controllers: [AiProviderController],
})
export class AiProviderModule {}
