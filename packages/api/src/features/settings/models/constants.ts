import { SettingsMapItem, SettingsSection } from "./settings";

export const settingsSections: SettingsSection[] = [
  {
    key: 'common',
    label: 'Common Settings',
  },
  {
    key: 'mailer',
    label: 'Mailer Settings',
  },
  {
    key: 'oidc',
    label: 'SSO/OIDC Login',
  },
  {
    key: 'documents',
    label: 'Document storage',
  },
  {
    key: 'pipeline',
    label: 'Processing pipeline',
  },
  {
    key: 'ai',
    label: 'AI assistance',
  },
];

export const settingsMap: SettingsMapItem[] = [
  {
    key: 'documents.storageRoot',
    valueFrom: 'documents.storageRoot',
    encrypted: false,
    default: '',
    label: 'Storage root',
    type: 'text',
    required: false,
    section: 'documents',
  },
  {
    key: 'documents.maxUploadBytes',
    valueFrom: 'documents.maxUploadBytes',
    encrypted: false,
    default: '52428800',
    label: 'Maximum upload size (bytes)',
    type: 'text',
    required: true,
    section: 'documents',
  },
  {
    key: 'pipeline.pollIntervalMs',
    valueFrom: 'pipeline.pollIntervalMs',
    encrypted: false,
    default: '2000',
    label: 'Worker polling interval (ms)',
    type: 'text',
    required: true,
    section: 'pipeline',
  },
  {
    key: 'pipeline.lockTimeoutMs',
    valueFrom: 'pipeline.lockTimeoutMs',
    encrypted: false,
    default: '900000',
    label: 'Worker lock timeout (ms)',
    type: 'text',
    required: true,
    section: 'pipeline',
  },
  {
    key: 'pipeline.reconcileIntervalMs',
    valueFrom: 'pipeline.reconcileIntervalMs',
    encrypted: false,
    default: '30000',
    label: 'Reconciliation interval (ms)',
    type: 'text',
    required: true,
    section: 'pipeline',
  },
  {
    key: 'inbox.enabled', valueFrom: 'inbox.enabled', encrypted: false, default: false,
    label: 'Enable inbox import', type: 'checkbox', section: 'documents',
  },
  {
    key: 'inbox.path', valueFrom: 'inbox.path', encrypted: false, default: 'inbox',
    label: 'Inbox path (relative to storage root)', type: 'text', required: true, section: 'documents',
  },
  {
    key: 'inbox.importOwnerUuid', valueFrom: 'inbox.importOwnerUuid', encrypted: false, default: '',
    label: 'Inbox import owner UUID', type: 'text', required: false, section: 'documents',
  },
  {
    key: 'inbox.pollIntervalMs', valueFrom: 'inbox.pollIntervalMs', encrypted: false, default: '5000',
    label: 'Inbox polling interval (ms)', type: 'text', required: true, section: 'documents',
  },
  {
    key: 'inbox.stabilityMs', valueFrom: 'inbox.stabilityMs', encrypted: false, default: '2000',
    label: 'Inbox file stability delay (ms)', type: 'text', required: true, section: 'documents',
  },
  {
    key: 'pipeline.ocrLanguages',
    valueFrom: 'pipeline.ocrLanguages',
    encrypted: false,
    default: 'deu+eng',
    label: 'OCR languages',
    type: 'text',
    required: true,
    section: 'pipeline',
  },
  {
    key: 'embeddings.enabled', valueFrom: 'embeddings.enabled', encrypted: false, default: false,
    label: 'Enable hosted semantic embeddings', type: 'checkbox', section: 'pipeline',
  },
  {
    key: 'embeddings.endpoint', valueFrom: 'embeddings.endpoint', encrypted: false,
    default: 'https://api.openai.com/v1/embeddings', label: 'Embedding endpoint', type: 'text', required: true, section: 'pipeline',
  },
  {
    key: 'embeddings.model', valueFrom: 'embeddings.model', encrypted: false, default: 'text-embedding-3-small',
    label: 'Embedding model', type: 'text', required: true, section: 'pipeline',
  },
  {
    key: 'embeddings.chunkSize', valueFrom: 'embeddings.chunkSize', encrypted: false, default: '1200',
    label: 'Embedding chunk size (characters)', type: 'text', required: true, section: 'pipeline',
  },
  {
    key: 'embeddings.chunkOverlap', valueFrom: 'embeddings.chunkOverlap', encrypted: false, default: '200',
    label: 'Embedding chunk overlap (characters)', type: 'text', required: true, section: 'pipeline',
  },
  {
    key: 'ai.titleSuggestions.enabled', valueFrom: 'ai.titleSuggestions.enabled', encrypted: false, default: false,
    label: 'Enable AI title suggestions', type: 'checkbox', section: 'ai',
  },
  {
    key: 'ai.provider', valueFrom: 'ai.provider', encrypted: false, default: 'openai-compatible',
    label: 'AI provider (shared)', type: 'text', required: true, section: 'ai',
  },
  {
    key: 'ai.endpoint', valueFrom: 'ai.endpoint', encrypted: false, default: 'https://api.openai.com/v1/chat/completions',
    label: 'Assistant endpoint', type: 'text', required: true, section: 'ai',
  },
  {
    key: 'ai.model', valueFrom: 'ai.model', encrypted: false, default: 'gpt-4o-mini',
    label: 'Assistant model', type: 'text', required: true, section: 'ai',
  },
  {
    key: 'ai.apiKey', valueFrom: 'ai.apiKey', encrypted: true, default: '',
    label: 'AI API key (shared)', type: 'password', required: false, section: 'ai',
  },
  {
    key: 'ai.documentAnalysis.prompt', valueFrom: 'ai.documentAnalysis.prompt', encrypted: false,
    default: 'Classify the document and create a concise human-readable title. Use only the supplied document types, categories, tags, and metadata keys. Never invent UUIDs, tags, types, categories, or custom keys. Use null or [] when uncertain. Return only the requested JSON object; never include markdown.',
    label: 'Document analysis prompt', type: 'textarea', required: true, section: 'ai',
  },
    {
    key: 'oidc.ISSUER_URL',
    valueFrom: 'OIDC_ISSUER_URL',
    encrypted: false,
    default: '',
    label: 'Issuer',
    type: 'text',
    required: true,
    section: 'oidc',
  },
  {
    key: 'oidc.CLIENT_ID',
    valueFrom: 'OIDC_CLIENT_ID',
    encrypted: false,
    default: '',
    label: 'Client ID',
    type: 'text',
    required: true,
    section: 'oidc',
  },
  {
    key: 'oidc.CLIENT_SECRET',
    valueFrom: 'OIDC_CLIENT_SECRET',
    encrypted: true,
    default: '',
    label: 'Client Secret',
    type: 'password',
    required: true,
    section: 'oidc',
  },
  {
    key: 'oidc.email_verified',
    valueFrom: 'email_verified',
    encrypted: false,
    default: false,
    label: 'Only accept verified eMails',
    type: 'checkbox',
    section: 'oidc',
  },
  {
    key: 'oidc.ACR_VALUES',
    valueFrom: 'acrValues',
    encrypted: false,
    default: '',
    label: 'Pass ACR Values if needed',
    type: 'text',
    section: 'oidc',
  }
]
