import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { LogsController } from './controller/logs.controller';
import { LogsServiceModule } from './logs.service.module';

@Module({
  imports: [LogsServiceModule, AuthenticationServiceModule],
  controllers: [LogsController]
})
export class LogsModule {}
