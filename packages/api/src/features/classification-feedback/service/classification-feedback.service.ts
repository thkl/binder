import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Op } from 'sequelize';
import {
  ClassificationFeedbackField,
  ClassificationFeedbackListResponseSchema,
  DocumentMetadata,
  DocumentTitleSuggestion,
  DocumentTitleSuggestionSchema,
} from '@binder/common';
import { BinderLogger } from '../../../shared/service/logger.helper';
import { DocumentPage } from '../../document/models/document-page.entity';
import { DocumentStore } from '../../document/store/document.store';
import { DocumentAuditService } from '../../document/service/document-audit.service';
import {
  DocumentCategory,
  DocumentTag,
  DocumentType,
} from '../../metadata/models/vocabulary.entity';
import { Issuer } from '../../issuer/models/issuer.entity';
import { DocumentClassificationFeedbackStore } from '../store/document-classification-feedback.store';

const MINIMUM_TEMPLATE_TEXT_LENGTH = 80;

interface FeedbackChange {
  field: ClassificationFeedbackField;
  valueUuid: string;
  previousValueUuid: string | null;
}

@Injectable()
export class ClassificationFeedbackService {
  private readonly logger = new BinderLogger(ClassificationFeedbackService.name);

  constructor(
    private readonly feedback: DocumentClassificationFeedbackStore,
    private readonly documents: DocumentStore,
    private readonly audit: DocumentAuditService,
  ) {}

  async recordManualChanges(
    ownerUuid: string,
    documentUuid: string,
    previous: DocumentMetadata,
    current: DocumentMetadata,
  ): Promise<void> {
    try {
      await this.recordManualChangesInternal(ownerUuid, documentUuid, previous, current);
    } catch (error) {
      this.logger.warn(
        `Unable to persist classification feedback: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async recordManualChangesInternal(
    ownerUuid: string,
    documentUuid: string,
    previous: DocumentMetadata,
    current: DocumentMetadata,
  ): Promise<void> {
    const changes = this.findChanges(previous, current);
    if (changes.length === 0) return;

    const fingerprint = await this.fingerprintForDocument(ownerUuid, documentUuid);
    if (!fingerprint) {
      this.logger.debug(
        'Skipping classification feedback because the document has no usable text',
        {
          documentUuid,
        },
      );
      return;
    }

    for (const change of changes) {
      if (!(await this.valueIsAvailable(ownerUuid, change.field, change.valueUuid))) continue;

      const rule = await this.feedback.record({
        ownerUuid,
        sourceDocumentUuid: documentUuid,
        fingerprint,
        field: change.field,
        valueUuid: change.valueUuid,
        previousValueUuid: change.previousValueUuid,
      });

      await this.recordFeedbackAudit(
        documentUuid,
        ownerUuid,
        'classification-feedback',
        'Classification feedback learned from a manual change',
        {
          feedbackUuid: rule.uuid,
          field: change.field,
          valueUuid: change.valueUuid,
          previousValueUuid: change.previousValueUuid,
        },
      );
    }
  }

  async applyToSuggestion(
    ownerUuid: string,
    documentUuid: string,
    suggestion: DocumentTitleSuggestion,
  ): Promise<DocumentTitleSuggestion> {
    const fingerprint = await this.fingerprintForDocument(ownerUuid, documentUuid);
    if (!fingerprint) return suggestion;

    const matches = await this.feedback.findActiveMatches(ownerUuid, fingerprint);
    const selected = await this.selectStrongMatches(ownerUuid, matches);
    if (selected.length === 0) return suggestion;

    const feedbackFields = selected.map((rule) => rule.field);
    const categoryRule = selected.find((rule) => rule.field === 'category');
    const documentTypeRule = selected.find((rule) => rule.field === 'documentType');
    const issuerRule = selected.find((rule) => rule.field === 'issuer');
    const tagRules = selected.filter((rule) => rule.field === 'tag');
    const source = this.suggestionSource(suggestion, feedbackFields);

    await Promise.all(selected.map((rule) => this.feedback.markMatched(rule.uuid)));

    return DocumentTitleSuggestionSchema.parse({
      ...suggestion,
      categoryUuid: categoryRule?.valueUuid ?? suggestion.categoryUuid,
      documentTypeUuid: documentTypeRule?.valueUuid ?? suggestion.documentTypeUuid,
      issuerUuid: issuerRule?.valueUuid ?? suggestion.issuerUuid,
      tagUuids: [...new Set([...suggestion.tagUuids, ...tagRules.map((rule) => rule.valueUuid)])],
      classificationSource: source,
      feedbackFields: [...new Set(feedbackFields)],
    });
  }

  async list(ownerUuid: string) {
    const rows = await this.feedback.findOwnedActive(ownerUuid);
    const sourceDocuments = await this.documents.findOwnedByUuids(
      ownerUuid,
      rows.map((row) => row.sourceDocumentUuid).filter((uuid): uuid is string => uuid !== null),
    );
    const documentsByUuid = new Map(sourceDocuments.map((document) => [document.uuid, document]));
    const valueNames = await this.valueNames(ownerUuid, rows);

    return ClassificationFeedbackListResponseSchema.parse({
      items: rows.map((row) => {
        const source = row.sourceDocumentUuid
          ? documentsByUuid.get(row.sourceDocumentUuid)
          : undefined;
        return {
          uuid: row.uuid,
          field: row.field,
          valueUuid: row.valueUuid,
          valueName: valueNames.get(row.valueUuid) ?? row.valueUuid,
          sourceDocumentUuid: row.sourceDocumentUuid,
          sourceDocumentTitle: source?.title ?? null,
          sourceOriginalFilename: source?.originalFilename ?? null,
          matchCount: row.matchCount,
          active: row.active,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
      }),
    });
  }

  async remove(ownerUuid: string, uuid: string): Promise<{ deleted: true; uuid: string }> {
    const existing = await this.feedback.findOwned(ownerUuid, uuid);
    if (!existing) {
      throw new NotFoundException('Classification feedback not found');
    }

    const deleted = await this.feedback.deactivate(ownerUuid, uuid);
    if (!deleted) {
      throw new NotFoundException('Classification feedback not found');
    }

    if (existing.sourceDocumentUuid) {
      await this.recordFeedbackAudit(
        existing.sourceDocumentUuid,
        ownerUuid,
        'classification-feedback-removed',
        'Classification feedback removed',
        { feedbackUuid: uuid, field: existing.field, valueUuid: existing.valueUuid },
      );
    }

    return { deleted: true, uuid };
  }

  private findChanges(previous: DocumentMetadata, current: DocumentMetadata): FeedbackChange[] {
    const changes: FeedbackChange[] = [];
    this.addChange(
      changes,
      'documentType',
      previous.documentType?.uuid ?? null,
      current.documentType?.uuid ?? null,
    );
    this.addChange(
      changes,
      'category',
      previous.category?.uuid ?? null,
      current.category?.uuid ?? null,
    );
    this.addChange(changes, 'issuer', previous.issuer?.uuid ?? null, current.issuer?.uuid ?? null);

    const previousTags = new Set(previous.tags.map((tag) => tag.uuid));
    for (const tag of current.tags) {
      if (!previousTags.has(tag.uuid)) {
        changes.push({ field: 'tag', valueUuid: tag.uuid, previousValueUuid: null });
      }
    }
    return changes;
  }

  private addChange(
    changes: FeedbackChange[],
    field: Exclude<ClassificationFeedbackField, 'tag'>,
    previousValueUuid: string | null,
    currentValueUuid: string | null,
  ): void {
    if (currentValueUuid && currentValueUuid !== previousValueUuid) {
      changes.push({ field, valueUuid: currentValueUuid, previousValueUuid });
    }
  }

  private async selectStrongMatches(
    ownerUuid: string,
    rows: Awaited<ReturnType<DocumentClassificationFeedbackStore['findActiveMatches']>>,
  ) {
    const available = [];
    for (const row of rows) {
      if (await this.valueIsAvailable(ownerUuid, row.field, row.valueUuid)) available.push(row);
    }

    const selected = [];
    for (const field of ['documentType', 'category', 'issuer', 'tag'] as const) {
      const candidates = available.filter((row) => row.field === field);
      if (candidates.length === 0) continue;

      const top = candidates[0];
      const second = candidates[1];
      if (second && second.matchCount >= top.matchCount) continue;
      selected.push(top);
    }
    return selected;
  }

  private suggestionSource(
    suggestion: DocumentTitleSuggestion,
    feedbackFields: ClassificationFeedbackField[],
  ): 'ai' | 'feedback' | 'mixed' {
    if (feedbackFields.length === 0) return suggestion.classificationSource;
    return suggestion.classificationSource === 'ai' && feedbackFields.length > 0
      ? 'mixed'
      : 'feedback';
  }

  private async fingerprintForDocument(
    ownerUuid: string,
    documentUuid: string,
  ): Promise<string | null> {
    const document = await this.documents.findOwnedByUuid(ownerUuid, documentUuid);
    if (!document) return null;

    const pages = await DocumentPage.findAll({
      where: { documentUuid },
      order: [['pageNumber', 'ASC']],
      attributes: ['text'],
    });
    const text = pages.map((page) => page.text).join('\n');
    const normalizedText = normalizeTemplateText(text);
    if (normalizedText.length < MINIMUM_TEMPLATE_TEXT_LENGTH) return null;

    const normalizedFilename = normalizeTemplateText(document.originalFilename);
    return createHash('sha256')
      .update(`${normalizedFilename}\n${normalizedText}`, 'utf8')
      .digest('hex');
  }

  private async valueIsAvailable(
    ownerUuid: string,
    field: ClassificationFeedbackField,
    valueUuid: string,
  ): Promise<boolean> {
    if (field === 'issuer') {
      return Boolean(await Issuer.findOne({ where: { uuid: valueUuid, ownerUuid } }));
    }

    const model =
      field === 'category'
        ? DocumentCategory
        : field === 'documentType'
          ? DocumentType
          : DocumentTag;
    return Boolean(
      await model.findOne({
        where: { uuid: valueUuid, active: true, ownerUuid: { [Op.or]: [null, ownerUuid] } },
      }),
    );
  }

  private async valueNames(
    ownerUuid: string,
    rows: Awaited<ReturnType<DocumentClassificationFeedbackStore['findOwnedActive']>>,
  ): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const uuidsByField = new Map<ClassificationFeedbackField, string[]>();
    for (const row of rows) {
      uuidsByField.set(row.field, [...(uuidsByField.get(row.field) ?? []), row.valueUuid]);
    }

    const [types, categories, tags, issuers] = await Promise.all([
      this.findVocabularyNames(DocumentType, ownerUuid, uuidsByField.get('documentType') ?? []),
      this.findVocabularyNames(DocumentCategory, ownerUuid, uuidsByField.get('category') ?? []),
      this.findVocabularyNames(DocumentTag, ownerUuid, uuidsByField.get('tag') ?? []),
      Issuer.findAll({
        where: {
          uuid: { [Op.in]: uuidsByField.get('issuer') ?? [] },
          ownerUuid,
        },
      }),
    ]);

    for (const item of [...types, ...categories, ...tags]) names.set(item.uuid, item.name);
    for (const issuer of issuers) names.set(issuer.uuid, issuer.name);
    return names;
  }

  private async findVocabularyNames(
    model: typeof DocumentType | typeof DocumentCategory | typeof DocumentTag,
    ownerUuid: string,
    uuids: string[],
  ) {
    if (uuids.length === 0) return [];
    return model.findAll({
      where: { uuid: { [Op.in]: [...new Set(uuids)] }, ownerUuid: { [Op.or]: [null, ownerUuid] } },
      attributes: ['uuid', 'name'],
    });
  }

  private async recordFeedbackAudit(
    documentUuid: string,
    ownerUuid: string,
    eventType: 'classification-feedback' | 'classification-feedback-removed',
    summary: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.record({
        documentUuid,
        ownerUuid,
        actorUuid: ownerUuid,
        actorType: 'user',
        eventType,
        summary,
        details,
      });
    } catch (error) {
      this.logger.warn(
        `Unable to record classification feedback audit event: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function normalizeTemplateText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\s+(?=[\d.,:/-])/gu, '')
    .replace(
      /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan(?:uar)?|feb(?:ruar)?|märz|mar(?:ch)?|apr(?:il)?|mai|may|jun(?:e|i)?|jul(?:y|i)?|aug(?:ust)?|sep(?:tember)?|okt(?:ober)?|oct(?:ober)?|nov(?:ember)?|dez(?:ember)?|dec(?:ember)?)\b/gu,
      '<month>',
    )
    .replace(/\b\d{1,4}[./-]\d{1,2}[./-]\d{1,4}\b/gu, '<date>')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/gu, '<time>')
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gu, '<email>')
    .replace(/https?:\/\/\S+/gu, '<url>')
    .replace(/(?<!\w)[+-]?(?:\d[\d\s.,]*)(?:\s?(?:€|eur|usd|gbp))?(?!\w)/gu, '<number>')
    .replace(/[^\p{L}\p{N}<>]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}
