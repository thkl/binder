ALTER TABLE ai_provider_profiles
    ADD COLUMN IF NOT EXISTS assistant_request_options JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE ai_provider_profiles
    ADD CONSTRAINT ai_provider_profiles_request_options_object_check
    CHECK (jsonb_typeof(assistant_request_options) = 'object');
