CREATE TABLE IF NOT EXISTS push_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(200) NOT NULL UNIQUE,
    environment VARCHAR(16) NOT NULL CHECK (environment IN ('sandbox', 'production')),
    created_at TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS push_devices_owner_idx ON push_devices(owner_id);

CREATE TABLE IF NOT EXISTS push_notification_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('document-added', 'processing-complete', 'processing-failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    delivered_at TIMESTAMP(6) WITH TIME ZONE,
    last_error VARCHAR(500),
    created_at TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS push_notification_events_pending_idx
    ON push_notification_events(available_at, created_at) WHERE delivered_at IS NULL;

CREATE FUNCTION enqueue_document_push_notification() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO push_notification_events(owner_id, document_id, event_type)
        VALUES (NEW.owner_id, NEW.id, 'document-added');
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.status = 'ready' THEN
            INSERT INTO push_notification_events(owner_id, document_id, event_type)
            VALUES (NEW.owner_id, NEW.id, 'processing-complete');
        ELSIF NEW.status IN ('failed', 'quarantined') THEN
            INSERT INTO push_notification_events(owner_id, document_id, event_type)
            VALUES (NEW.owner_id, NEW.id, 'processing-failed');
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_push_notification_insert
    AFTER INSERT ON documents
    FOR EACH ROW EXECUTE FUNCTION enqueue_document_push_notification();

CREATE TRIGGER documents_push_notification_status
    AFTER UPDATE OF status ON documents
    FOR EACH ROW EXECUTE FUNCTION enqueue_document_push_notification();
