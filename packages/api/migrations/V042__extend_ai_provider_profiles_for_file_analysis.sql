ALTER TABLE ai_provider_profiles
    ADD COLUMN IF NOT EXISTS file_upload_endpoint VARCHAR(500),
    ADD COLUMN IF NOT EXISTS file_analysis_endpoint VARCHAR(500),
    ADD COLUMN IF NOT EXISTS file_analysis_model VARCHAR(150);
