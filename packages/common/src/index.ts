import { z } from 'zod';

export const DocumentStatusSchema = z.enum([
  'uploaded',
  'scanning',
  'processing',
  'ready',
  'failed'
]);

export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const DocumentGroupVocabularyValueSchema = z.object({
  uuid: z.uuid(),
  name: z.string().trim().min(1).max(150),
  translations: z.record(z.string(), z.string()).default({})
});

export const DocumentGroupIssuerValueSchema = z.object({
  uuid: z.uuid(),
  name: z.string().trim().min(1).max(200)
});

export const DocumentMetadataSummarySchema = z.object({
  documentType: DocumentGroupVocabularyValueSchema.nullable(),
  category: DocumentGroupVocabularyValueSchema.nullable(),
  issuer: DocumentGroupIssuerValueSchema.nullable(),
  tags: z.array(DocumentGroupVocabularyValueSchema)
});
export type DocumentMetadataSummary = z.infer<typeof DocumentMetadataSummarySchema>;

export const DocumentSchema = z.object({
  uuid: z.uuid(),
  ownerUuid: z.uuid(),
  title: z.string().max(255).nullable(),
  originalFilename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  storageKey: z.string().min(1),
  thumbnailKey: z.string().min(1).nullable().optional(),
  thumbnailUrl: z.string().min(1),
  pageCount: z.number().int().min(1),
  issuerUuid: z.uuid().nullable(),
  isNew: z.boolean(),
  metadataSummary: DocumentMetadataSummarySchema,
  status: DocumentStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});

export type Document = z.infer<typeof DocumentSchema>;

export const DocumentGroupBySchema = z.enum([
  'none',
  'documentType',
  'category',
  'issuer',
  'tag',
  'status',
  'isNew'
]);
export type DocumentGroupBy = z.infer<typeof DocumentGroupBySchema>;

export const DocumentExtractedTextPageSchema = z.object({
  pageNumber: z.number().int().positive(),
  text: z.string()
});
export type DocumentExtractedTextPage = z.infer<typeof DocumentExtractedTextPageSchema>;

export const DocumentExtractedTextResponseSchema = z.object({
  text: z.string(),
  pages: z.array(DocumentExtractedTextPageSchema)
});
export type DocumentExtractedTextResponse = z.infer<typeof DocumentExtractedTextResponseSchema>;

export const IssuerSchema = z.object({
  uuid: z.uuid(),
  ownerUuid: z.uuid(),
  name: z.string().trim().min(1).max(200),
  address: z.string().max(255).nullable(),
  zipCode: z.string().max(32).nullable(),
  city: z.string().max(150).nullable(),
  country: z.string().max(100).nullable(),
  custom: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});
export type Issuer = z.infer<typeof IssuerSchema>;

export const IssuerListResponseSchema = z.object({ items: z.array(IssuerSchema) });
export type IssuerListResponse = z.infer<typeof IssuerListResponseSchema>;

export const CreateIssuerInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(255).nullable().optional(),
  zipCode: z.string().trim().max(32).nullable().optional(),
  city: z.string().trim().max(150).nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  custom: z.record(z.string(), z.unknown()).optional().default({})
});
export type CreateIssuerInput = z.infer<typeof CreateIssuerInputSchema>;

export const UpdateIssuerInputSchema = CreateIssuerInputSchema.partial();
export type UpdateIssuerInput = z.infer<typeof UpdateIssuerInputSchema>;

export const SetDocumentTitleInputSchema = z.object({
  title: z.string().trim().min(1).max(255)
});
export type SetDocumentTitleInput = z.infer<typeof SetDocumentTitleInputSchema>;

export const DocumentTitleSuggestionSchema = z.object({
  suggestedTitle: z.string().trim().min(1).max(255),
  confidence: z.number().min(0).max(1),
  documentTypeUuid: z.uuid().nullable().default(null),
  categoryUuid: z.uuid().nullable().default(null),
  tagUuids: z.array(z.uuid()).max(50).default([]),
  custom: z.record(z.string(), z.unknown()).default({})
});
export type DocumentTitleSuggestion = z.infer<typeof DocumentTitleSuggestionSchema>;

export const DocumentBulkActionSchema = z.enum([
  'analyze',
  'requeue',
  'mark-reviewed'
]);
export type DocumentBulkAction = z.infer<typeof DocumentBulkActionSchema>;

export const DocumentBulkActionInputSchema = z.object({
  documentUuids: z.array(z.uuid()).min(1).max(100).refine(
    (uuids) => new Set(uuids).size === uuids.length,
    'Document UUIDs must be unique'
  ),
  action: DocumentBulkActionSchema
});
export type DocumentBulkActionInput = z.infer<typeof DocumentBulkActionInputSchema>;

export const DocumentBulkActionItemSchema = z.object({
  uuid: z.uuid(),
  success: z.boolean(),
  message: z.string().max(500).nullable()
});
export type DocumentBulkActionItem = z.infer<typeof DocumentBulkActionItemSchema>;

export const DocumentBulkActionResponseSchema = z.object({
  action: DocumentBulkActionSchema,
  requested: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  items: z.array(DocumentBulkActionItemSchema)
});
export type DocumentBulkActionResponse = z.infer<typeof DocumentBulkActionResponseSchema>;

export const ClearDocumentSuggestionResponseSchema = z.object({ cleared: z.boolean() });
export type ClearDocumentSuggestionResponse = z.infer<typeof ClearDocumentSuggestionResponseSchema>;

export const InboxItemStatusSchema = z.enum([
  'new',
  'processing',
  'imported',
  'duplicate',
  'rejected',
  'failed'
]);
export type InboxItemStatus = z.infer<typeof InboxItemStatusSchema>;

export const InboxAiStatusSchema = z.enum(['pending', 'processing', 'ready', 'failed']);
export type InboxAiStatus = z.infer<typeof InboxAiStatusSchema>;

export const InboxQueueItemSchema = z.object({
  uuid: z.uuid(),
  ownerUuid: z.uuid(),
  documentUuid: z.uuid().nullable(),
  originalFilename: z.string().min(1).max(255),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  sizeBytes: z.number().int().nonnegative(),
  status: InboxItemStatusSchema,
  aiStatus: InboxAiStatusSchema,
  aiSuggestion: DocumentTitleSuggestionSchema.nullable(),
  autoApplied: z.boolean(),
  lastError: z.string().max(2000).nullable(),
  aiError: z.string().max(2000).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});
export type InboxQueueItem = z.infer<typeof InboxQueueItemSchema>;

export const InboxQueueResponseSchema = z.object({
  items: z.array(InboxQueueItemSchema),
  total: z.number().int().nonnegative(),
  aiCandidates: z.number().int().nonnegative()
});
export type InboxQueueResponse = z.infer<typeof InboxQueueResponseSchema>;

export const InboxAiProcessResponseSchema = z.object({
  processed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  items: z.array(InboxQueueItemSchema)
});
export type InboxAiProcessResponse = z.infer<typeof InboxAiProcessResponseSchema>;

export const InboxRemoveResponseSchema = z.object({ removed: z.boolean() });
export type InboxRemoveResponse = z.infer<typeof InboxRemoveResponseSchema>;

export const InboxChangeEventSchema = z.object({
  type: z.literal('inbox.changed'),
  occurredAt: z.iso.datetime(),
  reason: z.string().max(100).optional()
});
export type InboxChangeEvent = z.infer<typeof InboxChangeEventSchema>;

export const CreateDocumentInputSchema = z.object({
  originalFilename: z.string().trim().min(1).max(255),
  mimeType: z.literal('application/pdf'),
  sizeBytes: z.number().int().positive(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/)
});

export type CreateDocumentInput = z.infer<typeof CreateDocumentInputSchema>;

export const DocumentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['createdAt', 'updatedAt', 'originalFilename', 'title', 'status']).default('createdAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  groupBy: DocumentGroupBySchema.default('none'),
  status: DocumentStatusSchema.optional(),
  issuerUuid: z.uuid().optional(),
  q: z.string().trim().max(200).optional()
});

export type DocumentListQuery = z.infer<typeof DocumentListQuerySchema>;

export const DocumentListResponseSchema = z.object({
  items: z.array(DocumentSchema),
  groupBy: DocumentGroupBySchema,
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
  hasNext: z.boolean(),
  hasPrev: z.boolean()
});

export type DocumentListResponse = z.infer<typeof DocumentListResponseSchema>;

export const DocumentSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: DocumentStatusSchema.optional(),
  documentTypeUuid: z.uuid().optional(),
  categoryUuid: z.uuid().optional(),
  issuerUuid: z.uuid().optional(),
  tagUuids: z.preprocess(
    (value) => typeof value === 'string' ? value.split(',').map((item) => item.trim()).filter(Boolean) : value,
    z.array(z.uuid()).max(20).optional()
  ),
  metadata: z.preprocess(
    (value) => {
      if (typeof value !== 'string' || value.trim() === '') return value;
      try { return JSON.parse(value); } catch { return value; }
    },
    z.record(z.string(), z.string()).optional()
  )
});
export type DocumentSearchQuery = z.infer<typeof DocumentSearchQuerySchema>;

export const DocumentSearchResultSchema = z.object({
  document: DocumentSchema,
  pageNumber: z.number().int().positive().nullable(),
  snippet: z.string().max(1000),
  matchType: z.enum(['text', 'title', 'semantic']),
  semanticScore: z.number().min(0).max(1).nullable()
});
export type DocumentSearchResult = z.infer<typeof DocumentSearchResultSchema>;

export const DocumentSearchResponseSchema = z.object({
  query: z.string().min(1),
  items: z.array(DocumentSearchResultSchema),
  total: z.number().int().nonnegative()
});
export type DocumentSearchResponse = z.infer<typeof DocumentSearchResponseSchema>;

export const PipelineJobKindSchema = z.enum([
  'thumbnail',
  'text-extraction',
  'ocr',
  'embedding'
]);
export type PipelineJobKind = z.infer<typeof PipelineJobKindSchema>;

export const PipelineJobStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled'
]);
export type PipelineJobStatus = z.infer<typeof PipelineJobStatusSchema>;

export const PipelineJobSchema = z.object({
  uuid: z.uuid(),
  documentUuid: z.uuid(),
  ownerUuid: z.uuid(),
  kind: PipelineJobKindSchema,
  status: PipelineJobStatusSchema,
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  availableAt: z.iso.datetime(),
  lockedAt: z.iso.datetime().nullable().optional(),
  startedAt: z.iso.datetime().nullable().optional(),
  completedAt: z.iso.datetime().nullable().optional(),
  lastError: z.string().max(2000).nullable().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});
export type PipelineJob = z.infer<typeof PipelineJobSchema>;

export const PipelineJobEventSchema = z.object({
  uuid: z.uuid(),
  jobUuid: z.uuid(),
  type: z.string().min(1).max(100),
  message: z.string().max(2000).nullable().optional(),
  createdAt: z.iso.datetime()
});
export type PipelineJobEvent = z.infer<typeof PipelineJobEventSchema>;

export const DocumentPipelineResponseSchema = z.object({
  jobs: z.array(PipelineJobSchema),
  events: z.array(PipelineJobEventSchema)
});
export type DocumentPipelineResponse = z.infer<typeof DocumentPipelineResponseSchema>;

export const PaginationMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0)
});

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('api'),
  version: z.string().min(1)
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ApiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().min(1).optional()
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

export const LoginInputSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(512)
});

export type LoginInput = z.infer<typeof LoginInputSchema>;

export const ChangePasswordInputSchema = z.object({
  currentPassword: z.string().min(1).max(512),
  newPassword: z.string().min(12).max(512)
});

export type ChangePasswordInput = z.infer<typeof ChangePasswordInputSchema>;

export const AuthenticatedUserSchema = z.object({
  uuid: z.uuid(),
  username: z.string().min(1),
  isAdmin: z.boolean(),
  mustChangePassword: z.boolean()
});

export type AuthenticatedUser = z.infer<typeof AuthenticatedUserSchema>;

export const UserDirectoryItemSchema = z.object({
  uuid: z.uuid(),
  username: z.string().min(1).max(100),
  email: z.string().email().nullable(),
  isAdmin: z.boolean()
});
export type UserDirectoryItem = z.infer<typeof UserDirectoryItemSchema>;

export const UserDirectoryResponseSchema = z.object({
  items: z.array(UserDirectoryItemSchema)
});
export type UserDirectoryResponse = z.infer<typeof UserDirectoryResponseSchema>;

export const AppLanguageSchema = z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/);
export type AppLanguage = z.infer<typeof AppLanguageSchema>;

export const LocalizedTextSchema = z.record(AppLanguageSchema, z.string().trim().max(150));
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

export const SettingControlTypeSchema = z.enum(['text', 'password', 'textarea', 'checkbox', 'select']);
export type SettingControlType = z.infer<typeof SettingControlTypeSchema>;

export const SettingValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const SettingsSectionSchema = z.object({
  key: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200)
});

export type SettingsSection = z.infer<typeof SettingsSectionSchema>;

export const SettingsMapItemSchema = z.object({
  section: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200),
  key: z.string().trim().min(1).max(255),
  valueFrom: z.string().trim().min(1).max(255),
  encrypted: z.boolean(),
  default: SettingValueSchema,
  type: SettingControlTypeSchema,
  required: z.boolean().optional(),
  requiredIf: z.string().trim().min(1).max(255).optional(),
  requiredIfValue: SettingValueSchema.optional(),
  pattern: z.string().max(1000).optional(),
  patternMessage: z.string().max(500).optional(),
  options: z.array(z.string().trim().min(1).max(100)).max(50).optional()
});

export type SettingsMapItem = z.infer<typeof SettingsMapItemSchema>;

export const ApplicationSettingsDataSchema = z.object({
  key: z.string().trim().min(1).max(255),
  value: z.string(),
  isEncrypted: z.boolean(),
  // The database column is nullable, so API responses may contain null.
  description: z.string().max(500).nullable().optional()
});

export type ApplicationSettingsData = z.infer<typeof ApplicationSettingsDataSchema>;

export const ApplicationSettingsTemplateSchema = z.object({
  sections: z.array(SettingsSectionSchema),
  items: z.array(SettingsMapItemSchema)
});

export type ApplicationSettingsTemplate = z.infer<typeof ApplicationSettingsTemplateSchema>;

export const ApplicationSettingsResponseSchema = z.object({
  template: ApplicationSettingsTemplateSchema,
  data: z.array(ApplicationSettingsDataSchema)
});

export type ApplicationSettingsResponse = z.infer<typeof ApplicationSettingsResponseSchema>;

export const SetApplicationSettingInputSchema = z.object({
  key: z.string().trim().min(1).max(255),
  value: z.string().max(100_000),
  isEncrypted: z.boolean().optional().default(false),
  description: z.string().trim().max(500).optional()
});

export type SetApplicationSettingInput = z.infer<typeof SetApplicationSettingInputSchema>;

export const SaveAllApplicationSettingsInputSchema = z.array(SetApplicationSettingInputSchema);
export type SaveAllApplicationSettingsInput = z.infer<typeof SaveAllApplicationSettingsInputSchema>;

export type ApiResponse<T> = { data: T };

export const VocabularyScopeSchema = z.enum(['system', 'personal']);
export type VocabularyScope = z.infer<typeof VocabularyScopeSchema>;

export const VocabularyItemSchema = z.object({
  uuid: z.uuid(),
  ownerUuid: z.uuid().nullable(),
  name: z.string().trim().min(1).max(150),
  translations: LocalizedTextSchema.default({}),
  description: z.string().max(500).nullable(),
  active: z.boolean(),
  scope: VocabularyScopeSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type VocabularyItem = z.infer<typeof VocabularyItemSchema>;

export const VocabularyResponseSchema = z.object({
  documentTypes: z.array(VocabularyItemSchema),
  categories: z.array(VocabularyItemSchema),
  tags: z.array(VocabularyItemSchema)
});
export type VocabularyResponse = z.infer<typeof VocabularyResponseSchema>;

export const CreateVocabularyItemSchema = z.object({
  name: z.string().trim().min(1).max(150),
  translations: LocalizedTextSchema.optional(),
  description: z.string().trim().max(500).optional(),
  scope: VocabularyScopeSchema.optional().default('personal')
});
export type CreateVocabularyItem = z.infer<typeof CreateVocabularyItemSchema>;

export const DocumentMetadataSchema = z.object({
  issuer: IssuerSchema.nullable(),
  documentType: VocabularyItemSchema.nullable(),
  category: VocabularyItemSchema.nullable(),
  tags: z.array(VocabularyItemSchema),
  custom: z.record(z.string(), z.unknown()),
  suggestion: DocumentTitleSuggestionSchema.nullable()
});
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;

export const MetadataFieldTypeSchema = z.enum(['text', 'number', 'date', 'datetime', 'boolean', 'select', 'multi-select']);
export type MetadataFieldType = z.infer<typeof MetadataFieldTypeSchema>;

export const MetadataDefinitionSchema = z.object({
  uuid: z.uuid(),
  ownerUuid: z.uuid().nullable(),
  key: z.string().regex(/^[a-z][a-zA-Z0-9_]*$/).max(100),
  label: z.string().trim().min(1).max(150),
  type: MetadataFieldTypeSchema,
  options: z.array(z.string().trim().min(1).max(150)).nullable(),
  unique: z.boolean(),
  mandatory: z.boolean(),
  active: z.boolean(),
  scope: VocabularyScopeSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type MetadataDefinition = z.infer<typeof MetadataDefinitionSchema>;

export const MetadataDefinitionsResponseSchema = z.object({
  items: z.array(MetadataDefinitionSchema)
});
export type MetadataDefinitionsResponse = z.infer<typeof MetadataDefinitionsResponseSchema>;

export const CreateMetadataDefinitionSchema = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z0-9_]*$/).max(100),
  label: z.string().trim().min(1).max(150),
  type: MetadataFieldTypeSchema,
  options: z.array(z.string().trim().min(1).max(150)).optional(),
  unique: z.boolean().optional().default(false),
  mandatory: z.boolean().optional().default(false),
  scope: VocabularyScopeSchema.optional().default('personal')
});
export type CreateMetadataDefinition = z.infer<typeof CreateMetadataDefinitionSchema>;

export const SetDocumentMetadataInputSchema = z.object({
  issuerUuid: z.uuid().nullable().optional(),
  documentTypeUuid: z.uuid().nullable().optional(),
  categoryUuid: z.uuid().nullable().optional(),
  tagUuids: z.array(z.uuid()).optional(),
  custom: z.record(z.string(), z.unknown()).optional()
});
export type SetDocumentMetadataInput = z.infer<typeof SetDocumentMetadataInputSchema>;
