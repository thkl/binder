import { z } from 'zod';

export const DocumentStatusSchema = z.enum([
  'uploaded',
  'scanning',
  'processing',
  'ready',
  'failed',
  'quarantined',
]);

export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const DocumentArchiveStatusSchema = z.enum([
  'not-requested',
  'queued',
  'processing',
  'ready',
  'failed',
]);

export type DocumentArchiveStatus = z.infer<typeof DocumentArchiveStatusSchema>;

export const MaintenanceJobSchema = z.enum(['backup', 'backup-retention', 'storage-consistency']);
export type MaintenanceJob = z.infer<typeof MaintenanceJobSchema>;

export const MaintenanceRunStatusSchema = z.enum(['running', 'succeeded', 'failed']);
export type MaintenanceRunStatus = z.infer<typeof MaintenanceRunStatusSchema>;

export const MaintenanceRunSchema = z.object({
  uuid: z.uuid(),
  jobKey: MaintenanceJobSchema,
  status: MaintenanceRunStatusSchema,
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  nextRunAt: z.iso.datetime().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  artifactName: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  deletedFiles: z.number().int().nonnegative().nullable(),
  checkedFiles: z.number().int().nonnegative().nullable(),
  issueCount: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type MaintenanceRun = z.infer<typeof MaintenanceRunSchema>;

export const MaintenanceStatusResponseSchema = z.object({
  backupRootConfigured: z.boolean(),
  backupScope: z.enum(['database', 'full']),
  items: z.array(MaintenanceRunSchema),
});
export type MaintenanceStatusResponse = z.infer<typeof MaintenanceStatusResponseSchema>;

export const MaintenanceRequestResponseSchema = z.object({
  uuid: z.uuid(),
});
export type MaintenanceRequestResponse = z.infer<typeof MaintenanceRequestResponseSchema>;

export const DocumentStorageIssueTypeSchema = z.enum([
  'missing',
  'size-mismatch',
  'checksum-mismatch',
  'unreadable',
]);
export type DocumentStorageIssueType = z.infer<typeof DocumentStorageIssueTypeSchema>;

export const DocumentStorageIssueSchema = z.object({
  uuid: z.uuid(),
  documentUuid: z.uuid(),
  title: z.string().max(255).nullable(),
  originalFilename: z.string().min(1),
  storageKey: z.string().min(1),
  issueType: DocumentStorageIssueTypeSchema,
  status: z.enum(['open', 'resolved']),
  expectedSizeBytes: z.number().int().nonnegative(),
  actualSizeBytes: z.number().int().nonnegative().nullable(),
  expectedChecksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  actualChecksumSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  details: z.string().min(1).max(1000),
  firstDetectedAt: z.iso.datetime(),
  lastDetectedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
});
export type DocumentStorageIssue = z.infer<typeof DocumentStorageIssueSchema>;

export const DocumentStorageIssueListResponseSchema = z.object({
  items: z.array(DocumentStorageIssueSchema),
});
export type DocumentStorageIssueListResponse = z.infer<
  typeof DocumentStorageIssueListResponseSchema
>;

export const DocumentGroupVocabularyValueSchema = z.object({
  uuid: z.uuid(),
  name: z.string().trim().min(1).max(150),
  translations: z.record(z.string(), z.string()).default({}),
});

export const DocumentGroupIssuerValueSchema = z.object({
  uuid: z.uuid(),
  name: z.string().trim().min(1).max(200),
});

export const DocumentCustomMetadataSummarySchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  value: z.unknown(),
});
export type DocumentCustomMetadataSummary = z.infer<typeof DocumentCustomMetadataSummarySchema>;

export const DocumentMetadataSummarySchema = z.object({
  documentType: DocumentGroupVocabularyValueSchema.nullable(),
  category: DocumentGroupVocabularyValueSchema.nullable(),
  issuer: DocumentGroupIssuerValueSchema.nullable(),
  tags: z.array(DocumentGroupVocabularyValueSchema),
  custom: z.array(DocumentCustomMetadataSummarySchema).default([]),
});
export type DocumentMetadataSummary = z.infer<typeof DocumentMetadataSummarySchema>;

export const CalendarEventSchema = z.object({
  uuid: z.uuid(),
  documentUuid: z.uuid(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().trim().min(1).max(255),
  description: z.string().max(2000),
  downloadUrl: z.string().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const CalendarEventListResponseSchema = z.object({
  items: z.array(CalendarEventSchema),
});
export type CalendarEventListResponse = z.infer<typeof CalendarEventListResponseSchema>;

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
  archiveKey: z.string().min(1).nullable(),
  archiveUrl: z.string().min(1).nullable(),
  archiveStatus: DocumentArchiveStatusSchema,
  archiveError: z.string().max(2000).nullable(),
  calendarEventUrl: z.string().min(1).nullable().optional(),
  pageCount: z.number().int().min(1),
  issuerUuid: z.uuid().nullable(),
  isNew: z.boolean(),
  metadataSummary: DocumentMetadataSummarySchema,
  status: DocumentStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Document = z.infer<typeof DocumentSchema>;

export const DocumentDeleteResponseSchema = z.object({
  deleted: z.literal(true),
  uuid: z.uuid(),
});
export type DocumentDeleteResponse = z.infer<typeof DocumentDeleteResponseSchema>;

export const DocumentOpenResponseSchema = z.object({
  isNew: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type DocumentOpenResponse = z.infer<typeof DocumentOpenResponseSchema>;

export const FolderNodeSchema = z.object({
  uuid: z.uuid(),
  ownerUuid: z.uuid(),
  parentUuid: z.uuid().nullable(),
  name: z.string().trim().min(1).max(255),
  sortPosition: z.number().int().nonnegative(),
  childCount: z.number().int().nonnegative(),
  documentCount: z.number().int().nonnegative(),
  hasChildren: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type FolderNode = z.infer<typeof FolderNodeSchema>;

export const FolderListResponseSchema = z.object({
  parentUuid: z.uuid().nullable(),
  items: z.array(FolderNodeSchema),
});
export type FolderListResponse = z.infer<typeof FolderListResponseSchema>;

export const FolderDocumentListResponseSchema = z.object({
  items: z.array(FolderNodeSchema),
});
export type FolderDocumentListResponse = z.infer<typeof FolderDocumentListResponseSchema>;

export const CreateFolderInputSchema = z.object({
  name: z.string().trim().min(1).max(255),
  parentUuid: z.uuid().nullable().optional(),
  sortPosition: z.number().int().nonnegative().optional(),
});
export type CreateFolderInput = z.infer<typeof CreateFolderInputSchema>;

export const UpdateFolderInputSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    sortPosition: z.number().int().nonnegative().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'At least one folder property is required');
export type UpdateFolderInput = z.infer<typeof UpdateFolderInputSchema>;

export const MoveFolderInputSchema = z.object({
  parentUuid: z.uuid().nullable(),
  sortPosition: z.number().int().nonnegative().optional(),
});
export type MoveFolderInput = z.infer<typeof MoveFolderInputSchema>;

export const FolderDocumentInputSchema = z.object({
  documentUuids: z.array(z.uuid()).min(1).max(1000),
});
export type FolderDocumentInput = z.infer<typeof FolderDocumentInputSchema>;

export const FolderDocumentActionResponseSchema = z.object({
  folderUuid: z.uuid(),
  affected: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type FolderDocumentActionResponse = z.infer<typeof FolderDocumentActionResponseSchema>;

export const FolderDeleteResponseSchema = z.object({
  deleted: z.boolean(),
  promotedChildren: z.number().int().nonnegative(),
  removedLinks: z.number().int().nonnegative(),
});
export type FolderDeleteResponse = z.infer<typeof FolderDeleteResponseSchema>;

export const DocumentGroupBySchema = z.enum([
  'none',
  'documentType',
  'category',
  'issuer',
  'tag',
  'status',
  'isNew',
]);
export type DocumentGroupBy = z.infer<typeof DocumentGroupBySchema>;

export const DocumentExtractedTextPageSchema = z.object({
  pageNumber: z.number().int().positive(),
  text: z.string(),
});
export type DocumentExtractedTextPage = z.infer<typeof DocumentExtractedTextPageSchema>;

export const DocumentExtractedTextResponseSchema = z.object({
  text: z.string(),
  pages: z.array(DocumentExtractedTextPageSchema),
});
export type DocumentExtractedTextResponse = z.infer<typeof DocumentExtractedTextResponseSchema>;

export const DocumentAuditActorTypeSchema = z.enum(['user', 'worker', 'system']);
export type DocumentAuditActorType = z.infer<typeof DocumentAuditActorTypeSchema>;

export const DocumentAuditEventTypeSchema = z.enum([
  'uploaded',
  'title-changed',
  'metadata-changed',
  'folder-added',
  'folder-removed',
  'ai-suggestion-generated',
  'ai-suggestion-applied',
  'ai-suggestion-cleared',
  'classification-feedback',
  'classification-feedback-removed',
  'requeued',
  'archive-queued',
  'archive-generated',
  'archive-failed',
  'downloaded',
  'exported',
  'processing-started',
  'processing-succeeded',
  'processing-failed',
  'quarantined',
]);
export type DocumentAuditEventType = z.infer<typeof DocumentAuditEventTypeSchema>;

export const DocumentAuditEventSchema = z.object({
  uuid: z.uuid(),
  documentUuid: z.uuid(),
  actorUuid: z.uuid().nullable(),
  actorType: DocumentAuditActorTypeSchema,
  eventType: DocumentAuditEventTypeSchema,
  summary: z.string().min(1).max(500),
  details: z.record(z.string(), z.unknown()),
  changeSetUuid: z.uuid().nullable(),
  rollbackAvailable: z.boolean().default(false),
  createdAt: z.iso.datetime(),
});
export type DocumentAuditEvent = z.infer<typeof DocumentAuditEventSchema>;

export const DocumentAuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type DocumentAuditQuery = z.infer<typeof DocumentAuditQuerySchema>;

export const DocumentAuditResponseSchema = z.object({
  items: z.array(DocumentAuditEventSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
});
export type DocumentAuditResponse = z.infer<typeof DocumentAuditResponseSchema>;

export const PluginIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'Plugin ids must use kebab-case')
  .max(64);
export type PluginId = z.infer<typeof PluginIdSchema>;

export const PluginCapabilitySchema = z.enum([
  'document-events',
  'document-import',
  'document-analysis',
  'calendar',
  'mcp',
]);
export type PluginCapability = z.infer<typeof PluginCapabilitySchema>;

export const PluginManifestSchema = z.object({
  id: PluginIdSchema,
  name: z.string().trim().min(1).max(120),
  version: z
    .string()
    .trim()
    .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  description: z.string().trim().min(1).max(500),
  capabilities: z.array(PluginCapabilitySchema).min(1).max(20),
  enabled: z.boolean(),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export const PluginDocumentEventSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^document\.[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(120),
  documentUuid: z.uuid(),
  ownerUuid: z.uuid(),
  actorUuid: z.uuid().nullable(),
  actorType: DocumentAuditActorTypeSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
  occurredAt: z.iso.datetime(),
});
export type PluginDocumentEvent = z.infer<typeof PluginDocumentEventSchema>;

export const PluginListResponseSchema = z.object({
  items: z.array(PluginManifestSchema),
});
export type PluginListResponse = z.infer<typeof PluginListResponseSchema>;

export const IssuerSchema = z.object({
  uuid: z.uuid(),
  ownerUuid: z.uuid(),
  name: z.string().trim().min(1).max(200),
  address: z.string().max(255).nullable(),
  zipCode: z.string().max(32).nullable(),
  city: z.string().max(150).nullable(),
  country: z.string().max(100).nullable(),
  custom: z.record(z.string(), z.unknown()),
  folderUuid: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
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
  custom: z.record(z.string(), z.unknown()).optional().default({}),
  folderUuid: z.uuid().nullable().optional(),
});
export type CreateIssuerInput = z.infer<typeof CreateIssuerInputSchema>;

export const UpdateIssuerInputSchema = CreateIssuerInputSchema.partial();
export type UpdateIssuerInput = z.infer<typeof UpdateIssuerInputSchema>;

export const SetDocumentTitleInputSchema = z.object({
  title: z.string().trim().min(1).max(255),
});
export type SetDocumentTitleInput = z.infer<typeof SetDocumentTitleInputSchema>;

export const ClassificationFeedbackFieldSchema = z.enum([
  'documentType',
  'category',
  'issuer',
  'tag',
]);
export type ClassificationFeedbackField = z.infer<typeof ClassificationFeedbackFieldSchema>;

export const ClassificationSuggestionSourceSchema = z.enum(['ai', 'feedback', 'mixed']);
export type ClassificationSuggestionSource = z.infer<typeof ClassificationSuggestionSourceSchema>;

export const DocumentTitleSuggestionSchema = z.object({
  suggestedTitle: z.string().trim().min(1).max(255),
  confidence: z.number().min(0).max(1),
  issuerUuid: z.uuid().nullable().default(null),
  documentTypeUuid: z.uuid().nullable().default(null),
  categoryUuid: z.uuid().nullable().default(null),
  tagUuids: z.array(z.uuid()).max(50).default([]),
  custom: z.record(z.string(), z.unknown()).default({}),
  classificationSource: ClassificationSuggestionSourceSchema.default('ai'),
  feedbackFields: z.array(ClassificationFeedbackFieldSchema).max(10).default([]),
});
export type DocumentTitleSuggestion = z.infer<typeof DocumentTitleSuggestionSchema>;

export const ClassificationFeedbackSchema = z.object({
  uuid: z.uuid(),
  field: ClassificationFeedbackFieldSchema,
  valueUuid: z.uuid(),
  valueName: z.string().min(1),
  sourceDocumentUuid: z.uuid().nullable(),
  sourceDocumentTitle: z.string().max(255).nullable(),
  sourceOriginalFilename: z.string().min(1).max(255).nullable(),
  matchCount: z.number().int().positive(),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ClassificationFeedback = z.infer<typeof ClassificationFeedbackSchema>;

export const ClassificationFeedbackListResponseSchema = z.object({
  items: z.array(ClassificationFeedbackSchema),
});
export type ClassificationFeedbackListResponse = z.infer<
  typeof ClassificationFeedbackListResponseSchema
>;

export const ClassificationFeedbackDeleteResponseSchema = z.object({
  deleted: z.literal(true),
  uuid: z.uuid(),
});
export type ClassificationFeedbackDeleteResponse = z.infer<
  typeof ClassificationFeedbackDeleteResponseSchema
>;

export const DocumentBulkActionSchema = z.enum(['analyze', 'requeue', 'mark-reviewed']);
export type DocumentBulkAction = z.infer<typeof DocumentBulkActionSchema>;

export const DocumentBulkActionInputSchema = z.object({
  documentUuids: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((uuids) => new Set(uuids).size === uuids.length, 'Document UUIDs must be unique'),
  action: DocumentBulkActionSchema,
});
export type DocumentBulkActionInput = z.infer<typeof DocumentBulkActionInputSchema>;

export const DocumentExportSelectionInputSchema = z.object({
  documentUuids: z
    .array(z.uuid())
    .min(1)
    .max(1000)
    .refine((uuids) => new Set(uuids).size === uuids.length, 'Document UUIDs must be unique'),
});
export type DocumentExportSelectionInput = z.infer<typeof DocumentExportSelectionInputSchema>;

export const DocumentBulkActionItemSchema = z.object({
  uuid: z.uuid(),
  success: z.boolean(),
  message: z.string().max(500).nullable(),
});
export type DocumentBulkActionItem = z.infer<typeof DocumentBulkActionItemSchema>;

export const DocumentBulkActionResponseSchema = z.object({
  action: DocumentBulkActionSchema,
  requested: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  items: z.array(DocumentBulkActionItemSchema),
});
export type DocumentBulkActionResponse = z.infer<typeof DocumentBulkActionResponseSchema>;

export const BulkMetadataPolicySchema = z.enum(['fill-empty', 'skip-existing', 'replace-selected']);
export type BulkMetadataPolicy = z.infer<typeof BulkMetadataPolicySchema>;

export const BulkMetadataInputSchema = z.object({
  documentUuids: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((uuids) => new Set(uuids).size === uuids.length, 'Document UUIDs must be unique'),
  policy: BulkMetadataPolicySchema,
  metadata: z.lazy(() => SetDocumentMetadataInputSchema).default({}),
  folderUuids: z.array(z.uuid()).max(100).optional(),
});
export type BulkMetadataInput = z.infer<typeof BulkMetadataInputSchema>;

export const BulkMetadataPreviewItemSchema = z.object({
  documentUuid: z.uuid(),
  title: z.string().max(255).nullable(),
  applicableFields: z.array(z.string()),
  conflictingFields: z.array(z.string()),
  canApply: z.boolean(),
  reason: z.string().nullable(),
});
export type BulkMetadataPreviewItem = z.infer<typeof BulkMetadataPreviewItemSchema>;

export const BulkMetadataPreviewResponseSchema = z.object({
  policy: BulkMetadataPolicySchema,
  requested: z.number().int().nonnegative(),
  eligible: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
  items: z.array(BulkMetadataPreviewItemSchema),
});
export type BulkMetadataPreviewResponse = z.infer<typeof BulkMetadataPreviewResponseSchema>;

export const DocumentChangeSetStatusSchema = z.enum(['applied', 'rolled-back']);
export type DocumentChangeSetStatus = z.infer<typeof DocumentChangeSetStatusSchema>;

export const DocumentChangeSetSchema = z.object({
  uuid: z.uuid(),
  ownerUuid: z.uuid(),
  actorUuid: z.uuid().nullable(),
  policy: BulkMetadataPolicySchema,
  status: DocumentChangeSetStatusSchema,
  documentCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  rolledBackAt: z.iso.datetime().nullable(),
  rolledBackBy: z.uuid().nullable(),
});
export type DocumentChangeSet = z.infer<typeof DocumentChangeSetSchema>;

export const BulkMetadataApplyResponseSchema = z.object({
  changeSet: DocumentChangeSetSchema,
  requested: z.number().int().nonnegative(),
  applied: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
});
export type BulkMetadataApplyResponse = z.infer<typeof BulkMetadataApplyResponseSchema>;

export const DocumentChangeSetRollbackResponseSchema = z.object({
  changeSet: DocumentChangeSetSchema,
  rolledBack: z.number().int().nonnegative(),
  conflicts: z.array(
    z.object({
      documentUuid: z.uuid(),
      reason: z.string().min(1),
    }),
  ),
});
export type DocumentChangeSetRollbackResponse = z.infer<
  typeof DocumentChangeSetRollbackResponseSchema
>;

export const ClearDocumentSuggestionResponseSchema = z.object({ cleared: z.boolean() });
export type ClearDocumentSuggestionResponse = z.infer<typeof ClearDocumentSuggestionResponseSchema>;

export const InboxItemStatusSchema = z.enum([
  'new',
  'processing',
  'imported',
  'duplicate',
  'rejected',
  'failed',
]);
export type InboxItemStatus = z.infer<typeof InboxItemStatusSchema>;

export const InboxAiStatusSchema = z.enum(['pending', 'processing', 'ready', 'failed']);
export type InboxAiStatus = z.infer<typeof InboxAiStatusSchema>;

export const InboxQueueItemSchema = z.object({
  uuid: z.uuid(),
  ownerUuid: z.uuid(),
  documentUuid: z.uuid().nullable(),
  originalFilename: z.string().min(1).max(255),
  checksumSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  sizeBytes: z.number().int().nonnegative(),
  status: InboxItemStatusSchema,
  aiStatus: InboxAiStatusSchema,
  aiSuggestion: DocumentTitleSuggestionSchema.nullable(),
  autoApplied: z.boolean(),
  lastError: z.string().max(2000).nullable(),
  aiError: z.string().max(2000).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type InboxQueueItem = z.infer<typeof InboxQueueItemSchema>;

export const InboxQueueResponseSchema = z.object({
  items: z.array(InboxQueueItemSchema),
  total: z.number().int().nonnegative(),
  aiCandidates: z.number().int().nonnegative(),
});
export type InboxQueueResponse = z.infer<typeof InboxQueueResponseSchema>;

export const InboxAiProcessResponseSchema = z.object({
  processed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  items: z.array(InboxQueueItemSchema),
});
export type InboxAiProcessResponse = z.infer<typeof InboxAiProcessResponseSchema>;

export const InboxRemoveResponseSchema = z.object({ removed: z.boolean() });
export type InboxRemoveResponse = z.infer<typeof InboxRemoveResponseSchema>;

export const InboxBulkRemoveResponseSchema = z.object({ removed: z.number().int().nonnegative() });
export type InboxBulkRemoveResponse = z.infer<typeof InboxBulkRemoveResponseSchema>;

export const InboxChangeEventSchema = z.object({
  type: z.literal('inbox.changed'),
  occurredAt: z.iso.datetime(),
  reason: z.string().max(100).optional(),
  documentUuids: z.array(z.uuid()).default([]),
});
export type InboxChangeEvent = z.infer<typeof InboxChangeEventSchema>;

export const LogFileSourceSchema = z.enum(['application', 'worker']);
export type LogFileSource = z.infer<typeof LogFileSourceSchema>;

export const LogFileSchema = z.object({
  name: z.string().regex(/^(application|worker)(-error)?-\d{4}-\d{2}-\d{2}\.log(?:\.gz)?$/),
  source: LogFileSourceSchema,
  isError: z.boolean(),
  compressed: z.boolean(),
  sizeBytes: z.number().int().nonnegative(),
  modifiedAt: z.iso.datetime(),
});
export type LogFile = z.infer<typeof LogFileSchema>;

export const LogFileListResponseSchema = z.object({
  items: z.array(LogFileSchema),
});
export type LogFileListResponse = z.infer<typeof LogFileListResponseSchema>;

export const CreateDocumentInputSchema = z.object({
  originalFilename: z.string().trim().min(1).max(255),
  mimeType: z.literal('application/pdf'),
  sizeBytes: z.number().int().positive(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export type CreateDocumentInput = z.infer<typeof CreateDocumentInputSchema>;

const parseQueryArray = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  if (value.trim() === '') return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseQueryBoolean = (value: unknown): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

export const DocumentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z
    .enum(['createdAt', 'updatedAt', 'originalFilename', 'title', 'status'])
    .default('createdAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  groupBy: DocumentGroupBySchema.default('none'),
  groupDirection: z.enum(['asc', 'desc']).default('asc'),
  status: DocumentStatusSchema.optional(),
  issuerUuid: z.uuid().optional(),
  folderUuid: z.uuid().optional(),
  unassigned: z.preprocess(parseQueryBoolean, z.boolean().default(false)),
  q: z.string().trim().max(200).optional(),
  documentTypeUuids: z.preprocess(parseQueryArray, z.array(z.uuid()).max(100).optional()),
  categoryUuids: z.preprocess(parseQueryArray, z.array(z.uuid()).max(100).optional()),
  issuerUuids: z.preprocess(parseQueryArray, z.array(z.uuid()).max(100).optional()),
  tagUuids: z.preprocess(parseQueryArray, z.array(z.uuid()).max(100).optional()),
  statuses: z.preprocess(parseQueryArray, z.array(DocumentStatusSchema).max(20).optional()),
  reviewStates: z.preprocess(
    parseQueryArray,
    z
      .array(z.enum(['new', 'reviewed']))
      .max(2)
      .optional(),
  ),
});

export type DocumentListQuery = z.infer<typeof DocumentListQuerySchema>;

export const DocumentListFacetOptionSchema = z.object({
  value: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(200),
  count: z.number().int().nonnegative(),
  translations: z.record(z.string(), z.string()).default({}),
});
export type DocumentListFacetOption = z.infer<typeof DocumentListFacetOptionSchema>;

export const DocumentListFacetsResponseSchema = z.object({
  documentType: z.array(DocumentListFacetOptionSchema),
  category: z.array(DocumentListFacetOptionSchema),
  issuer: z.array(DocumentListFacetOptionSchema),
  tag: z.array(DocumentListFacetOptionSchema),
  status: z.array(DocumentListFacetOptionSchema),
  reviewState: z.array(DocumentListFacetOptionSchema),
});
export type DocumentListFacetsResponse = z.infer<typeof DocumentListFacetsResponseSchema>;

export const DocumentListResponseSchema = z.object({
  items: z.array(DocumentSchema),
  groupBy: DocumentGroupBySchema,
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
});

export type DocumentListResponse = z.infer<typeof DocumentListResponseSchema>;

export const DocumentSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  semanticThreshold: z.coerce.number().min(0).max(1).default(0.35),
  status: DocumentStatusSchema.optional(),
  documentTypeUuid: z.uuid().optional(),
  categoryUuid: z.uuid().optional(),
  issuerUuid: z.uuid().optional(),
  folderUuid: z.uuid().optional(),
  tagUuids: z.preprocess(
    (value) =>
      typeof value === 'string'
        ? value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : value,
    z.array(z.uuid()).max(20).optional(),
  ),
  metadata: z.preprocess((value) => {
    if (typeof value !== 'string' || value.trim() === '') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }, z.record(z.string(), z.string()).optional()),
});
export type DocumentSearchQuery = z.infer<typeof DocumentSearchQuerySchema>;

export const SavedSearchKindSchema = z.enum(['list', 'semantic']);
export type SavedSearchKind = z.infer<typeof SavedSearchKindSchema>;

export const SavedListSearchDefinitionSchema = z.object({
  kind: z.literal('list'),
  query: DocumentListQuerySchema.partial(),
});

export const SavedSemanticSearchDefinitionSchema = z.object({
  kind: z.literal('semantic'),
  query: DocumentSearchQuerySchema,
  onlySemantic: z.boolean().default(true),
});

export const SavedSearchDefinitionSchema = z.discriminatedUnion('kind', [
  SavedListSearchDefinitionSchema,
  SavedSemanticSearchDefinitionSchema,
]);
export type SavedSearchDefinition = z.infer<typeof SavedSearchDefinitionSchema>;

export const SavedSearchSchema = z.object({
  uuid: z.uuid(),
  ownerUuid: z.uuid(),
  name: z.string().trim().min(1).max(100),
  definition: SavedSearchDefinitionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SavedSearch = z.infer<typeof SavedSearchSchema>;

export const CreateSavedSearchInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  definition: SavedSearchDefinitionSchema,
});
export type CreateSavedSearchInput = z.infer<typeof CreateSavedSearchInputSchema>;

export const UpdateSavedSearchInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    definition: SavedSearchDefinitionSchema.optional(),
  })
  .refine(
    (input) => Object.keys(input).length > 0,
    'At least one saved search property is required',
  );
export type UpdateSavedSearchInput = z.infer<typeof UpdateSavedSearchInputSchema>;

export const SavedSearchListResponseSchema = z.object({
  items: z.array(SavedSearchSchema),
});
export type SavedSearchListResponse = z.infer<typeof SavedSearchListResponseSchema>;

export const SavedSearchDeleteResponseSchema = z.object({
  deleted: z.literal(true),
  uuid: z.uuid(),
});
export type SavedSearchDeleteResponse = z.infer<typeof SavedSearchDeleteResponseSchema>;

export const DocumentSearchResultSchema = z.object({
  document: DocumentSchema,
  pageNumber: z.number().int().positive().nullable(),
  snippet: z.string().max(1000),
  matchType: z.enum(['text', 'title', 'semantic']),
  semanticScore: z.number().min(0).max(1).nullable(),
});
export type DocumentSearchResult = z.infer<typeof DocumentSearchResultSchema>;

export const DocumentSearchResponseSchema = z.object({
  query: z.string().min(1),
  items: z.array(DocumentSearchResultSchema),
  total: z.number().int().nonnegative(),
});
export type DocumentSearchResponse = z.infer<typeof DocumentSearchResponseSchema>;

export const PipelineJobKindSchema = z.enum([
  'malware-scan',
  'thumbnail',
  'text-extraction',
  'ocr',
  'embedding',
  'pdfa',
]);
export type PipelineJobKind = z.infer<typeof PipelineJobKindSchema>;

export const PipelineJobStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
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
  updatedAt: z.iso.datetime(),
});
export type PipelineJob = z.infer<typeof PipelineJobSchema>;

export const PipelineJobEventSchema = z.object({
  uuid: z.uuid(),
  jobUuid: z.uuid(),
  type: z.string().min(1).max(100),
  message: z.string().max(2000).nullable().optional(),
  createdAt: z.iso.datetime(),
});
export type PipelineJobEvent = z.infer<typeof PipelineJobEventSchema>;

export const DocumentPipelineResponseSchema = z.object({
  jobs: z.array(PipelineJobSchema),
  events: z.array(PipelineJobEventSchema),
});
export type DocumentPipelineResponse = z.infer<typeof DocumentPipelineResponseSchema>;

export const PipelineJobMonitorQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: PipelineJobStatusSchema.optional(),
  kind: PipelineJobKindSchema.optional(),
});
export type PipelineJobMonitorQuery = z.infer<typeof PipelineJobMonitorQuerySchema>;

export const PipelineJobMonitorItemSchema = PipelineJobSchema.extend({
  documentTitle: z.string().nullable(),
  originalFilename: z.string().min(1),
  events: z.array(PipelineJobEventSchema),
});
export type PipelineJobMonitorItem = z.infer<typeof PipelineJobMonitorItemSchema>;

export const PipelineJobRetryResponseSchema = z.object({
  job: PipelineJobSchema,
  requeued: z.literal(true),
});
export type PipelineJobRetryResponse = z.infer<typeof PipelineJobRetryResponseSchema>;

export const PaginationMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

export const PipelineJobMonitorResponseSchema = z.object({
  items: z.array(PipelineJobMonitorItemSchema),
  meta: PaginationMetaSchema,
});
export type PipelineJobMonitorResponse = z.infer<typeof PipelineJobMonitorResponseSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('api'),
  version: z.string().min(1),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ApiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().min(1).optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

export const LoginInputSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(512),
});

export type LoginInput = z.infer<typeof LoginInputSchema>;

export const PasswordResetRequestInputSchema = z.object({
  identifier: z.string().trim().min(1).max(320),
});

export type PasswordResetRequestInput = z.infer<typeof PasswordResetRequestInputSchema>;

export const PasswordResetConfirmInputSchema = z.object({
  token: z.string().min(20).max(512),
  newPassword: z.string().min(12).max(512),
});

export type PasswordResetConfirmInput = z.infer<typeof PasswordResetConfirmInputSchema>;

export const SetupStatusSchema = z.object({
  required: z.boolean(),
  available: z.boolean(),
  onboardingRequired: z.boolean().default(false),
  onboardingCompleted: z.boolean().default(false),
});

export type SetupStatus = z.infer<typeof SetupStatusSchema>;

export const SetupCheckStatusSchema = z.enum(['ok', 'warning', 'error']);
export type SetupCheckStatus = z.infer<typeof SetupCheckStatusSchema>;

export const SetupCheckSchema = z.object({
  key: z.string().min(1),
  status: SetupCheckStatusSchema,
  message: z.string().min(1),
});
export type SetupCheck = z.infer<typeof SetupCheckSchema>;

export const SetupValidationResponseSchema = z.object({
  valid: z.boolean(),
  checks: z.array(SetupCheckSchema),
  checkedAt: z.iso.datetime(),
});
export type SetupValidationResponse = z.infer<typeof SetupValidationResponseSchema>;

export const SetupCompletionResponseSchema = z.object({
  completed: z.literal(true),
  completedAt: z.iso.datetime(),
});
export type SetupCompletionResponse = z.infer<typeof SetupCompletionResponseSchema>;

export const SetupAdminInputSchema = z.object({
  setupSecret: z.string().min(1).max(512),
  username: z.string().trim().min(1).max(100),
  password: z.string().min(12).max(512),
});

export type SetupAdminInput = z.infer<typeof SetupAdminInputSchema>;

export const ChangePasswordInputSchema = z.object({
  currentPassword: z.string().min(1).max(512),
  newPassword: z.string().min(12).max(512),
});

export type ChangePasswordInput = z.infer<typeof ChangePasswordInputSchema>;

export const AuthenticatedUserSchema = z.object({
  uuid: z.uuid(),
  username: z.string().min(1),
  isAdmin: z.boolean(),
  mustChangePassword: z.boolean(),
  gravatarUrl: z.url().nullable().default(null),
  mcpEnabled: z.boolean().default(true),
});

export type AuthenticatedUser = z.infer<typeof AuthenticatedUserSchema>;

export const ApiTokenPermissionSchema = z.enum([
  'documents:read',
  'documents:write',
  'folders:read',
  'folders:write',
  'analysis:execute',
  'audit:read',
]);
export type ApiTokenPermission = z.infer<typeof ApiTokenPermissionSchema>;

export const ApiTokenSchema = z.object({
  uuid: z.uuid(),
  name: z.string().min(1).max(100),
  tokenPrefix: z.string().min(1).max(32),
  permissions: z.array(ApiTokenPermissionSchema),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
});
export type ApiToken = z.infer<typeof ApiTokenSchema>;

export const ApiTokenListResponseSchema = z.object({ items: z.array(ApiTokenSchema) });
export type ApiTokenListResponse = z.infer<typeof ApiTokenListResponseSchema>;

export const CreateApiTokenInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  permissions: z.array(ApiTokenPermissionSchema).min(1).max(20),
  expiresAt: z.iso.datetime().nullable().optional(),
});
export type CreateApiTokenInput = z.infer<typeof CreateApiTokenInputSchema>;

export const CreatedApiTokenSchema = z.object({
  token: z.string().min(1),
  apiToken: ApiTokenSchema,
});
export type CreatedApiToken = z.infer<typeof CreatedApiTokenSchema>;

export const CsrfTokenSchema = z.string().min(32).max(128);
export const CsrfTokenResponseSchema = z.object({ csrfToken: CsrfTokenSchema });
export type CsrfTokenResponse = z.infer<typeof CsrfTokenResponseSchema>;

export const UserDirectoryItemSchema = z.object({
  uuid: z.uuid(),
  username: z.string().min(1).max(100),
  email: z.string().email().nullable(),
  isAdmin: z.boolean(),
});
export type UserDirectoryItem = z.infer<typeof UserDirectoryItemSchema>;

export const UserDirectoryResponseSchema = z.object({
  items: z.array(UserDirectoryItemSchema),
});
export type UserDirectoryResponse = z.infer<typeof UserDirectoryResponseSchema>;

export const ManagedUserSchema = z.object({
  uuid: z.uuid(),
  username: z.string().min(1).max(100),
  email: z.string().email().nullable(),
  isAdmin: z.boolean(),
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ManagedUser = z.infer<typeof ManagedUserSchema>;

export const ManagedUserListResponseSchema = z.object({
  items: z.array(ManagedUserSchema),
});
export type ManagedUserListResponse = z.infer<typeof ManagedUserListResponseSchema>;

export const CreateManagedUserInputSchema = z
  .object({
    username: z.string().trim().min(1).max(100),
    email: z.string().trim().email().nullable().optional(),
    password: z.string().max(512).nullable().optional(),
    isAdmin: z.boolean().default(false),
  })
  .superRefine((input, context) => {
    if (input.password && input.password.length < 12) {
      context.addIssue({
        code: 'too_small',
        origin: 'string',
        minimum: 12,
        inclusive: true,
        path: ['password'],
        message: 'Password must contain at least 12 characters',
      });
    }
    if (!input.password && !input.email) {
      context.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'A password or an email address is required',
      });
    }
  });
export type CreateManagedUserInput = z.infer<typeof CreateManagedUserInputSchema>;

export const UpdateManagedUserInputSchema = z
  .object({
    username: z.string().trim().min(1).max(100).optional(),
    email: z.string().trim().email().nullable().optional(),
    isAdmin: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'At least one user field is required');
export type UpdateManagedUserInput = z.infer<typeof UpdateManagedUserInputSchema>;

export const ResetManagedUserPasswordInputSchema = z.object({
  newPassword: z.string().min(12).max(512),
});
export type ResetManagedUserPasswordInput = z.infer<typeof ResetManagedUserPasswordInputSchema>;

export const ManagedUserResponseSchema = z.object({
  user: ManagedUserSchema,
});
export type ManagedUserResponse = z.infer<typeof ManagedUserResponseSchema>;

export const AppLanguageSchema = z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/);
export type AppLanguage = z.infer<typeof AppLanguageSchema>;

export const LocalizedTextSchema = z.record(AppLanguageSchema, z.string().trim().max(150));
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

export const SettingControlTypeSchema = z.enum([
  'text',
  'password',
  'textarea',
  'checkbox',
  'select',
  'metadata',
]);
export type SettingControlType = z.infer<typeof SettingControlTypeSchema>;

export const SettingValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const SettingsSectionSchema = z.object({
  key: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200),
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
  options: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
});

export type SettingsMapItem = z.infer<typeof SettingsMapItemSchema>;

export const ApplicationSettingsDataSchema = z.object({
  key: z.string().trim().min(1).max(255),
  value: z.string(),
  isEncrypted: z.boolean(),
  // The database column is nullable, so API responses may contain null.
  description: z.string().max(500).nullable().optional(),
});

export type ApplicationSettingsData = z.infer<typeof ApplicationSettingsDataSchema>;

export const ApplicationSettingsTemplateSchema = z.object({
  sections: z.array(SettingsSectionSchema),
  items: z.array(SettingsMapItemSchema),
});

export type ApplicationSettingsTemplate = z.infer<typeof ApplicationSettingsTemplateSchema>;

export const ApplicationSettingsResponseSchema = z.object({
  template: ApplicationSettingsTemplateSchema,
  data: z.array(ApplicationSettingsDataSchema),
});

export type ApplicationSettingsResponse = z.infer<typeof ApplicationSettingsResponseSchema>;

export const SetApplicationSettingInputSchema = z.object({
  key: z.string().trim().min(1).max(255),
  value: z.string().max(100_000),
  isEncrypted: z.boolean().optional().default(false),
  description: z.string().trim().max(500).optional(),
});

export type SetApplicationSettingInput = z.infer<typeof SetApplicationSettingInputSchema>;

export const SaveAllApplicationSettingsInputSchema = z.array(SetApplicationSettingInputSchema);
export type SaveAllApplicationSettingsInput = z.infer<typeof SaveAllApplicationSettingsInputSchema>;

export const AiProviderTypeSchema = z.literal('openai-compatible');
export type AiProviderType = z.infer<typeof AiProviderTypeSchema>;

export const AiProviderTaskSchema = z.enum(['assistant', 'embedding']);
export type AiProviderTask = z.infer<typeof AiProviderTaskSchema>;

export const AiProviderProfileSchema = z.object({
  uuid: z.uuid(),
  name: z.string().trim().min(1).max(100),
  providerType: AiProviderTypeSchema,
  assistantEndpoint: z.string().trim().max(500).nullable(),
  assistantModel: z.string().trim().max(150).nullable(),
  fileUploadEndpoint: z.string().trim().max(500).nullable(),
  fileAnalysisEndpoint: z.string().trim().max(500).nullable(),
  fileAnalysisModel: z.string().trim().max(150).nullable(),
  embeddingEndpoint: z.string().trim().max(500).nullable(),
  embeddingModel: z.string().trim().max(150).nullable(),
  apiKeyConfigured: z.boolean(),
  enabled: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AiProviderProfile = z.infer<typeof AiProviderProfileSchema>;

const AiProviderEndpointSchema = z.string().trim().max(500).default('');
const AiProviderModelSchema = z.string().trim().max(150).default('');

export const CreateAiProviderProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  providerType: AiProviderTypeSchema.default('openai-compatible'),
  assistantEndpoint: AiProviderEndpointSchema,
  assistantModel: AiProviderModelSchema,
  fileUploadEndpoint: AiProviderEndpointSchema,
  fileAnalysisEndpoint: AiProviderEndpointSchema,
  fileAnalysisModel: AiProviderModelSchema,
  embeddingEndpoint: AiProviderEndpointSchema,
  embeddingModel: AiProviderModelSchema,
  apiKey: z.string().max(100_000).optional(),
  enabled: z.boolean().default(true),
});
export type CreateAiProviderProfileInput = z.infer<typeof CreateAiProviderProfileInputSchema>;

export const UpdateAiProviderProfileInputSchema = CreateAiProviderProfileInputSchema.partial();
export type UpdateAiProviderProfileInput = z.infer<typeof UpdateAiProviderProfileInputSchema>;

export const AiProviderSelectionSchema = z.object({
  assistantProviderUuid: z.uuid().nullable(),
  embeddingProviderUuid: z.uuid().nullable(),
});
export type AiProviderSelection = z.infer<typeof AiProviderSelectionSchema>;

export const SetAiProviderSelectionInputSchema = AiProviderSelectionSchema;
export type SetAiProviderSelectionInput = z.infer<typeof SetAiProviderSelectionInputSchema>;

export const AiProviderConfigurationSchema = z.object({
  items: z.array(AiProviderProfileSchema),
  selection: AiProviderSelectionSchema,
});
export type AiProviderConfiguration = z.infer<typeof AiProviderConfigurationSchema>;

export const AiProviderTestInputSchema = z.object({
  task: AiProviderTaskSchema,
});
export type AiProviderTestInput = z.infer<typeof AiProviderTestInputSchema>;

export const AiProviderTestResponseSchema = z.object({
  success: z.boolean(),
  status: z.number().int().nonnegative(),
  message: z.string().max(500),
});
export type AiProviderTestResponse = z.infer<typeof AiProviderTestResponseSchema>;

export const DocumentAnalysisMessageRoleSchema = z.enum(['user', 'assistant']);
export type DocumentAnalysisMessageRole = z.infer<typeof DocumentAnalysisMessageRoleSchema>;

export const DocumentAnalysisMessageSchema = z.object({
  role: DocumentAnalysisMessageRoleSchema,
  text: z.string().min(1).max(50_000),
  createdAt: z.iso.datetime(),
});
export type DocumentAnalysisMessage = z.infer<typeof DocumentAnalysisMessageSchema>;

export const DocumentAnalysisPromptSchema = z.object({
  prompt: z.string().trim().min(1).max(10_000),
  forceNew: z.boolean().optional().default(false),
});
export type DocumentAnalysisPrompt = z.infer<typeof DocumentAnalysisPromptSchema>;

export const DocumentAnalysisFollowUpSchema = DocumentAnalysisPromptSchema.extend({
  sessionUuid: z.uuid(),
});
export type DocumentAnalysisFollowUp = z.infer<typeof DocumentAnalysisFollowUpSchema>;

export const DocumentAnalysisResponseSchema = z.object({
  sessionUuid: z.uuid(),
  documentUuid: z.uuid(),
  providerName: z.string().min(1).max(100),
  userMessage: DocumentAnalysisMessageSchema,
  assistantMessage: DocumentAnalysisMessageSchema,
  fileExpiresAt: z.iso.datetime().nullable(),
});
export type DocumentAnalysisResponse = z.infer<typeof DocumentAnalysisResponseSchema>;

export const DocumentAnalysisSessionStateSchema = z.object({
  sessionUuid: z.uuid(),
  documentUuid: z.uuid(),
  messages: z.array(DocumentAnalysisMessageSchema).max(100),
  fileExpiresAt: z.iso.datetime().nullable(),
});
export type DocumentAnalysisSessionState = z.infer<typeof DocumentAnalysisSessionStateSchema>;

export type ApiResponse<T> = { data: T };

export const VocabularyScopeSchema = z.enum(['system', 'personal']);
export type VocabularyScope = z.infer<typeof VocabularyScopeSchema>;

export const VocabularyItemSchema = z.object({
  uuid: z.uuid(),
  ownerUuid: z.uuid().nullable(),
  name: z.string().trim().min(1).max(150),
  translations: LocalizedTextSchema.default({}),
  description: z.string().max(500).nullable(),
  folderUuid: z.uuid().nullable(),
  active: z.boolean(),
  scope: VocabularyScopeSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type VocabularyItem = z.infer<typeof VocabularyItemSchema>;

export const VocabularyDeleteResponseSchema = z.object({
  deleted: z.literal(true),
  uuid: z.uuid(),
});
export type VocabularyDeleteResponse = z.infer<typeof VocabularyDeleteResponseSchema>;

export const VocabularyResponseSchema = z.object({
  documentTypes: z.array(VocabularyItemSchema),
  categories: z.array(VocabularyItemSchema),
  tags: z.array(VocabularyItemSchema),
});
export type VocabularyResponse = z.infer<typeof VocabularyResponseSchema>;

export const CreateVocabularyItemSchema = z.object({
  name: z.string().trim().min(1).max(150),
  translations: LocalizedTextSchema.optional(),
  description: z.string().trim().max(500).optional(),
  scope: VocabularyScopeSchema.optional().default('personal'),
  folderUuid: z.uuid().nullable().optional(),
});
export type CreateVocabularyItem = z.infer<typeof CreateVocabularyItemSchema>;

export const UpdateVocabularyItemSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  translations: LocalizedTextSchema.optional(),
  description: z.string().trim().max(500).nullable().optional(),
  folderUuid: z.uuid().nullable().optional(),
});
export type UpdateVocabularyItem = z.infer<typeof UpdateVocabularyItemSchema>;

export const DocumentMetadataSchema = z.object({
  issuer: IssuerSchema.nullable(),
  documentType: VocabularyItemSchema.nullable(),
  category: VocabularyItemSchema.nullable(),
  tags: z.array(VocabularyItemSchema),
  custom: z.record(z.string(), z.unknown()),
  suggestion: DocumentTitleSuggestionSchema.nullable(),
});
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;

export const MetadataFieldTypeSchema = z.enum([
  'text',
  'number',
  'date',
  'datetime',
  'boolean',
  'select',
  'multi-select',
]);
export type MetadataFieldType = z.infer<typeof MetadataFieldTypeSchema>;

export const MetadataDefinitionSchema = z.object({
  uuid: z.uuid(),
  ownerUuid: z.uuid().nullable(),
  key: z
    .string()
    .regex(/^[a-z][a-zA-Z0-9_]*$/)
    .max(100),
  label: z.string().trim().min(1).max(150),
  type: MetadataFieldTypeSchema,
  options: z.array(z.string().trim().min(1).max(150)).nullable(),
  unique: z.boolean(),
  mandatory: z.boolean(),
  active: z.boolean(),
  scope: VocabularyScopeSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MetadataDefinition = z.infer<typeof MetadataDefinitionSchema>;

export const MetadataDefinitionsResponseSchema = z.object({
  items: z.array(MetadataDefinitionSchema),
});
export type MetadataDefinitionsResponse = z.infer<typeof MetadataDefinitionsResponseSchema>;

export const CreateMetadataDefinitionSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-zA-Z0-9_]*$/)
    .max(100),
  label: z.string().trim().min(1).max(150),
  type: MetadataFieldTypeSchema,
  options: z.array(z.string().trim().min(1).max(150)).optional(),
  unique: z.boolean().optional().default(false),
  mandatory: z.boolean().optional().default(false),
  scope: VocabularyScopeSchema.optional().default('personal'),
});
export type CreateMetadataDefinition = z.infer<typeof CreateMetadataDefinitionSchema>;

export const UpdateMetadataDefinitionSchema = z.object({
  label: z.string().trim().min(1).max(150),
});
export type UpdateMetadataDefinition = z.infer<typeof UpdateMetadataDefinitionSchema>;

export const MetadataDefinitionDeleteResponseSchema = z.object({
  deleted: z.literal(true),
  uuid: z.uuid(),
});
export type MetadataDefinitionDeleteResponse = z.infer<
  typeof MetadataDefinitionDeleteResponseSchema
>;

export const SetDocumentMetadataInputSchema = z.object({
  issuerUuid: z.uuid().nullable().optional(),
  documentTypeUuid: z.uuid().nullable().optional(),
  categoryUuid: z.uuid().nullable().optional(),
  tagUuids: z.array(z.uuid()).optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});
export type SetDocumentMetadataInput = z.infer<typeof SetDocumentMetadataInputSchema>;
