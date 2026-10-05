import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { DocumentServiceModule } from '../document/document.service.module';
import { McpController } from './mcp.controller';

@Module({
  imports: [AuthenticationServiceModule, DocumentServiceModule],
  controllers: [McpController],
})
export class McpModule {}
