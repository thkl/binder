CREATE TABLE IF NOT EXISTS "settings" (
    "key" varchar(255) NOT NULL,
    "value" text NOT NULL,
    "value_iv" varchar(32),
    "is_encrypted" bool NOT NULL DEFAULT false,
    "description" varchar(500),
    "created_at" timestamptz NOT NULL,
    "updated_at" timestamptz NOT NULL,
    PRIMARY KEY ("key")
);


-- Indices
CREATE INDEX settings_is_encrypted_idx ON settings USING btree (is_encrypted);
