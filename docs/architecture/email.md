# Email integration

## Current slice

Binder now has administrator-managed SMTP settings and per-user mailbox
configuration. SMTP settings remain global; IMAP credentials and import policy
belong to the user who owns the imported documents.

Outgoing SMTP settings are intended for password reset messages and future
notifications. Each user can configure one IMAP mailbox:

- server host, port, and secure transport;
- username and encrypted password;
- mailbox name;
- the authenticated user as owner for imported documents;
- polling interval; and
- whether messages may be deleted after successful import.

The credentials are encrypted at rest. They are masked in settings responses
and must never appear in logs or error messages. The worker applies an
optional exact trusted-sender allowlist, accepts PDF attachments only, and
hands accepted files to the existing inbox pipeline. Malware scanning remains
mandatory before extraction, OCR, previews, exports, or AI processing.

## Import boundary

The mailbox adapter hands supported attachments to the existing inbox/import
pipeline. It must preserve message ID, sender, subject, and received time as
provenance metadata. Message IDs and attachment checksums must participate in
deduplication so repeated polling cannot create duplicate documents.

The adapter should be restart-safe and owner-scoped. It must not delete a
message until every supported attachment has been accepted by the import
pipeline. Unsupported attachments and failed imports remain visible for
operator recovery.

## Next implementation slice

The remaining email work is connection testing in the client, richer message
provenance in the inbox history, and operational retry/reporting controls.
Password-reset delivery can then reuse the SMTP transport behind the same
configuration boundary.
