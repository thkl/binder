import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { DocumentController } from './controller/document.controller';
import { DocumentServiceModule } from './document.service.module';

@Module({
  imports: [DocumentServiceModule, AuthenticationServiceModule],
  controllers: [DocumentController],
})
export class DocumentModule {}
