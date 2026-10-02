import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { CalendarEventStore } from './store/calendar-event.store';

@Module({
  imports: [DatabaseModule],
  providers: [CalendarEventStore],
  exports: [CalendarEventStore],
})
export class CalendarStoreModule {}
