import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DocumentAuditActorType,
  DocumentAuditEvent,
  DocumentAuditEventType,
  DocumentAuditResponseSchema,
} from '@binder/common';
import { DocumentStore } from '../store/document.store';
import { DocumentAuditEventStore } from '../store/document-audit-event.store';
import { DocumentMetadataChangeSet } from '../models/document-metadata-change-set.entity';
import { Op } from 'sequelize';
import { PluginRegistryService } from '../../plugin/service/plugin-registry.service';

export interface RecordDocumentAuditInput {
  documentUuid: string;
  ownerUuid: string;
  actorUuid?: string | null;
  actorType: DocumentAuditActorType;
  eventType: DocumentAuditEventType;
  summary: string;
  details?: Record<string, unknown>;
  changeSetUuid?: string | null;
}

@Injectable()
export class DocumentAuditService {
  constructor(
    private readonly events: DocumentAuditEventStore,
    private readonly documents: DocumentStore,
    private readonly plugins: PluginRegistryService,
  ) {}

  async record(input: RecordDocumentAuditInput): Promise<DocumentAuditEvent> {
    const event = await this.events.create({
      uuid: undefined,
      documentUuid: input.documentUuid,
      ownerUuid: input.ownerUuid,
      actorUuid: input.actorUuid ?? null,
      actorType: input.actorType,
      eventType: input.eventType,
      summary: input.summary.slice(0, 500),
      details: this.safeDetails(input.details),
      changeSetUuid: input.changeSetUuid ?? null,
    });

    this.plugins.publishDocumentEvent({
      name: `document.${event.eventType}`,
      documentUuid: event.documentUuid,
      ownerUuid: event.ownerUuid,
      actorUuid: event.actorUuid,
      actorType: event.actorType,
      payload: {
        summary: event.summary,
        details: this.safeDetails(input.details),
      },
      occurredAt: event.createdAt.toISOString(),
    });

    return this.toResponse(event);
  }

  async list(ownerUuid: string, documentUuid: string, page: number, pageSize: number) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, documentUuid);
    if (!document) throw new NotFoundException('Document not found');

    const result = await this.events.findOwnedPage(ownerUuid, documentUuid, page, pageSize);
    const changeSetUuids = result.rows
      .map((event) => event.changeSetUuid)
      .filter((uuid): uuid is string => uuid !== null);
    const changeSets =
      changeSetUuids.length > 0
        ? await DocumentMetadataChangeSet.findAll({
            where: { ownerUuid, uuid: { [Op.in]: changeSetUuids } },
          })
        : [];
    const changeSetStatus = new Map(
      changeSets.map((changeSet) => [changeSet.uuid, changeSet.status]),
    );
    const totalPages = result.count === 0 ? 0 : Math.ceil(result.count / pageSize);

    return DocumentAuditResponseSchema.parse({
      items: result.rows.map((event) =>
        this.toResponse(
          event,
          event.changeSetUuid !== null && changeSetStatus.get(event.changeSetUuid) === 'applied',
        ),
      ),
      page,
      pageSize,
      total: result.count,
      totalPages,
      hasNext: page * pageSize < result.count,
      hasPrev: page > 1,
    });
  }

  private toResponse(
    event: import('../models/document-audit-event.entity').DocumentAuditEventEntity,
    changeSetApplied = false,
  ) {
    return {
      uuid: event.uuid,
      documentUuid: event.documentUuid,
      actorUuid: event.actorUuid,
      actorType: event.actorType,
      eventType: event.eventType,
      summary: event.summary,
      details: this.safeDetails(event.details),
      changeSetUuid: event.changeSetUuid,
      rollbackAvailable: changeSetApplied && event.details?.['action'] !== 'rollback',
      createdAt: event.createdAt.toISOString(),
    } satisfies DocumentAuditEvent;
  }

  private safeDetails(
    details: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> {
    if (!details) return {};

    const fields = details.fields;
    return {
      ...(Array.isArray(fields)
        ? {
            fields: fields
              .filter((field): field is string => typeof field === 'string')
              .slice(0, 50),
          }
        : {}),
      ...(typeof details.folderUuid === 'string' ? { folderUuid: details.folderUuid } : {}),
      ...(typeof details.jobKind === 'string' ? { jobKind: details.jobKind } : {}),
      ...(typeof details.action === 'string' ? { action: details.action } : {}),
      ...(typeof details.changeSetUuid === 'string'
        ? { changeSetUuid: details.changeSetUuid }
        : {}),
      ...(typeof details.feedbackUuid === 'string' ? { feedbackUuid: details.feedbackUuid } : {}),
      ...(typeof details.valueUuid === 'string' ? { valueUuid: details.valueUuid } : {}),
      ...(typeof details.previousValueUuid === 'string'
        ? { previousValueUuid: details.previousValueUuid }
        : {}),
      ...(typeof details.reason === 'string' ? { reason: details.reason.slice(0, 200) } : {}),
    };
  }
}
