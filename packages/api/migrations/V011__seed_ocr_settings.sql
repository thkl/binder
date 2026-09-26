INSERT INTO settings (key, value, is_encrypted, description, created_at, updated_at)
VALUES
    ('pipeline.ocrLanguages', 'deu+eng', FALSE, 'Tesseract languages used by OCRmyPDF, for example deu+eng', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;
