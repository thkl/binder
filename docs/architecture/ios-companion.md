# Mobile companion app

## Goal and implementation

The mobile app uses a thin Capacitor shell for iOS and Android and loads the
existing Angular client from the user's configured Binder server. A small local
bootstrap screen collects the server address on first launch; the native shell
persists that address and allows navigation only to that exact server origin.
The web client therefore uses the server's normal same-origin session and API
routes rather than maintaining mobile-specific document and authentication
paths.

Capacitor is the chosen native runtime. The Angular client continues to own
login, document browsing, and uploads. The mobile shell does not enable wildcard
navigation; its native bridge checks the configured server origin. Native app
builds remain separate from server images.

## iOS Share Sheet and upload flow

The iOS Share Extension accepts up to ten PDFs, with the same 50 MiB per-file
limit as the API. It stages each file in the shared App Group container
`group.network.thkl.binder.mobile`, then opens Binder using the `binder://share`
URL scheme. The extension does not receive Binder credentials or make API
requests.

The signed-in Angular client reads pending files from the native bridge in
bounded chunks and uploads them through its existing same-origin session,
CSRF, and document upload flow. If the user is signed out, the staged files
remain queued until they sign in. Successfully uploaded files and server-side
duplicates are removed from the queue; failures remain queued and can be retried
from the app. The queue is retried when the app is opened or returns to the
foreground; background upload is not implemented.

To run on a physical device, register the App Group identifier in the Apple
Developer account and enable it for both the Binder app and BinderShare targets.
If the app's bundle identifier is customized, the extension bundle identifier
must use the matching `.share` suffix. Android inbound sharing is not currently
implemented.

## Authentication and security

The Angular app uses Binder's existing session login. Since the UI is loaded
from the Binder server, its API requests and session cookie are same-origin.
The Capacitor shell validates the configured address and restricts WebView
navigation to the local bootstrap origin and that exact server origin.

The share extension only stages files locally. Uploads happen in the existing
authenticated web session, so session cookies and CSRF tokens are not copied
into the extension or stored in the App Group. The API continues to enforce
ownership, PDF validation, rate limits, malware scanning, and the normal
processing pipeline.

## Offline and privacy requirements

- No network must be required for accepting a shared file.
- Pending files use iOS file protection or the Android equivalent and are
  stored only in protected app storage until upload succeeds or the user
  removes them.
- iOS retry currently happens when the app opens or returns to the foreground;
  it does not run as a background transfer.
- The app shows uploading, success, duplicate, and failed states. Failed files
  remain queued for retry.

## Current status

The mobile app redirects from its local bootstrap to the configured server UI;
the native shell stores and enforces the server-origin allowlist. The iOS Share
Extension and authenticated web-client upload handoff are implemented. The web
file picker remains available, and Android inbound sharing remains future work.
