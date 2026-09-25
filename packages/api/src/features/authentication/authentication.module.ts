import { Module } from '@nestjs/common';
import { AuthenticationController } from './authentication.controller';
import { AuthenticationServiceModule } from './authentication.service.module';

@Module({
  imports: [AuthenticationServiceModule],
  controllers: [AuthenticationController]
})
export class AuthenticationModule {}
