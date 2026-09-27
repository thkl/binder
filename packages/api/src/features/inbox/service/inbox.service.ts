import { ConflictException, Injectable } from '@nestjs/common';
import {
  DocumentTitleSuggestionSchema,
  InboxAiProcessResponseSchema,
  InboxQueueResponseSchema
} from '@binder/common';
import { BinderLogger } from '../../../shared/service/logger.helper';
import { TitleSuggestionService } from '../../document/service/title-suggestion.service';
import { InboxItem } from '../models/inbox-item.entity';
import { InboxItemStore } from '../store/inbox-item.store';

@Injectable()
export class InboxService {
  private readonly logger = new BinderLogger(InboxService.name);
  private aiProcessing = false;

  constructor(
    private readonly items: InboxItemStore,
    private readonly titleSuggestions: TitleSuggestionService
  ) {}

  async list() {
    const [items, aiCandidates] = await Promise.all([
      this.items.findQueue(),
      this.items.countAiCandidates()
    ]);
    return InboxQueueResponseSchema.parse({
      items: items.map((item) => this.toResponse(item)),
      total: items.length,
      aiCandidates
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
    try {
      const candidates = await this.items.findAiCandidates();
      for (const item of candidates) {
        if (!item.documentUuid) {
          skipped += 1;
          continue;
        }

        await this.items.update(item.uuid, {
          aiStatus: 'processing',
          aiError: null
        });

        try {
          const suggestion = await this.titleSuggestions.suggest(item.ownerUuid, item.documentUuid);
          await this.items.update(item.uuid, {
            aiStatus: 'ready',
            aiSuggestion: suggestion,
            aiError: null
          });
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
        items: queue.items
      });
    } finally {
      this.aiProcessing = false;
    }
  }

  private toResponse(item: InboxItem) {
    const suggestion = item.aiSuggestion ? DocumentTitleSuggestionSchema.safeParse(item.aiSuggestion) : null;
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
      lastError: item.lastError,
      aiError: item.aiError,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }
}
