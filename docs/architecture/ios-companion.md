# Mobile companion app

## Goal

The mobile companion is a P4 ingestion client for users who receive documents
on their phone. It should make sending a PDF or image to Binder as simple as
choosing Binder from the iOS Share Sheet or Android Sharesheet. The preferred
implementation is React Native so iOS and Android can share the upload queue,
authentication screens, API client, and status UI. The existing Angular
application remains the primary document-management UI.

## App shape

The app has a shared React Native core plus platform integrations:

- A React Native host application that provides authentication, native
  upload-queue status, account settings, and a route to the existing web UI.
- An iOS Share Extension that accepts supported files from the system Share
  Sheet and hands them to the host application through an App Group container.
- An Android share-target integration that accepts supported files from the
  Android Sharesheet and hands them to the host application through protected
  app storage.

The platform share integrations should hand off quickly and avoid depending on
a live API connection. They must not own the complete document workflow.

## Share and upload flow

1. The user chooses Binder in the iOS Share Sheet or Android Sharesheet for a
   PDF or supported image.
2. The platform integration validates the type and size, copies the file into
   protected app storage, and creates a durable pending-upload record.
3. The share integration reports that the file was accepted and closes
   promptly.
4. The host app or platform background-transfer facility uploads the pending
   item to the versioned document-upload endpoint when connectivity is
   available.
5. The API assigns ownership from the authenticated internal user and returns
   the normal document-processing response.
6. After a confirmed upload, the app removes the local pending file. Failed
   items remain visible with retry and removal actions.

The queue must use a checksum and client-generated idempotency key so retries
cannot create duplicate documents. Upload state should be persisted separately
from the file so an interrupted transfer can resume or retry safely.

## Authentication

The web UI can continue to use the existing Express session inside the
`WKWebView`. Native uploads must use an explicitly designed authenticated API
flow rather than copying raw session data into the Share Extension. The
preferred design is a short-lived, revocable upload credential scoped to the
current internal user and upload operation. It must not grant arbitrary API
access.

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
- The local queue must support explicit cleanup and must not silently delete a
  file after a failed upload.

## Initial acceptance criteria

- Binder appears as a share target on iOS and Android for PDFs and supported
  images.
- A shared file is accepted while offline and appears in the pending queue.
- The file uploads automatically after connectivity returns.
- A retry cannot create a duplicate document.
- Upload ownership matches the authenticated Binder user.
- The app can open the existing web UI without creating a second document
  management implementation.
