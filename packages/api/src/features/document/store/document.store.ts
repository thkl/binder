import { Injectable } from '@nestjs/common';
import { fn, Op, Order, WhereOptions } from 'sequelize';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { Document } from '../models/document.entity';
import { DocumentPage } from '../models/document-page.entity';
import { DocumentListQuery, DocumentSearchQuery } from '@binder/common';
import { DocumentTagAssignment, DocumentMetadataValue, MetadataDefinition } from '../../metadata/models/vocabulary.entity';

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

  async searchOwned(ownerUuid: string, query: DocumentSearchQuery) {
    const allowedUuids = await this.findMetadataMatches(ownerUuid, query);
    if (allowedUuids && allowedUuids.length === 0) return [];
    const documentWhere: WhereOptions<Document> = {
      ownerUuid,
      ...(query.status ? { status: query.status } : {}),
      ...(allowedUuids ? { uuid: { [Op.in]: allowedUuids } } : {})
    };
    const tokens = this.searchTokens(query.q);
    if (tokens.length === 0) return [];
    const textQuery = fn('websearch_to_tsquery', 'simple', tokens.join(' OR '));
    const pageRows = await DocumentPage.findAll({
      where: { searchVector: { [Op.match]: textQuery } },
      include: [{ model: Document, required: true, where: documentWhere }],
      order: [['pageNumber', 'ASC']],
      limit: Math.min(250, Math.max(query.limit * 8, 25))
    });
    const titleRows = await this.model.findAll({
      where: {
        ...documentWhere,
        searchVector: { [Op.match]: textQuery }
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
        score: 0.5
      }))
      .sort((left, right) => right.score - left.score);
    const pageDocumentUuids = new Set(pageHits.map((hit) => hit.document.uuid));
    const titleHits = titleRows
      .filter((document) => !pageDocumentUuids.has(document.uuid))
      .map((document) => ({ document, pageNumber: null, text: document.title ?? document.originalFilename, score: 1 }));

    return [...pageHits, ...titleHits].slice(0, query.limit);
  }

  private async findMetadataMatches(ownerUuid: string, query: DocumentSearchQuery): Promise<string[] | null> {
    const hasFilters = Boolean(query.status || query.documentTypeUuid || query.categoryUuid || query.tagUuids?.length || query.metadata);
    if (!hasFilters) return null;
    const documents = await this.model.findAll({ where: { ownerUuid, ...(query.status ? { status: query.status } : {}) }, attributes: ['uuid'] });
    let allowed = new Set(documents.map((document) => document.uuid));
    if (query.documentTypeUuid || query.categoryUuid) {
      const matching = documents.filter((document) =>
        (!query.documentTypeUuid || document.documentTypeUuid === query.documentTypeUuid) &&
        (!query.categoryUuid || document.categoryUuid === query.categoryUuid)
      );
      allowed = new Set(matching.map((document) => document.uuid));
    }
    if (query.tagUuids?.length && allowed.size > 0) {
      const assignments = await DocumentTagAssignment.findAll({ where: { documentUuid: { [Op.in]: [...allowed] }, tagUuid: { [Op.in]: query.tagUuids } } });
      const tagsByDocument = new Map<string, Set<string>>();
      for (const assignment of assignments) {
        const tags = tagsByDocument.get(assignment.documentUuid) ?? new Set<string>();
        tags.add(assignment.tagUuid);
        tagsByDocument.set(assignment.documentUuid, tags);
      }
      allowed = new Set([...allowed].filter((uuid) => query.tagUuids!.every((tagUuid) => tagsByDocument.get(uuid)?.has(tagUuid))));
    }
    if (query.metadata && allowed.size > 0) {
      const definitions = await MetadataDefinition.findAll({ where: { key: { [Op.in]: Object.keys(query.metadata) }, active: true, ownerUuid: { [Op.or]: [null, ownerUuid] } } });
      const definitionByKey = new Map(definitions.map((definition) => [definition.key, definition.uuid]));
      for (const [key, value] of Object.entries(query.metadata)) {
        const definitionUuid = definitionByKey.get(key);
        if (!definitionUuid) { allowed.clear(); break; }
        const values = await DocumentMetadataValue.findAll({ where: { documentUuid: { [Op.in]: [...allowed] }, definitionUuid, value } });
        allowed = new Set(values.map((item) => item.documentUuid));
      }
    }
    return [...allowed];
  }

  private searchTokens(query: string): string[] {
    const stopWords = new Set([
      'a', 'an', 'and', 'about', 'are', 'find', 'for', 'from', 'get', 'i', 'in', 'me', 'my', 'of', 'on', 'show', 'the', 'to', 'with',
      'ein', 'eine', 'einen', 'einer', 'einem', 'eines', 'und', 'über', 'finde', 'für', 'mir', 'meine', 'von', 'der', 'die', 'das', 'den', 'dem', 'zu', 'mit'
    ]);
    return [...new Set(query.toLocaleLowerCase().split(/\s+/)
      .map((token) => token.replace(/[^\p{L}\p{N}-]/gu, ''))
      .filter((token) => token.length >= 3 && !stopWords.has(token)))];
  }
}
