INSERT INTO settings (key, value, is_encrypted, description, created_at, updated_at)
VALUES
    (
        'pipeline.ocrJobs',
        '1',
        FALSE,
        'Maximum number of OCRmyPDF worker jobs used for one document',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'pipeline.ocrRotatePages',
        'true',
        FALSE,
        'Use OCRmyPDF page-orientation detection',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'pipeline.ocrDeskew',
        'false',
        FALSE,
        'Use OCRmyPDF deskew processing; this increases CPU usage',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    )
ON CONFLICT (key) DO NOTHING;
