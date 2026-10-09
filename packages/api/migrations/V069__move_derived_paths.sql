UPDATE documents
SET thumbnail_key = 'derived/'
  || to_char(created_at AT TIME ZONE 'UTC', 'YYYY')
  || '/'
  || to_char(created_at AT TIME ZONE 'UTC', 'MM')
  || '/'
  || split_part(thumbnail_key, '/', 2)
  || '/'
  || split_part(thumbnail_key, '/', 3)
WHERE thumbnail_key IS NOT NULL
  AND array_length(string_to_array(thumbnail_key, '/'), 1) = 3;

UPDATE documents
SET archive_key = 'derived/'
  || to_char(created_at AT TIME ZONE 'UTC', 'YYYY')
  || '/'
  || to_char(created_at AT TIME ZONE 'UTC', 'MM')
  || '/'
  || split_part(archive_key, '/', 2)
  || '/'
  || split_part(archive_key, '/', 3)
WHERE archive_key IS NOT NULL
  AND array_length(string_to_array(archive_key, '/'), 1) = 3;
