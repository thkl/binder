import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { CalendarEvent } from '../models/calendar-event.entity';

@Injectable()
export class CalendarEventStore extends BaseCrudStore<CalendarEvent> {
  constructor() {
    super(CalendarEvent);
    this.registerIdField('uuid');
  }

  findOwnedByDocument(ownerUuid: string, documentUuid: string): Promise<CalendarEvent | null> {
    return this.model.findOne({ where: { ownerUuid, documentUuid } });
  }

  async findOwnedDocumentUuids(ownerUuid: string, documentUuids: string[]): Promise<Set<string>> {
    if (documentUuids.length === 0) return new Set();

    const events = await this.model.findAll({
      attributes: ['documentUuid'],
      where: { ownerUuid, documentUuid: { [Op.in]: documentUuids } },
    });
    return new Set(events.map((event) => event.documentUuid));
  }

  findOwned(ownerUuid: string): Promise<CalendarEvent[]> {
    return this.model.findAll({
      where: { ownerUuid },
      order: [
        ['dueDate', 'ASC'],
        ['uuid', 'ASC'],
      ],
    });
  }

  async upsertForDocument(input: {
    documentUuid: string;
    ownerUuid: string;
    eventUid: string;
    dueDate: string;
    title: string;
    description: string;
  }): Promise<CalendarEvent> {
    const existing = await this.findOwnedByDocument(input.ownerUuid, input.documentUuid);
    if (existing) {
      await existing.update(input);
      return existing;
    }

    return this.model.create(input);
  }

  removeForDocument(ownerUuid: string, documentUuid: string): Promise<number> {
    return this.model.destroy({ where: { ownerUuid, documentUuid } });
  }
}
