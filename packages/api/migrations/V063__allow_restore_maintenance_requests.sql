ALTER TABLE maintenance_requests
  DROP CONSTRAINT IF EXISTS maintenance_requests_job_check;

ALTER TABLE maintenance_requests
  ADD CONSTRAINT maintenance_requests_job_check
  CHECK (job_key IN ('backup', 'restore'));
