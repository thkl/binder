/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DOCUMENT_FORMAT_CATALOG,
  DocumentFormatDescriptorSchema,
  DocumentFormatsResponseSchema,
  DocumentExtractedTextResponseSchema,
  DocumentListQuerySchema,
  DocumentSchema,
  DocumentSearchQuerySchema,
} from './index.js';

const documentUuid = '11111111-1111-4111-8111-111111111111';
const ownerUuid = '22222222-2222-4222-8222-222222222222';

function createDocument(): unknown {
  return {
    uuid: documentUuid,
    ownerUuid,
    versionFamilyUuid: documentUuid,
    versionNumber: 1,
    versionParentUuid: null,
    title: 'Service report',
    originalFilename: 'service-report.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    checksumSha256: 'a'.repeat(64),
    storageKey: 'documents/2026/10/document.pdf',
    thumbnailKey: null,
    thumbnailUrl: '/api/v1/documents/thumbnail',
    archiveKey: null,
    archiveUrl: null,
    archiveStatus: 'not-requested',
    archiveError: null,
    pageCount: 1,
    issuerUuid: null,
    isNew: false,
    metadataSummary: {
      documentType: null,
      category: null,
      issuer: null,
      tags: [],
      custom: [],
    },
    status: 'ready',
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  };
}

describe('common document contracts', () => {
  it('describes PDF as the initial supported document format', () => {
    assert.deepEqual(
      DocumentFormatsResponseSchema.parse({ formats: DOCUMENT_FORMAT_CATALOG }).formats[0],
      {
        id: 'pdf',
        displayName: 'PDF',
        extensions: ['.pdf'],
        mimeTypes: ['application/pdf'],
        capabilities: [
          'upload',
          'download',
          'preview',
          'text-extraction',
          'ocr',
          'file-analysis',
          'page-count',
          'page-rotation',
          'split',
          'compose',
          'pdfa',
        ],
      },
    );
  });

  it('rejects invalid format identifiers, extensions, MIME types, and capabilities', () => {
    const pdf = DOCUMENT_FORMAT_CATALOG[0];

    assert.equal(DocumentFormatDescriptorSchema.safeParse({ ...pdf, id: 'PDF' }).success, false);
    assert.equal(
      DocumentFormatDescriptorSchema.safeParse({ ...pdf, extensions: ['pdf'] }).success,
      false,
    );
    assert.equal(
      DocumentFormatDescriptorSchema.safeParse({ ...pdf, mimeTypes: ['not-a-mime-type'] }).success,
      false,
    );
    assert.equal(
      DocumentFormatDescriptorSchema.safeParse({ ...pdf, capabilities: ['unsupported'] }).success,
      false,
    );
  });

  it('accepts a document response with nullable archive fields', () => {
    const result = DocumentSchema.safeParse(createDocument());

    assert.equal(result.success, true);
  });

  it('accepts an unpaged document and extracted segments without physical page numbers', () => {
    const document = DocumentSchema.safeParse({
      ...(createDocument() as Record<string, unknown>),
      pageCount: null,
    });
    const extractedText = DocumentExtractedTextResponseSchema.safeParse({
      text: 'Plain text content',
      segments: [{ segmentIndex: 1, pageNumber: null, text: 'Plain text content' }],
      pages: [],
    });

    assert.equal(document.success, true);
    assert.equal(extractedText.success, true);
  });

  it('rejects a document response with an invalid checksum', () => {
    const document = createDocument() as Record<string, unknown>;
    document.checksumSha256 = 'not-a-checksum';

    const result = DocumentSchema.safeParse(document);

    assert.equal(result.success, false);
  });

  it('normalizes list and semantic search defaults', () => {
    const listQuery = DocumentListQuerySchema.parse({});
    const searchQuery = DocumentSearchQuerySchema.parse({ q: 'car inspection' });

    assert.deepEqual(
      {
        page: listQuery.page,
        pageSize: listQuery.pageSize,
        sort: listQuery.sort,
        direction: listQuery.direction,
      },
      { page: 1, pageSize: 25, sort: 'createdAt', direction: 'desc' },
    );
    assert.equal(searchQuery.limit, 20);
    assert.equal(searchQuery.semanticThreshold, 0.35);
  });
});
