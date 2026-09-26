import { z } from 'zod';

export const DocumentStatusSchema = z.enum([
  'uploaded',
  'scanning',
  'processing',
  'ready',
  'failed'
]);

export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const DocumentSchema = z.object({
  uuid: z.uuid(),
  ownerUuid: z.uuid(),
  originalFilename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  storageKey: z.string().min(1),
  thumbnailKey: z.string().min(1).nullable().optional(),
  status: DocumentStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});

export type Document = z.infer<typeof DocumentSchema>;

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
  sort: z.enum(['createdAt', 'updatedAt', 'originalFilename', 'status']).default('createdAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  status: DocumentStatusSchema.optional(),
  q: z.string().trim().max(200).optional()
});

export type DocumentListQuery = z.infer<typeof DocumentListQuerySchema>;

export const DocumentListResponseSchema = z.object({
  items: z.array(DocumentSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
  hasNext: z.boolean(),
  hasPrev: z.boolean()
});

export type DocumentListResponse = z.infer<typeof DocumentListResponseSchema>;

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

export const SettingControlTypeSchema = z.enum(['text', 'password', 'checkbox']);
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
  patternMessage: z.string().max(500).optional()
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
