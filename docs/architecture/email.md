# Email integration

## Current slice

Binder now has an administrator-managed mailer settings group. The settings
are stored in PostgreSQL with the other runtime settings so deployments do not
need a second set of mail environment variables.

Outgoing SMTP settings are intended for password reset messages and future
notifications. Incoming IMAP settings prepare the email import adapter:

- server host, port, and secure transport;
- username and encrypted password;
- mailbox name;
- owner for imported documents;
- polling interval; and
- whether messages may be deleted after successful import.

The credentials are encrypted at rest. They are masked in settings responses
and must never appear in logs or error messages.

## Import boundary

The mailbox adapter will hand supported attachments to the existing inbox/import
pipeline. It must preserve message ID, sender, subject, and received time as
provenance metadata. Message IDs and attachment checksums must participate in
deduplication so repeated polling cannot create duplicate documents.

The adapter should be restart-safe and owner-scoped. It must not delete a
message until every supported attachment has been accepted by the import
pipeline. Unsupported attachments and failed imports remain visible for
operator recovery.

## Next implementation slice

The next email work is a worker-side IMAP adapter with connection validation,
safe polling, attachment filtering, inbox handoff, retry handling, and
structured failure reporting. Password-reset delivery can then reuse the SMTP
transport behind the same configuration boundary.
