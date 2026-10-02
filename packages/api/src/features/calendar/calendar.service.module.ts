import { Module } from '@nestjs/common';
import { SharedModule } from '../../shared/shared.service.module';
import { DocumentStoreModule } from '../document/document.store.module';
import { MetadataServiceModule } from '../metadata/metadata.service.module';
import { PluginServiceModule } from '../plugin/plugin.service.module';
import { CalendarStoreModule } from './calendar.store.module';
import { CalendarPluginService } from './service/calendar-plugin.service';
import { CalendarService } from './service/calendar.service';

@Module({
  imports: [
    CalendarStoreModule,
    DocumentStoreModule,
    MetadataServiceModule,
    PluginServiceModule,
    SharedModule,
  ],
  providers: [CalendarService, CalendarPluginService],
  exports: [CalendarService],
})
export class CalendarServiceModule {}
