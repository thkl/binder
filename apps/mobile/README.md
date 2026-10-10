# Binder iOS

The first native milestone is a SwiftUI login app for iOS 17 and later. Open
`Binder.xcodeproj` in Xcode and select the `Binder` target.

## Signing setup

The project uses these initial identifiers:

- App Bundle ID: `network.thkl.binder.ios`
- Share Extension Bundle ID: `network.thkl.binder.ios.share`
- App Group: `group.com.binder.shared`
- Shared Keychain group: the app's team prefix plus `com.binder.ios.shared`

Register both bundle IDs, the App Group, and the shared Keychain access group
for the Apple Developer team, then select the team for both targets in Signing
& Capabilities. Change the identifiers in the project, entitlements, and native
SSO callback if they are already in use. The
The app and Share Extension store queued PDFs and the server URL in the App
Group. Session cookies, CSRF tokens, and an opted-in password use the shared
Keychain group so the extension can upload directly. The extension reads the
saved password only when “Save password for automatic sign-in” is enabled.

## Sign-in behavior

- Password sign-in establishes the API's normal server-side session.
- “Save password for automatic sign-in” is optional and stores the password in
  Keychain. The app reauthenticates when its session expires and the app becomes
  active. Choosing SSO deletes the saved Binder password.
- SSO opens the server in `ASWebAuthenticationSession`; the API returns a
  short-lived, PKCE-bound code to the app, which exchanges it for a session
  cookie.
- The app attaches the cookie to API requests and includes the session CSRF
  token on state-changing requests.

The initial build allows user-entered HTTP URLs and warns that they are
unencrypted. HTTPS servers must present a certificate trusted by iOS; the
per-server approval flow for self-signed certificates is a later step.

## PDF sharing

Share one PDF from another app to Binder. The Share Extension copies it into
the App Group queue, then uploads it using the saved session or an opted-in
saved password. If the server is unavailable or sign-in is needed, the PDF
stays queued; opening Binder retries the pending uploads.

## Document scanning

Use the scanner button in Binder to capture one or more paper pages with the
native iOS document scanner. Binder assembles the pages into a PDF and stores
them in the same App Group queue. Signed-in users get an immediate upload
attempt; from the sign-in screen, scans remain queued until the next sign-in.

## API changes

The API adds native password login and SSO session-exchange routes. Database
migration `V070` stores hashed, short-lived native SSO handoff codes and is
applied by the normal migration process.
