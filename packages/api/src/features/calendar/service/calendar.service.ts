import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CalendarEvent,
  CalendarEventListResponse,
  CalendarEventListResponseSchema,
  CalendarEventSchema,
} from '@binder/common';
import { BinderConfig, ConfigKeys } from '../../../shared/config/config.keys';
import { BinderLogger } from '../../../shared/service/logger.helper';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';
import { DocumentStore } from '../../document/store/document.store';
import { MetadataService } from '../../metadata/service/metadata.service';
import { CalendarEventStore } from '../store/calendar-event.store';

@Injectable()
export class CalendarService {
  private readonly logger = new BinderLogger(CalendarService.name);

  constructor(
    private readonly events: CalendarEventStore,
    private readonly documents: DocumentStore,
    private readonly metadata: MetadataService,
    private readonly settings: ApplicationSettingsService,
    private readonly config: ConfigService<BinderConfig>,
  ) {}

  async list(ownerUuid: string): Promise<CalendarEventListResponse> {
    const events = await this.events.findOwned(ownerUuid);
    return CalendarEventListResponseSchema.parse({
      items: events.map((event) => this.toResponse(event)),
    });
  }

  async get(ownerUuid: string, documentUuid: string): Promise<CalendarEvent | null> {
    const document = await this.documents.findOwnedByUuid(ownerUuid, documentUuid);
    if (!document) throw new NotFoundException('Document not found');

    const event = await this.events.findOwnedByDocument(ownerUuid, documentUuid);
    return event ? this.toResponse(event) : null;
  }

  async synchronizeFromUser(
    ownerUuid: string,
    documentUuid: string,
  ): Promise<CalendarEvent | null> {
    if (!(await this.isEnabled())) {
      throw new ConflictException('Calendar integration is disabled');
    }

    return this.synchronizeEnabledDocument(ownerUuid, documentUuid);
  }

  async synchronizeFromPlugin(ownerUuid: string, documentUuid: string): Promise<void> {
    if (!(await this.isEnabled())) return;

    await this.synchronizeEnabledDocument(ownerUuid, documentUuid);
  }

  async download(ownerUuid: string, documentUuid: string) {
    const event = await this.events.findOwnedByDocument(ownerUuid, documentUuid);
    if (!event) throw new NotFoundException('No calendar event exists for this document');

    const title = this.sanitizeFilename(event.title);
    return {
      filename: `${title}.ics`,
      content: this.toIcs(event),
    };
  }

  async hasEvents(ownerUuid: string, documentUuids: string[]): Promise<Set<string>> {
    return this.events.findOwnedDocumentUuids(ownerUuid, documentUuids);
  }

  calendarUrl(documentUuid: string): string {
    const apiPrefix = this.config.get<string>(ConfigKeys.API_PREFIX) ?? 'api/v1';
    return `/${apiPrefix}/calendar/documents/${documentUuid}/ics`;
  }

  private async synchronizeEnabledDocument(
    ownerUuid: string,
    documentUuid: string,
  ): Promise<CalendarEvent | null> {
    const document = await this.documents.findOwnedByUuid(ownerUuid, documentUuid);
    if (!document) throw new NotFoundException('Document not found');

    const existing = await this.events.findOwnedByDocument(ownerUuid, documentUuid);
    const metadata = await this.metadata.getDocumentMetadata(ownerUuid, documentUuid);
    const dueDateField =
      (await this.settings.get('calendar.dueDateField', 'dueDate'))?.trim() || 'dueDate';
    const dueDate = this.parseDueDate(metadata.custom[dueDateField]);

    if (!dueDate) {
      if (existing) {
        await this.events.removeForDocument(ownerUuid, documentUuid);
        this.logger.info('Removed calendar event because the due date is empty or invalid', {
          documentUuid,
          dueDateField,
        });
      }
      return null;
    }

    const title = (document.title?.trim() || document.originalFilename).slice(0, 255);
    const event = await this.events.upsertForDocument({
      documentUuid,
      ownerUuid,
      eventUid: `document-${documentUuid}@binder`,
      dueDate,
      title,
      description: `Binder document due date: ${dueDate}`,
    });

    this.logger.info('Calendar event synchronized', { documentUuid, dueDate });
    return this.toResponse(event);
  }

  private async isEnabled(): Promise<boolean> {
    return (await this.settings.get('calendar.enabled', 'false'))?.trim().toLowerCase() === 'true';
  }

  private parseDueDate(value: unknown): string | null {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
  }

  private toResponse(
    event: import('../models/calendar-event.entity').CalendarEvent,
  ): CalendarEvent {
    return CalendarEventSchema.parse({
      uuid: event.uuid,
      documentUuid: event.documentUuid,
      dueDate: event.dueDate,
      title: event.title,
      description: event.description,
      downloadUrl: this.calendarUrl(event.documentUuid),
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
    });
  }

  private toIcs(event: import('../models/calendar-event.entity').CalendarEvent): string {
    const endDate = this.addOneDay(event.dueDate);
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Binder//Document Calendar//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${event.eventUid}`,
      `DTSTAMP:${this.formatUtc(event.updatedAt)}`,
      `DTSTART;VALUE=DATE:${event.dueDate.replaceAll('-', '')}`,
      `DTEND;VALUE=DATE:${endDate.replaceAll('-', '')}`,
      `SUMMARY:${this.escapeIcsText(event.title)}`,
      `DESCRIPTION:${this.escapeIcsText(event.description)}`,
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    return `${lines.join('\r\n')}\r\n`;
  }

  private addOneDay(value: string): string {
    const date = new Date(`${value}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }

  private formatUtc(value: Date): string {
    return value
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');
  }

  private escapeIcsText(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/([,;])/g, '\\$1')
      .replace(/\r?\n/g, '\\n');
  }

  private sanitizeFilename(value: string): string {
    return (
      value
        .normalize('NFKC')
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/g, '') || 'binder-calendar-event'
    );
  }
}
