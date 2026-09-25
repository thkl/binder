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
  id: z.uuid(),
  ownerId: z.string().min(1),
  originalFilename: z.string().min(1),
  mimeType: z.string().min(1),
  status: DocumentStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});

export type Document = z.infer<typeof DocumentSchema>;

export const CreateDocumentInputSchema = z.object({
  originalFilename: z.string().min(1).max(255),
  mimeType: z.string().min(1)
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
  id: z.uuid(),
  username: z.string().min(1),
  isAdmin: z.boolean(),
  mustChangePassword: z.boolean()
});

export type AuthenticatedUser = z.infer<typeof AuthenticatedUserSchema>;
