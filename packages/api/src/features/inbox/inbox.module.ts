import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { InboxController } from './controller/inbox.controller';
import { InboxServiceModule } from './inbox.service.module';

@Module({
  imports: [InboxServiceModule, AuthenticationServiceModule],
  controllers: [InboxController],
})
export class InboxModule {}
