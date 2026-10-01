ALTER TABLE pipeline_jobs
    DROP CONSTRAINT IF EXISTS pipeline_jobs_kind_check;

ALTER TABLE pipeline_jobs
    ADD CONSTRAINT pipeline_jobs_kind_check
    CHECK (kind IN ('malware-scan', 'thumbnail', 'text-extraction', 'ocr', 'embedding', 'pdfa'));
