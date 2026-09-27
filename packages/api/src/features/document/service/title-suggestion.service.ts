import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { DocumentTitleSuggestion, DocumentTitleSuggestionSchema } from '@binder/common';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';
import { DocumentPage } from '../models/document-page.entity';
import { DocumentStore } from '../store/document.store';
import { BinderLogger } from '../../../shared/service/logger.helper';
import { MetadataService } from '../../metadata/service/metadata.service';

const ProviderResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1)
});

@Injectable()
export class TitleSuggestionService {
  private readonly logger = new BinderLogger(TitleSuggestionService.name);

  constructor(
    private readonly documents: DocumentStore,
    private readonly settings: ApplicationSettingsService,
    private readonly metadata: MetadataService
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
    const analysisPrompt = await this.settings.get(
      'ai.documentAnalysis.prompt',
      'Classify the document and create a concise human-readable title. Use only the supplied document types, categories, tags, and metadata keys. Never invent UUIDs, tags, types, categories, or custom keys. Use null or [] when uncertain. Return only the requested JSON object; never include markdown.'
    );
    const pages = await DocumentPage.findAll({ where: { documentUuid }, order: [['pageNumber', 'ASC']], limit: 12 });
    const extractedText = pages.map((page) => page.text).join('\n\n').slice(0, 12_000);
    const vocabulary = await this.metadata.list(ownerUuid);
    const definitions = await this.metadata.listDefinitions(ownerUuid);
    this.logger.info('Requesting document title suggestion', { documentUuid, model, textLength: extractedText.length });

    const response = await fetch(endpoint!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: `${analysisPrompt}\n\nThe response must be valid JSON with exactly this shape: {"suggestedTitle":"...","confidence":0.0,"documentTypeUuid":null,"categoryUuid":null,"tagUuids":[],"custom":{}}. The title must be at most 255 characters. Use only supplied UUIDs and metadata keys. Never include markdown.` },
          { role: 'user', content: `Original filename: ${document.originalFilename}\nCurrent title: ${document.title ?? ''}\nAllowed document types: ${JSON.stringify(vocabulary.documentTypes.map((item) => ({ uuid: item.uuid, name: item.name, translations: item.translations })))}\nAllowed categories: ${JSON.stringify(vocabulary.categories.map((item) => ({ uuid: item.uuid, name: item.name, translations: item.translations })))}\nAllowed tags: ${JSON.stringify(vocabulary.tags.map((item) => ({ uuid: item.uuid, name: item.name, translations: item.translations })))}\nAllowed custom metadata definitions: ${JSON.stringify(definitions.items.map((item) => ({ key: item.key, label: item.label, type: item.type, options: item.options })))}\nExtracted document text:\n${extractedText}` }
        ]
      })
    });
    if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}`);
    const body = ProviderResponseSchema.parse(await response.json());
    const content = body.choices[0].message.content.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '');
    const suggestion = DocumentTitleSuggestionSchema.parse(JSON.parse(content));
    const allowedTypeUuids = new Set(vocabulary.documentTypes.map((item) => item.uuid));
    const allowedCategoryUuids = new Set(vocabulary.categories.map((item) => item.uuid));
    const allowedTagUuids = new Set(vocabulary.tags.map((item) => item.uuid));
    const allowedDefinitions = new Map(definitions.items.map((item) => [item.key, item]));
    const safeCustom = Object.fromEntries(Object.entries(suggestion.custom).filter(([key]) => allowedDefinitions.has(key)));
    const safeSuggestion: DocumentTitleSuggestion = {
      ...suggestion,
      documentTypeUuid: suggestion.documentTypeUuid && allowedTypeUuids.has(suggestion.documentTypeUuid) ? suggestion.documentTypeUuid : null,
      categoryUuid: suggestion.categoryUuid && allowedCategoryUuids.has(suggestion.categoryUuid) ? suggestion.categoryUuid : null,
      tagUuids: suggestion.tagUuids.filter((uuid) => allowedTagUuids.has(uuid)),
      custom: safeCustom
    };
    this.logger.info('Document metadata suggestion received', { documentUuid, confidence: safeSuggestion.confidence, hasType: Boolean(safeSuggestion.documentTypeUuid), hasCategory: Boolean(safeSuggestion.categoryUuid), tagCount: safeSuggestion.tagUuids.length, customFieldCount: Object.keys(safeSuggestion.custom).length });
    return safeSuggestion;
  }
}
