import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { DocumentTitleSuggestion, DocumentTitleSuggestionSchema } from '@binder/common';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';
import { DocumentPage } from '../models/document-page.entity';
import { DocumentStore } from '../store/document.store';
import { BinderLogger } from '../../../shared/service/logger.helper';
import { MetadataService } from '../../metadata/service/metadata.service';
import { IssuerService } from '../../issuer/service/issuer.service';

const ProviderResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1)
});

const UuidSchema = z.uuid();

type SuggestionRecord = Record<string, unknown>;

@Injectable()
export class TitleSuggestionService {
  private readonly logger = new BinderLogger(TitleSuggestionService.name);

  constructor(
    private readonly documents: DocumentStore,
    private readonly settings: ApplicationSettingsService,
    private readonly metadata: MetadataService,
    private readonly issuers: IssuerService
  ) {}

  async suggest(ownerUuid: string, documentUuid: string): Promise<DocumentTitleSuggestion> {
    const document = await this.documents.findOwnedByUuid(ownerUuid, documentUuid);
    if (!document) throw new NotFoundException('Document not found');

    const enabled = (await this.settings.get('ai.titleSuggestions.enabled', 'false'))?.toLowerCase() === 'true';
    const automaticClassification = (await this.settings.get('ai.automaticClassification.enabled', 'false'))?.toLowerCase() === 'true';
    const provider = await this.settings.get('ai.provider', 'openai-compatible');
    const apiKey = await this.settings.get('ai.apiKey', '');
    if ((!enabled && !automaticClassification) || !apiKey || provider !== 'openai-compatible') {
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
    const issuerList = await this.issuers.list(ownerUuid);
    const allowedIssuers = issuerList.items.map((issuer) => ({
      uuid: issuer.uuid,
      name: issuer.name,
      address: issuer.address,
      zipCode: issuer.zipCode,
      city: issuer.city,
      country: issuer.country,
      custom: issuer.custom
    }));
    this.logger.info('Requesting document metadata suggestion', {
      documentUuid,
      model,
      textLength: extractedText.length,
      issuerCount: allowedIssuers.length
    });

    const response = await fetch(endpoint!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: `${analysisPrompt}\n\nReturn one valid JSON object with exactly these keys: suggestedTitle, confidence, issuerUuid, documentTypeUuid, categoryUuid, tagUuids, and custom. confidence must be a JSON number between 0 and 1 representing how strongly the document evidence supports the complete suggestion; use higher values for clear evidence and use 0 only when there is no useful evidence. Do not return a percentage. The title must be at most 255 characters. Select issuerUuid only from the supplied issuers and only when the document text provides sufficient evidence. Use null or [] when uncertain. Use only supplied UUIDs and metadata keys. Never include markdown.` },
          { role: 'user', content: `Original filename: ${document.originalFilename}\nCurrent title: ${document.title ?? ''}\nAllowed issuers: ${JSON.stringify(allowedIssuers)}\nAllowed document types: ${JSON.stringify(vocabulary.documentTypes.map((item) => ({ uuid: item.uuid, name: item.name, translations: item.translations })))}\nAllowed categories: ${JSON.stringify(vocabulary.categories.map((item) => ({ uuid: item.uuid, name: item.name, translations: item.translations })))}\nAllowed tags: ${JSON.stringify(vocabulary.tags.map((item) => ({ uuid: item.uuid, name: item.name, translations: item.translations })))}\nAllowed custom metadata definitions: ${JSON.stringify(definitions.items.map((item) => ({ key: item.key, label: item.label, type: item.type, options: item.options })))}\nExtracted document text:\n${extractedText}` }
        ]
      })
    });
    if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}`);
    const body = ProviderResponseSchema.parse(await response.json());
    const content = body.choices[0].message.content.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '');
    const rawSuggestion = JSON.parse(content) as unknown;
    const invalidFields: string[] = [];
    const raw = isSuggestionRecord(rawSuggestion) ? rawSuggestion : {};
    if (!isSuggestionRecord(rawSuggestion)) invalidFields.push('suggestion');

    const fallbackTitle = document.title?.trim() || document.originalFilename;
    const suggestedTitle = typeof raw.suggestedTitle === 'string' && raw.suggestedTitle.trim()
      ? raw.suggestedTitle.trim().slice(0, 255)
      : fallbackTitle.slice(0, 255);
    const confidence = parseConfidence(raw.confidence, invalidFields);
    const issuerUuid = parseUuid(raw.issuerUuid, 'issuerUuid', invalidFields);
    const documentTypeUuid = parseUuid(raw.documentTypeUuid, 'documentTypeUuid', invalidFields);
    const categoryUuid = parseUuid(raw.categoryUuid, 'categoryUuid', invalidFields);
    const tagUuids = parseUuidArray(raw.tagUuids, 'tagUuids', invalidFields);
    const custom = parseCustom(raw.custom, invalidFields);
    const suggestion = DocumentTitleSuggestionSchema.parse({
      suggestedTitle,
      confidence,
      issuerUuid,
      documentTypeUuid,
      categoryUuid,
      tagUuids,
      custom
    });
    if (invalidFields.length > 0) {
      this.logger.warn('AI returned invalid optional metadata; discarded invalid fields', {
        documentUuid,
        fields: [...new Set(invalidFields)]
      });
    }
    const allowedIssuerUuids = new Set(allowedIssuers.map((issuer) => issuer.uuid));
    const allowedTypeUuids = new Set(vocabulary.documentTypes.map((item) => item.uuid));
    const allowedCategoryUuids = new Set(vocabulary.categories.map((item) => item.uuid));
    const allowedTagUuids = new Set(vocabulary.tags.map((item) => item.uuid));
    const allowedDefinitions = new Map(definitions.items.map((item) => [item.key, item]));
    const safeCustom = Object.fromEntries(Object.entries(suggestion.custom).filter(([key]) => allowedDefinitions.has(key)));
    const safeSuggestion: DocumentTitleSuggestion = {
      ...suggestion,
      issuerUuid: suggestion.issuerUuid && allowedIssuerUuids.has(suggestion.issuerUuid) ? suggestion.issuerUuid : null,
      documentTypeUuid: suggestion.documentTypeUuid && allowedTypeUuids.has(suggestion.documentTypeUuid) ? suggestion.documentTypeUuid : null,
      categoryUuid: suggestion.categoryUuid && allowedCategoryUuids.has(suggestion.categoryUuid) ? suggestion.categoryUuid : null,
      tagUuids: suggestion.tagUuids.filter((uuid) => allowedTagUuids.has(uuid)),
      custom: safeCustom
    };
    this.logger.info('Document metadata suggestion received', { documentUuid, confidence: safeSuggestion.confidence, hasIssuer: Boolean(safeSuggestion.issuerUuid), hasType: Boolean(safeSuggestion.documentTypeUuid), hasCategory: Boolean(safeSuggestion.categoryUuid), tagCount: safeSuggestion.tagUuids.length, customFieldCount: Object.keys(safeSuggestion.custom).length });
    await document.update({ aiSuggestion: safeSuggestion });
    return safeSuggestion;
  }
}

function isSuggestionRecord(value: unknown): value is SuggestionRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseConfidence(value: unknown, invalidFields: string[]): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    if (value !== undefined && value !== null) invalidFields.push('confidence');
    return 0;
  }
  return Math.min(1, Math.max(0, parsed));
}

function parseUuid(value: unknown, field: string, invalidFields: string[]): string | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = UuidSchema.safeParse(value);
  if (!parsed.success) {
    invalidFields.push(field);
    return null;
  }
  return parsed.data;
}

function parseUuidArray(value: unknown, field: string, invalidFields: string[]): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    invalidFields.push(field);
    return [];
  }

  const result: string[] = [];
  for (const item of value) {
    const parsed = UuidSchema.safeParse(item);
    if (parsed.success) result.push(parsed.data);
    else invalidFields.push(`${field}[]`);
  }
  return [...new Set(result)];
}

function parseCustom(value: unknown, invalidFields: string[]): SuggestionRecord {
  if (value === undefined || value === null) return {};
  if (!isSuggestionRecord(value)) {
    invalidFields.push('custom');
    return {};
  }
  return value;
}
