# Mobile companion app

## Goal and implementation

The mobile app packages the existing Angular client with Capacitor for iOS and
Android. It avoids a second document-management UI while retaining native
platform entry points for future share-sheet ingestion. The web bundle is
included in each app; users configure the Binder server address on first launch.

Capacitor is the chosen native runtime. The Angular client continues to own
login, document browsing, and ordinary browser uploads. The API allows the
fixed Capacitor origins for credentialed requests, and secure deployments use
cross-site session cookies. Native app builds remain separate from server images.

## Share and upload flow

The planned native ingestion flow is:

1. The user chooses Binder in the iOS Share Sheet or Android Sharesheet for a
   PDF or supported image.
2. A native share extension/intent integration validates the type and size,
   copies the file into protected app storage, and creates a durable
   pending-upload record.
3. The share UI reports that the file was accepted and closes promptly.
4. The app uploads pending items when connectivity is available.
5. The API assigns ownership from the authenticated internal user and uses the
   normal document-processing pipeline.
6. After a confirmed upload, the app removes the local pending file. Failed
   items remain visible with retry and removal actions.

The queue should use a checksum and client-generated idempotency key so retries
cannot create duplicate documents. Upload state should be persisted separately
from the file so an interrupted transfer can retry safely.

## Authentication and security

The Angular app uses Binder's existing session login. The API's CORS and CSRF
checks allow the iOS Capacitor origin (`capacitor://localhost`) and Android
origin (`https://localhost`), in addition to the configured `ROOT_URI`. HTTPS
is required for production so cross-origin session cookies remain secure. If
Capacitor's native HTTP transport omits `Origin`, the client marks mutations
with a Capacitor header; the API accepts that marker only when no `Origin` or
`Referer` is present. Browser-originated requests still require the configured
or native origin.

Native share uploads must use an explicitly designed authenticated API flow
rather than copying raw session data into a share extension. Prefer a short-lived,
revocable upload credential scoped to the current internal user and upload
operation. It must not grant arbitrary API access.

The API must continue to enforce ownership, file validation, rate limits, and
the same processing pipeline used by browser uploads.

## Offline and privacy requirements

- No network must be required for accepting a shared file.
- Pending files use iOS file protection or the Android equivalent and are
  stored only in protected app storage until upload succeeds or the user
  removes them.
- Background retry uses bounded exponential backoff and respects each
  platform's network and battery settings.
- The app shows pending, uploading, uploaded, and failed states with the
  server-assigned document identifier when available.
- The local queue supports explicit cleanup and does not silently delete a
  file after a failed upload.

## Current status

The Capacitor iOS and Android projects now bundle the Angular client, and the
mobile app has a Binder server-address screen. Native share extensions/targets,
secure automatic credential storage, and offline upload queueing remain future
work. The mobile web file picker can be used for uploads in the meantime.
