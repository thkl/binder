import { ConflictException, Injectable, MessageEvent, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable } from 'rxjs';
import {
  DocumentTitleSuggestion,
  DocumentTitleSuggestionSchema,
  InboxAiProcessResponseSchema,
  InboxQueueResponseSchema,
  InboxRemoveResponseSchema,
} from '@binder/common';
import { BinderLogger } from '../../../shared/service/logger.helper';
import { TitleSuggestionService } from '../../document/service/title-suggestion.service';
import { DocumentService } from '../../document/service/document.service';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';
import { InboxItem } from '../models/inbox-item.entity';
import { InboxItemStore } from '../store/inbox-item.store';
import { DocumentAuditService } from '../../document/service/document-audit.service';

@Injectable()
export class InboxService {
  private readonly logger = new BinderLogger(InboxService.name);
  private aiProcessing = false;

  constructor(
    private readonly items: InboxItemStore,
    private readonly titleSuggestions: TitleSuggestionService,
    private readonly documents: DocumentService,
    private readonly settings: ApplicationSettingsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly audit: DocumentAuditService,
  ) {}

  async list() {
    await this.removeCompletedItems();
    const [items, aiCandidates] = await Promise.all([
      this.items.findQueue(),
      this.items.countAiCandidates(),
    ]);
    return InboxQueueResponseSchema.parse({
      items: items.map((item) => this.toResponse(item)),
      total: items.length,
      aiCandidates,
    });
  }

  async processAllWithAi() {
    if (this.aiProcessing) {
      throw new ConflictException('Inbox AI processing is already running');
    }

    this.aiProcessing = true;
    let processed = 0;
    let failed = 0;
    let skipped = 0;
    const automaticApproval = await this.getAutomaticApprovalSettings();
    const completionStage = await this.getCompletionStage();
    try {
      await this.removeCompletedItems(completionStage);
      const candidates = await this.items.findAiCandidates();
      for (const item of candidates) {
        if (!item.documentUuid) {
          skipped += 1;
          continue;
        }

        const document = await this.documents.get(item.ownerUuid, item.documentUuid);
        if (!['processing', 'ready'].includes(document.status)) {
          skipped += 1;
          continue;
        }

        const extractedText = await this.documents.getExtractedText(
          item.ownerUuid,
          item.documentUuid,
        );
        if (!extractedText.text.trim()) {
          skipped += 1;
          continue;
        }

        await this.items.update(item.uuid, {
          aiStatus: 'processing',
          aiError: null,
        });

        try {
          const suggestion = await this.titleSuggestions.suggest(item.ownerUuid, item.documentUuid);
          await this.recordSuggestionGenerated(item.ownerUuid, item.documentUuid, suggestion);
          let autoApplied = item.autoApplied;
          const highConfidence = suggestion.confidence >= automaticApproval.confidence;
          const feedbackOnly = suggestion.feedbackFields.length > 0 && !highConfidence;
          if (
            automaticApproval.enabled &&
            (highConfidence || suggestion.feedbackFields.length > 0)
          ) {
            try {
              const result = await this.documents.applySuggestionToEmptyFields(
                item.ownerUuid,
                item.documentUuid,
                suggestion,
                feedbackOnly ? suggestion.feedbackFields : undefined,
              );
              autoApplied = autoApplied || result.appliedFields.length > 0;
              this.logger.info('Automatically applied inbox AI suggestion', {
                inboxItemUuid: item.uuid,
                documentUuid: item.documentUuid,
                confidence: suggestion.confidence,
                appliedFields: result.appliedFields,
              });
              await this.documents.clearSuggestion(item.ownerUuid, item.documentUuid);
            } catch (error) {
              this.logger.warn(
                `Unable to auto-apply inbox AI suggestion for ${item.uuid}: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
          await this.items.update(item.uuid, {
            aiStatus: 'ready',
            aiSuggestion: suggestion,
            autoApplied,
            aiError: null,
          });
          if (completionStage === 'ai-analysis') {
            await this.items.remove(item.uuid);
          }
          this.emitChanged('ai-analysis-complete');
          processed += 1;
        } catch (error) {
          const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
          await this.items.update(item.uuid, { aiStatus: 'failed', aiError: message });
          failed += 1;
          this.logger.warn(`Inbox AI analysis failed for ${item.uuid}: ${message}`);
        }
      }

      const queue = await this.list();
      return InboxAiProcessResponseSchema.parse({
        processed,
        failed,
        skipped,
        items: queue.items,
      });
    } finally {
      this.aiProcessing = false;
    }
  }

  private async recordSuggestionGenerated(
    ownerUuid: string,
    documentUuid: string,
    suggestion: DocumentTitleSuggestion,
  ): Promise<void> {
    try {
      const fields = ['title'];
      if (suggestion.documentTypeUuid) fields.push('documentType');
      if (suggestion.categoryUuid) fields.push('category');
      if (suggestion.issuerUuid) fields.push('issuer');
      if (suggestion.tagUuids.length > 0) fields.push('tags');
      if (Object.keys(suggestion.custom).length > 0) fields.push('custom');
      await this.audit.record({
        documentUuid,
        ownerUuid,
        actorUuid: null,
        actorType: 'system',
        eventType: 'ai-suggestion-generated',
        summary: 'AI metadata suggestion generated',
        details: { fields },
      });
    } catch (error) {
      this.logger.warn(
        `Unable to record AI suggestion audit event for ${documentUuid}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async remove(uuid: string) {
    const removed = await this.items.remove(uuid);
    if (removed === 0) throw new NotFoundException('Inbox item not found');
    this.emitChanged('manual-remove');
    this.logger.info('Removed inbox item manually', { inboxItemUuid: uuid });
    return InboxRemoveResponseSchema.parse({ removed: true });
  }

  async removeByStatus(status: 'duplicate' | 'rejected') {
    const removed = await this.items.removeByStatus(status);
    this.emitChanged(`bulk-remove-${status}`);
    this.logger.info('Removed inbox items by status', { status, removed });
    return { removed };
  }

  events(ownerUuid: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let lastToken: string | null = null;
      let lastDocumentToken: string | null = null;
      let lastDocumentUpdatedAt: Date | null = null;
      let checking = false;

      const emit = (reason: string, documentUuids: string[] = []): void => {
        subscriber.next({
          data: {
            type: 'inbox.changed',
            occurredAt: new Date().toISOString(),
            reason,
            documentUuids: [...new Set(documentUuids)],
          },
        });
      };
      const onApplicationChange = (
        event: { reason?: string; documentUuids?: string[] } = {},
      ): void => emit(event.reason ?? 'application-change', event.documentUuids);
      this.eventEmitter.on('inbox.changed', onApplicationChange);

      const checkDatabase = async (): Promise<void> => {
        if (checking) return;
        checking = true;
        try {
          const [token, documentChange] = await Promise.all([
            this.items.changeToken(),
            this.documents.documentChangeToken(ownerUuid),
          ]);
          if (lastToken === null) {
            lastToken = token;
            lastDocumentToken = documentChange.token;
            lastDocumentUpdatedAt = documentChange.updatedAt;
            emit('connected');
            return;
          }

          const documentChanged = documentChange.token !== lastDocumentToken;
          const inboxChanged = token !== lastToken;
          if (documentChanged || inboxChanged) {
            let changedDocumentUuids: string[] = [];
            if (documentChanged && lastDocumentUpdatedAt) {
              changedDocumentUuids = await this.documents.changedDocumentUuidsSince(
                ownerUuid,
                lastDocumentUpdatedAt,
              );
            }

            lastToken = token;
            lastDocumentToken = documentChange.token;
            lastDocumentUpdatedAt = documentChange.updatedAt;
            emit(documentChanged ? 'document-change' : 'database-change', changedDocumentUuids);
          }
        } finally {
          checking = false;
        }
      };

      void checkDatabase();
      const timer = setInterval(() => void checkDatabase(), 2_000);
      return () => {
        clearInterval(timer);
        this.eventEmitter.off('inbox.changed', onApplicationChange);
      };
    });
  }

  private async getAutomaticApprovalSettings(): Promise<{ enabled: boolean; confidence: number }> {
    const enabled =
      (await this.settings.get('ai.automaticClassification.enabled', 'false'))?.toLowerCase() ===
      'true';
    const configured = Number(
      await this.settings.get('ai.automaticClassification.confidence', '0.8'),
    );
    const confidence = configured > 1 ? configured / 100 : configured;
    return {
      enabled,
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.8,
    };
  }

  private async getCompletionStage(): Promise<'import' | 'ai-analysis'> {
    const value = (await this.settings.get('inbox.completionStage', 'ai-analysis'))?.trim();
    const automaticAnalysis =
      (await this.settings.get('ai.automaticAnalysis.enabled', 'false'))?.toLowerCase() === 'true';
    if (automaticAnalysis) return 'ai-analysis';
    return value === 'import' ? 'import' : 'ai-analysis';
  }

  private async removeCompletedItems(completionStage?: 'import' | 'ai-analysis'): Promise<void> {
    const stage = completionStage ?? (await this.getCompletionStage());
    const removed = await this.items.removeCompleted(stage);
    if (removed > 0) {
      this.logger.info('Removed completed inbox items', { removed, completionStage: stage });
      this.emitChanged('completed-items-removed');
    }
  }

  private emitChanged(reason: string): void {
    this.eventEmitter.emit('inbox.changed', { reason });
  }

  private toResponse(item: InboxItem) {
    const suggestion = item.aiSuggestion
      ? DocumentTitleSuggestionSchema.safeParse(item.aiSuggestion)
      : null;
    return {
      uuid: item.uuid,
      ownerUuid: item.ownerUuid,
      documentUuid: item.documentUuid,
      originalFilename: item.originalFilename,
      checksumSha256: item.checksumSha256,
      sizeBytes: Number(item.sizeBytes),
      status: item.status,
      aiStatus: item.aiStatus,
      aiSuggestion: suggestion?.success ? suggestion.data : null,
      autoApplied: item.autoApplied,
      lastError: item.lastError,
      aiError: item.aiError,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }
}
