import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { CalendarController } from './controller/calendar.controller';
import { CalendarServiceModule } from './calendar.service.module';

@Module({
  imports: [CalendarServiceModule, AuthenticationServiceModule],
  controllers: [CalendarController],
})
export class CalendarModule {}
