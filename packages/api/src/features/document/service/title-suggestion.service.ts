import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { DocumentTitleSuggestion, DocumentTitleSuggestionSchema } from '@binder/common';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';
import { DocumentPage } from '../models/document-page.entity';
import { DocumentStore } from '../store/document.store';
import { BinderLogger } from '../../../shared/service/logger.helper';

const ProviderResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1)
});

@Injectable()
export class TitleSuggestionService {
  private readonly logger = new BinderLogger(TitleSuggestionService.name);

  constructor(
    private readonly documents: DocumentStore,
    private readonly settings: ApplicationSettingsService
  ) {}

  async suggest(ownerUuid: string, documentUuid: string): Promise<DocumentTitleSuggestion> {
    const document = await this.documents.findOwnedByUuid(ownerUuid, documentUuid);
    if (!document) throw new NotFoundException('Document not found');

    const enabled = (await this.settings.get('ai.titleSuggestions.enabled', 'false'))?.toLowerCase() === 'true';
    const provider = await this.settings.get('ai.provider', 'openai-compatible');
    const apiKey = await this.settings.get('ai.apiKey', '');
    if (!enabled || !apiKey || provider !== 'openai-compatible') {
      throw new BadRequestException('AI title suggestions are not configured');
    }

    const endpoint = await this.settings.get('ai.endpoint', 'https://api.openai.com/v1/chat/completions');
    const model = await this.settings.get('ai.model', 'gpt-4o-mini');
    const pages = await DocumentPage.findAll({ where: { documentUuid }, order: [['pageNumber', 'ASC']], limit: 12 });
    const extractedText = pages.map((page) => page.text).join('\n\n').slice(0, 12_000);
    this.logger.info('Requesting document title suggestion', { documentUuid, model, textLength: extractedText.length });

    const response = await fetch(endpoint!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'You create concise human-readable document titles. Return only valid JSON with exactly this shape: {"suggestedTitle":"...","confidence":0.0}. The title must be at most 255 characters. Never include markdown.' },
          { role: 'user', content: `Original filename: ${document.originalFilename}\nCurrent title: ${document.title ?? ''}\nExtracted document text:\n${extractedText}` }
        ]
      })
    });
    if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}`);
    const body = ProviderResponseSchema.parse(await response.json());
    const content = body.choices[0].message.content.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '');
    const suggestion = DocumentTitleSuggestionSchema.parse(JSON.parse(content));
    this.logger.info('Document title suggestion received', { documentUuid, confidence: suggestion.confidence });
    return suggestion;
  }
}
