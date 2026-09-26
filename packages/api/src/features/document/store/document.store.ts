import { Injectable } from '@nestjs/common';
import { Op, Order, WhereOptions } from 'sequelize';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { Document } from '../models/document.entity';
import { DocumentPage } from '../models/document-page.entity';
import { DocumentListQuery } from '@binder/common';

@Injectable()
export class DocumentStore extends BaseCrudStore<Document> {
  constructor() {
    super(Document);
    this.registerIdField('uuid');
  }

  async findOwnedByUuid(ownerUuid: string, uuid: string): Promise<Document | null> {
    return this.model.findOne({ where: { uuid, ownerUuid } });
  }

  async findOwnedPage(ownerUuid: string, query: DocumentListQuery) {
    const where: WhereOptions<Document> = { ownerUuid };

    if (query.status) {
      where.status = query.status;
    }

    if (query.q) {
      (where as unknown as Record<PropertyKey, unknown>)[Op.or] = [
        { title: { [Op.iLike]: `%${query.q}%` } },
        { originalFilename: { [Op.iLike]: `%${query.q}%` } },
        { checksumSha256: { [Op.iLike]: `%${query.q}%` } }
      ];
    }

    const order: Order = [[query.sort, query.direction.toUpperCase() as 'ASC' | 'DESC']];
    const result = await this.model.findAndCountAll({
      where,
      order,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize
    });

    const total = result.count as number;
    return {
      items: result.rows,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      hasNext: query.page * query.pageSize < total,
      hasPrev: query.page > 1
    };
  }

  async searchOwned(ownerUuid: string, query: { q: string; limit: number }) {
    const tokens = this.searchTokens(query.q);
    if (tokens.length === 0) return [];
    const pageRows = await DocumentPage.findAll({
      where: { [Op.or]: tokens.map((token) => ({ text: { [Op.iLike]: `%${token}%` } })) },
      include: [{ model: Document, required: true, where: { ownerUuid } }],
      order: [['pageNumber', 'ASC']],
      limit: Math.min(250, Math.max(query.limit * 8, 25))
    });
    const titleRows = await this.model.findAll({
      where: {
        ownerUuid,
        [Op.or]: tokens.flatMap((token) => [
          { title: { [Op.iLike]: `%${token}%` } },
          { originalFilename: { [Op.iLike]: `%${token}%` } }
        ])
      },
      order: [['updatedAt', 'DESC']],
      limit: query.limit
    });

    const pageHits = pageRows
      .filter((page) => page.document)
      .map((page) => ({
        document: page.document!,
        pageNumber: page.pageNumber,
        text: page.text,
        score: this.scoreText(page.text, tokens)
      }))
      .sort((left, right) => right.score - left.score);
    const pageDocumentUuids = new Set(pageHits.map((hit) => hit.document.uuid));
    const titleHits = titleRows
      .filter((document) => !pageDocumentUuids.has(document.uuid))
      .map((document) => ({ document, pageNumber: null, text: document.title ?? document.originalFilename, score: 1 }));

    return [...pageHits, ...titleHits].slice(0, query.limit);
  }

  private scoreText(text: string, tokens: string[]): number {
    const normalized = text.toLocaleLowerCase();
    const matches = tokens.reduce((score, token) => score + (normalized.includes(token) ? 1 : 0), 0);
    return matches / tokens.length;
  }

  private searchTokens(query: string): string[] {
    const stopWords = new Set([
      'a', 'an', 'and', 'about', 'are', 'find', 'for', 'from', 'get', 'i', 'in', 'me', 'my', 'of', 'on', 'show', 'the', 'to', 'with',
      'ein', 'eine', 'einen', 'einer', 'einem', 'eines', 'und', 'über', 'finde', 'für', 'mir', 'meine', 'von', 'der', 'die', 'das', 'den', 'dem', 'zu', 'mit'
    ]);
    return [...new Set(query.toLocaleLowerCase().split(/\s+/).map((token) => token.replace(/[^\p{L}\p{N}-]/gu, '')).filter((token) => token.length >= 3 && !stopWords.has(token)))];
  }
}
