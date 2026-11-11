ALTER TABLE ai_provider_profiles
    ADD COLUMN IF NOT EXISTS temperature DOUBLE PRECISION NOT NULL DEFAULT 0.2;

ALTER TABLE ai_provider_profiles
    ADD CONSTRAINT ai_provider_profiles_temperature_check
    CHECK (temperature >= 0 AND temperature <= 2);
