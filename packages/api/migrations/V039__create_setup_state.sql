CREATE TABLE IF NOT EXISTS setup_state (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    completed_at TIMESTAMPTZ
);

INSERT INTO setup_state (id, completed_at)
VALUES (
    1,
    CASE WHEN EXISTS (SELECT 1 FROM users) THEN CURRENT_TIMESTAMP ELSE NULL END
)
ON CONFLICT (id) DO UPDATE
SET completed_at = COALESCE(setup_state.completed_at, EXCLUDED.completed_at);
