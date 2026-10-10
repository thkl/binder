# Binder iOS

The first native milestone is a SwiftUI login app for iOS 17 and later. Open
`Binder.xcodeproj` in Xcode and select the `Binder` target.

## Signing setup

The project uses these initial identifiers:

- Bundle ID: `com.binder.ios`
- App Group: `group.com.binder.shared`
- Shared Keychain group: the app's team prefix plus `com.binder.ios.shared`

Register the App Group and Keychain access group for the Apple Developer team,
then select the team in Signing & Capabilities. Change the identifiers in the
project, entitlements, and native SSO callback if they are already in use. The
app stores its server URL in the App Group, the session cookie and CSRF token in
the shared Keychain group, and an opted-in password in the app-only Keychain
group so the Share Extension cannot read it.

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

## API changes

The API adds native password login and SSO session-exchange routes. Database
migration `V070` stores hashed, short-lived native SSO handoff codes and is
applied by the normal migration process.
