import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { MetadataController } from './controller/metadata.controller';
import { MetadataServiceModule } from './metadata.service.module';

@Module({
  imports: [MetadataServiceModule, AuthenticationServiceModule],
  controllers: [MetadataController],
})
export class MetadataModule {}
