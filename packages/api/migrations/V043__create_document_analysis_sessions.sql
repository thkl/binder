CREATE TABLE IF NOT EXISTS document_analysis_sessions (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES ai_provider_profiles(id) ON DELETE SET NULL,
    remote_file_id VARCHAR(255) NOT NULL,
    remote_response_id VARCHAR(255),
    file_expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS document_analysis_sessions_owner_document_idx
    ON document_analysis_sessions (owner_id, document_id, created_at DESC);
