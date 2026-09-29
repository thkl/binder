import { Injectable } from '@nestjs/common';
import { fn, Op, Order, WhereOptions } from 'sequelize';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { Document } from '../models/document.entity';
import { DocumentPage } from '../models/document-page.entity';
import {
  DocumentListFacetOption,
  DocumentListFacetsResponse,
  DocumentListQuery,
  DocumentSearchQuery
} from '@binder/common';
import {
  DocumentCategory,
  DocumentTag,
  DocumentTagAssignment,
  DocumentMetadataValue,
  DocumentType,
  MetadataDefinition
} from '../../metadata/models/vocabulary.entity';
import { DocumentFolder } from '../../folder/models/document-folder.entity';
import { Issuer } from '../../issuer/models/issuer.entity';

type DocumentFacetKey = 'documentType' | 'category' | 'issuer' | 'tag' | 'status' | 'reviewState';

@Injectable()
export class DocumentStore extends BaseCrudStore<Document> {
  constructor() {
    super(Document);
    this.registerIdField('uuid');
  }

  async findOwnedByUuid(ownerUuid: string, uuid: string): Promise<Document | null> {
    return this.model.findOne({ where: { uuid, ownerUuid } });
  }

  async findOwnedByUuids(ownerUuid: string, uuids: string[]): Promise<Document[]> {
    if (uuids.length === 0) return [];
    return this.model.findAll({ where: { ownerUuid, uuid: { [Op.in]: uuids } } });
  }

  async findOwnedPageText(ownerUuid: string, uuid: string) {
    const document = await this.findOwnedByUuid(ownerUuid, uuid);
    if (!document) return null;
    const pages = await DocumentPage.findAll({ where: { documentUuid: uuid }, order: [['pageNumber', 'ASC']] });
    return { document, pages };
  }

  async findOwnedPage(ownerUuid: string, query: DocumentListQuery) {
    const where = await this.createOwnedWhere(ownerUuid, query);

    if (query.groupBy === 'tag') {
      return this.findOwnedTagGroupedPage(where, query);
    }

    const sortDirection = query.direction.toUpperCase() as 'ASC' | 'DESC';
    const groupDirection = query.groupDirection.toUpperCase() as 'ASC' | 'DESC';
    const order: Order = query.groupBy === 'none'
      ? [[query.sort, sortDirection]]
      : [
        [this.groupField(query.groupBy), groupDirection],
        [query.sort, sortDirection]
      ];
    const result = await this.model.findAndCountAll({
      where,
      order,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize
    });

    const total = result.count as number;
    return {
      items: result.rows,
      groupBy: query.groupBy,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      hasNext: query.page * query.pageSize < total,
      hasPrev: query.page > 1
    };
  }

  async findOwnedFacets(ownerUuid: string, query: DocumentListQuery): Promise<DocumentListFacetsResponse> {
    const [typeDocuments, categoryDocuments, issuerDocuments, tagDocuments, statusDocuments, reviewDocuments] = await Promise.all([
      this.findFacetDocuments(ownerUuid, query, 'documentType'),
      this.findFacetDocuments(ownerUuid, query, 'category'),
      this.findFacetDocuments(ownerUuid, query, 'issuer'),
      this.findFacetDocuments(ownerUuid, query, 'tag'),
      this.findFacetDocuments(ownerUuid, query, 'status'),
      this.findFacetDocuments(ownerUuid, query, 'reviewState')
    ]);

    const [documentType, category, issuer, tag] = await Promise.all([
      this.buildVocabularyFacetOptions(DocumentType, typeDocuments, 'documentTypeUuid', ownerUuid),
      this.buildVocabularyFacetOptions(DocumentCategory, categoryDocuments, 'categoryUuid', ownerUuid),
      this.buildIssuerFacetOptions(issuerDocuments, ownerUuid),
      this.buildTagFacetOptions(tagDocuments, ownerUuid)
    ]);

    return {
      documentType,
      category,
      issuer,
      tag,
      status: this.buildScalarFacetOptions(
        statusDocuments.map((document) => document.status),
        (status) => status
      ),
      reviewState: this.buildScalarFacetOptions(
        reviewDocuments.map((document) => document.isNew ? 'new' : 'reviewed'),
        (state) => state === 'new' ? 'New' : 'Reviewed'
      )
    };
  }

  private async findFacetDocuments(
    ownerUuid: string,
    query: DocumentListQuery,
    excludedFacet: DocumentFacetKey
  ): Promise<Document[]> {
    const where = await this.createOwnedWhere(ownerUuid, query, excludedFacet);
    return this.model.findAll({
      where,
      attributes: ['uuid', 'documentTypeUuid', 'categoryUuid', 'issuerUuid', 'status', 'isNew']
    });
  }

  private async createOwnedWhere(
    ownerUuid: string,
    query: DocumentListQuery,
    excludedFacet?: DocumentFacetKey
  ): Promise<WhereOptions<Document>> {
    const where: WhereOptions<Document> = { ownerUuid };

    if (query.folderUuid) {
      const links = await DocumentFolder.findAll({
        where: { folderUuid: query.folderUuid },
        attributes: ['documentUuid']
      });
      this.restrictToDocumentUuids(where, links.map((link) => link.documentUuid));
    }

    if (query.q) {
      (where as unknown as Record<PropertyKey, unknown>)[Op.or] = [
        { title: { [Op.iLike]: `%${query.q}%` } },
        { originalFilename: { [Op.iLike]: `%${query.q}%` } },
        { checksumSha256: { [Op.iLike]: `%${query.q}%` } }
      ];
    }

    if (excludedFacet !== 'status') {
      if (query.statuses !== undefined) {
        this.setFieldValues(where, 'status', query.statuses);
      } else if (query.status) {
        where.status = query.status;
      }
    }

    if (excludedFacet !== 'issuer') {
      if (query.issuerUuids !== undefined) {
        this.setFieldValues(where, 'issuerUuid', query.issuerUuids);
      } else if (query.issuerUuid) {
        where.issuerUuid = query.issuerUuid;
      }
    }

    if (excludedFacet !== 'documentType' && query.documentTypeUuids !== undefined) {
      this.setFieldValues(where, 'documentTypeUuid', query.documentTypeUuids);
    }

    if (excludedFacet !== 'category' && query.categoryUuids !== undefined) {
      this.setFieldValues(where, 'categoryUuid', query.categoryUuids);
    }

    if (excludedFacet !== 'reviewState' && query.reviewStates !== undefined) {
      const includesNew = query.reviewStates.includes('new');
      const includesReviewed = query.reviewStates.includes('reviewed');
      if (includesNew && !includesReviewed) {
        where.isNew = true;
      } else if (!includesNew && includesReviewed) {
        where.isNew = false;
      } else if (!includesNew && !includesReviewed) {
        this.restrictToDocumentUuids(where, []);
      }
    }

    if (excludedFacet !== 'tag' && query.tagUuids !== undefined) {
      await this.applyTagFilter(where, query.tagUuids);
    }

    return where;
  }

  private async applyTagFilter(where: WhereOptions<Document>, tagUuids: string[]): Promise<void> {
    if (tagUuids.length === 0) {
      this.restrictToDocumentUuids(where, []);
      return;
    }

    const candidates = await this.model.findAll({ where, attributes: ['uuid'] });
    const candidateUuids = candidates.map((document) => document.uuid);
    if (candidateUuids.length === 0) return;

    const assignments = await DocumentTagAssignment.findAll({
      where: {
        documentUuid: { [Op.in]: candidateUuids },
        tagUuid: { [Op.in]: tagUuids }
      },
      attributes: ['documentUuid', 'tagUuid']
    });
    const tagsByDocument = new Map<string, Set<string>>();
    for (const assignment of assignments) {
      const tags = tagsByDocument.get(assignment.documentUuid) ?? new Set<string>();
      tags.add(assignment.tagUuid);
      tagsByDocument.set(assignment.documentUuid, tags);
    }

    this.restrictToDocumentUuids(
      where,
      candidateUuids.filter((uuid) => tagUuids.every((tagUuid) => tagsByDocument.get(uuid)?.has(tagUuid)))
    );
  }

  private restrictToDocumentUuids(where: WhereOptions<Document>, uuids: string[]): void {
    const whereRecord = where as unknown as Record<string, unknown>;
    const currentUuid = whereRecord.uuid;
    const currentIn = currentUuid && typeof currentUuid === 'object'
      ? (currentUuid as Record<PropertyKey, unknown>)[Op.in]
      : undefined;
    const currentValues = Array.isArray(currentIn) ? currentIn as string[] : null;
    const restricted = currentValues
      ? uuids.filter((uuid) => currentValues.includes(uuid))
      : uuids;
    whereRecord.uuid = { [Op.in]: restricted };
  }

  private setFieldValues(where: WhereOptions<Document>, field: string, values: string[]): void {
    (where as unknown as Record<string, unknown>)[field] = { [Op.in]: values };
  }

  private async buildVocabularyFacetOptions(
    model: typeof DocumentType | typeof DocumentCategory,
    documents: Document[],
    field: 'documentTypeUuid' | 'categoryUuid',
    ownerUuid: string
  ): Promise<DocumentListFacetOption[]> {
    const ids = [...new Set(documents.map((document) => document[field]).filter((uuid): uuid is string => Boolean(uuid)))];
    if (ids.length === 0) return [];

    const values = await model.findAll({
      where: {
        uuid: { [Op.in]: ids },
        active: true,
        ownerUuid: { [Op.or]: [null, ownerUuid] }
      },
      attributes: ['uuid', 'name']
    });
    const counts = this.countBy(documents, (document) => document[field]);
    return this.optionsFromValues(values, counts);
  }

  private async buildIssuerFacetOptions(documents: Document[], ownerUuid: string): Promise<DocumentListFacetOption[]> {
    const ids = [...new Set(documents.map((document) => document.issuerUuid).filter((uuid): uuid is string => Boolean(uuid)))];
    if (ids.length === 0) return [];

    const values = await Issuer.findAll({
      where: { uuid: { [Op.in]: ids }, ownerUuid },
      attributes: ['uuid', 'name']
    });
    const counts = this.countBy(documents, (document) => document.issuerUuid);
    return this.optionsFromValues(values, counts);
  }

  private async buildTagFacetOptions(documents: Document[], ownerUuid: string): Promise<DocumentListFacetOption[]> {
    const documentUuids = documents.map((document) => document.uuid);
    if (documentUuids.length === 0) return [];

    const assignments = await DocumentTagAssignment.findAll({
      where: { documentUuid: { [Op.in]: documentUuids } },
      attributes: ['documentUuid', 'tagUuid']
    });
    const tagIds = [...new Set(assignments.map((assignment) => assignment.tagUuid))];
    if (tagIds.length === 0) return [];

    const values = await DocumentTag.findAll({
      where: {
        uuid: { [Op.in]: tagIds },
        active: true,
        ownerUuid: { [Op.or]: [null, ownerUuid] }
      },
      attributes: ['uuid', 'name']
    });
    const counts = new Map<string, number>();
    for (const assignment of assignments) {
      counts.set(assignment.tagUuid, (counts.get(assignment.tagUuid) ?? 0) + 1);
    }
    return this.optionsFromValues(values, counts);
  }

  private optionsFromValues(
    values: Array<{ uuid: string; name: string }>,
    counts: Map<string, number>
  ): DocumentListFacetOption[] {
    return values
      .map((value) => ({ value: value.uuid, label: value.name, count: counts.get(value.uuid) ?? 0 }))
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base', numeric: true }));
  }

  private buildScalarFacetOptions<T extends string>(
    values: T[],
    label: (value: T) => string
  ): DocumentListFacetOption[] {
    const counts = new Map<T, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts.entries()]
      .map(([value, count]) => ({ value, label: label(value), count }))
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }));
  }

  private countBy<T>(items: Document[], selector: (item: Document) => T | null): Map<T, number> {
    const counts = new Map<T, number>();
    for (const item of items) {
      const value = selector(item);
      if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
  }

  private async findOwnedTagGroupedPage(where: WhereOptions<Document>, query: DocumentListQuery) {
    const candidateDocuments = await this.model.findAll({
      where,
      attributes: ['uuid'],
      order: [
        [query.sort, query.direction.toUpperCase() as 'ASC' | 'DESC'],
        ['uuid', 'ASC']
      ]
    });
    const candidateUuids = candidateDocuments.map((document) => document.uuid);
    const total = candidateUuids.length;

    if (total === 0) {
      return {
        items: [],
        groupBy: query.groupBy,
        page: query.page,
        pageSize: query.pageSize,
        total: 0,
        totalPages: 0,
        hasNext: false,
        hasPrev: query.page > 1
      };
    }

    const sortPosition = new Map(candidateUuids.map((uuid, index) => [uuid, index]));
    const assignments = await DocumentTagAssignment.findAll({
      where: { documentUuid: { [Op.in]: candidateUuids } },
      attributes: ['documentUuid', 'tagUuid'],
      order: [
        ['tagUuid', query.groupDirection.toUpperCase() as 'ASC' | 'DESC'],
        ['documentUuid', 'ASC']
      ]
    });
    const documentsByTag = new Map<string, string[]>();
    const assignedDocuments = new Set<string>();

    for (const assignment of assignments) {
      if (assignedDocuments.has(assignment.documentUuid)) {
        continue;
      }
      const documents = documentsByTag.get(assignment.tagUuid) ?? [];
      documents.push(assignment.documentUuid);
      documentsByTag.set(assignment.tagUuid, documents);
      assignedDocuments.add(assignment.documentUuid);
    }

    const groupedUuids = [...documentsByTag.values()]
      .flatMap((uuids) => uuids.sort((left, right) => sortPosition.get(left)! - sortPosition.get(right)!));
    const untaggedUuids = candidateUuids.filter((uuid) => !assignedDocuments.has(uuid));
    const orderedUuids = [...groupedUuids, ...untaggedUuids];
    const offset = (query.page - 1) * query.pageSize;
    const pageUuids = orderedUuids.slice(offset, offset + query.pageSize);
    const rows = pageUuids.length === 0
      ? []
      : await this.model.findAll({ where: { ...where, uuid: { [Op.in]: pageUuids } } });
    const documentsByUuid = new Map(rows.map((document) => [document.uuid, document]));

    return {
      items: pageUuids.flatMap((uuid) => {
        const document = documentsByUuid.get(uuid);
        return document ? [document] : [];
      }),
      groupBy: query.groupBy,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
      hasNext: query.page * query.pageSize < total,
      hasPrev: query.page > 1
    };
  }

  private groupField(groupBy: DocumentListQuery['groupBy']): string {
    switch (groupBy) {
      case 'documentType':
        return 'documentTypeUuid';
      case 'category':
        return 'categoryUuid';
      case 'issuer':
        return 'issuerUuid';
      case 'status':
        return 'status';
      case 'isNew':
        return 'isNew';
      case 'tag':
        // Tag grouping is handled by findOwnedTagGroupedPage because tags are
        // many-to-many and do not have a single document column.
        return 'uuid';
      case 'none':
        return 'uuid';
    }
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
    const hasFilters = Boolean(query.status || query.issuerUuid || query.documentTypeUuid || query.categoryUuid || query.folderUuid || query.tagUuids?.length || query.metadata);
    if (!hasFilters) return null;
    const documents = await this.model.findAll({
      where: { ownerUuid, ...(query.status ? { status: query.status } : {}) },
      attributes: ['uuid', 'issuerUuid', 'documentTypeUuid', 'categoryUuid']
    });
    let allowed = new Set(documents.map((document) => document.uuid));
    if (query.folderUuid && allowed.size > 0) {
      const links = await DocumentFolder.findAll({
        where: { folderUuid: query.folderUuid, documentUuid: { [Op.in]: [...allowed] } },
        attributes: ['documentUuid']
      });
      allowed = new Set(links.map((link) => link.documentUuid));
    }
    if (query.issuerUuid || query.documentTypeUuid || query.categoryUuid) {
      const matching = documents.filter((document) =>
        (!query.issuerUuid || document.issuerUuid === query.issuerUuid) &&
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
      allowed = new Set([...allowed].filter((documentUuid) => query.tagUuids!.every((tagUuid) => tagsByDocument.get(documentUuid)?.has(tagUuid))));
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
