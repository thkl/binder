import { Injectable, OnModuleInit } from '@nestjs/common';
import { PluginRegistryService } from '../../plugin/service/plugin-registry.service';
import { CalendarService } from './calendar.service';

const CALENDAR_EVENTS = new Set([
  'document.metadata-changed',
  'document.title-changed',
  'document.ai-suggestion-applied',
]);

@Injectable()
export class CalendarPluginService implements OnModuleInit {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly calendar: CalendarService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      manifest: {
        id: 'calendar',
        name: 'Calendar integration',
        version: '0.1.0',
        description: 'Creates iCalendar events from approved document due dates.',
        capabilities: ['document-events', 'calendar'],
        enabled: true,
      },
      onDocumentEvent: async (event) => {
        if (!CALENDAR_EVENTS.has(event.name)) return;
        await this.calendar.synchronizeFromPlugin(event.ownerUuid, event.documentUuid);
      },
    });
  }
}
