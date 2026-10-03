import { Injectable } from '@nestjs/common';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { DocumentClassificationFeedback } from '../models/document-classification-feedback.entity';
import type { ClassificationFeedbackField } from '@binder/common';

interface CreateFeedbackInput {
  ownerUuid: string;
  sourceDocumentUuid: string;
  fingerprint: string;
  field: ClassificationFeedbackField;
  valueUuid: string;
  previousValueUuid: string | null;
}

@Injectable()
export class DocumentClassificationFeedbackStore extends BaseCrudStore<DocumentClassificationFeedback> {
  constructor() {
    super(DocumentClassificationFeedback);
    this.registerIdField('uuid');
  }

  async findActiveMatches(
    ownerUuid: string,
    fingerprint: string,
  ): Promise<DocumentClassificationFeedback[]> {
    return this.model.findAll({
      where: { ownerUuid, fingerprint, active: true },
      order: [
        ['field', 'ASC'],
        ['matchCount', 'DESC'],
        ['updatedAt', 'DESC'],
      ],
    });
  }

  async findOwnedActive(ownerUuid: string): Promise<DocumentClassificationFeedback[]> {
    return this.model.findAll({
      where: { ownerUuid, active: true },
      order: [
        ['updatedAt', 'DESC'],
        ['field', 'ASC'],
      ],
    });
  }

  async record(input: CreateFeedbackInput): Promise<DocumentClassificationFeedback> {
    const existing = await this.model.findOne({
      where: {
        ownerUuid: input.ownerUuid,
        fingerprint: input.fingerprint,
        field: input.field,
        valueUuid: input.valueUuid,
      },
    });

    if (existing) {
      return existing.update({
        sourceDocumentUuid: input.sourceDocumentUuid,
        previousValueUuid: input.previousValueUuid,
        matchCount: existing.matchCount + 1,
        active: true,
      });
    }

    return this.model.create({
      uuid: undefined,
      ...input,
      matchCount: 1,
      active: true,
      lastMatchedAt: null,
    });
  }

  async markMatched(uuid: string): Promise<void> {
    const feedback = await this.model.findByPk(uuid);
    if (!feedback) return;
    await feedback.update({
      lastMatchedAt: new Date(),
      matchCount: feedback.matchCount + 1,
    });
  }

  async deactivate(ownerUuid: string, uuid: string): Promise<boolean> {
    const [affected] = await this.model.update(
      { active: false },
      { where: { uuid, ownerUuid, active: true } },
    );
    return affected > 0;
  }

  async findOwned(ownerUuid: string, uuid: string): Promise<DocumentClassificationFeedback | null> {
    return this.model.findOne({ where: { uuid, ownerUuid, active: true } });
  }
}
