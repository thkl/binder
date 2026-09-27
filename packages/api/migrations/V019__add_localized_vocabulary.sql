ALTER TABLE document_types
    ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE document_categories
    ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE document_tags
    ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE document_types
SET translations = CASE id
    WHEN '10000000-0000-4000-8000-000000000001' THEN '{"en":"Invoice","de":"Rechnung"}'::jsonb
    WHEN '10000000-0000-4000-8000-000000000002' THEN '{"en":"Contract","de":"Vertrag"}'::jsonb
    WHEN '10000000-0000-4000-8000-000000000003' THEN '{"en":"Official letter","de":"Amtliches Schreiben"}'::jsonb
    WHEN '10000000-0000-4000-8000-000000000004' THEN '{"en":"Insurance document","de":"Versicherungsdokument"}'::jsonb
    WHEN '10000000-0000-4000-8000-000000000005' THEN '{"en":"Receipt","de":"Quittung"}'::jsonb
    WHEN '10000000-0000-4000-8000-000000000006' THEN '{"en":"Vehicle document","de":"Fahrzeugdokument"}'::jsonb
    WHEN '10000000-0000-4000-8000-000000000007' THEN '{"en":"Medical document","de":"Medizinisches Dokument"}'::jsonb
    WHEN '10000000-0000-4000-8000-000000000008' THEN '{"en":"Tax document","de":"Steuerdokument"}'::jsonb
    WHEN '10000000-0000-4000-8000-000000000009' THEN '{"en":"Bank document","de":"Bankdokument"}'::jsonb
    ELSE translations
END
WHERE owner_id IS NULL;

UPDATE document_categories
SET translations = CASE id
    WHEN '20000000-0000-4000-8000-000000000001' THEN '{"en":"Finance","de":"Finanzen"}'::jsonb
    WHEN '20000000-0000-4000-8000-000000000002' THEN '{"en":"Contracts","de":"Verträge"}'::jsonb
    WHEN '20000000-0000-4000-8000-000000000003' THEN '{"en":"Vehicle","de":"Fahrzeug"}'::jsonb
    WHEN '20000000-0000-4000-8000-000000000004' THEN '{"en":"Insurance","de":"Versicherung"}'::jsonb
    WHEN '20000000-0000-4000-8000-000000000005' THEN '{"en":"Health","de":"Gesundheit"}'::jsonb
    WHEN '20000000-0000-4000-8000-000000000006' THEN '{"en":"Authorities","de":"Behörden"}'::jsonb
    WHEN '20000000-0000-4000-8000-000000000007' THEN '{"en":"Home","de":"Wohnen"}'::jsonb
    WHEN '20000000-0000-4000-8000-000000000008' THEN '{"en":"Taxes","de":"Steuern"}'::jsonb
    ELSE translations
END
WHERE owner_id IS NULL;
