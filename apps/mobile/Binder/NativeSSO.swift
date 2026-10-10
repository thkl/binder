import AuthenticationServices
import CryptoKit
import Foundation
import Security
import UIKit

@MainActor
final class NativeSSO: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var activeSession: ASWebAuthenticationSession?

    func authenticate(serverURL: String, api: BinderAPI) async throws -> BinderUser {
        let verifier = Self.randomURLSafeString(byteCount: 32)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncodedString()
        let state = Self.randomURLSafeString(byteCount: 32)
        guard var components = URLComponents(string: serverURL) else { throw BinderAPIError.invalidServerURL }
        components.path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/api/v1/ssoauth/native/login"
        components.queryItems = [
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: challenge)
        ]
        guard let startURL = components.url else { throw BinderAPIError.invalidServerURL }

        let callbackURL = try await openAuthenticationSession(url: startURL)
        guard let callback = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
              callback.scheme == "com.binder.ios",
              let returnedState = callback.queryItems?.first(where: { $0.name == "state" })?.value,
              returnedState == state,
              let code = callback.queryItems?.first(where: { $0.name == "code" })?.value else {
            throw BinderAPIError.invalidSSOCallback
        }
        return try await api.exchangeSSOCode(serverURL: serverURL, code: code, verifier: verifier)
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }

    private func openAuthenticationSession(url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "com.binder.ios") { [weak self] callbackURL, error in
                self?.activeSession = nil
                if let error { continuation.resume(throwing: error); return }
                guard let callbackURL else { continuation.resume(throwing: BinderAPIError.invalidSSOCallback); return }
                continuation.resume(returning: callbackURL)
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            activeSession = session
            if !session.start() {
                activeSession = nil
                continuation.resume(throwing: BinderAPIError.ssoCouldNotStart)
            }
        }
    }

    private static func randomURLSafeString(byteCount: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            return UUID().uuidString.replacingOccurrences(of: "-", with: "")
        }
        return Data(bytes).base64URLEncodedString()
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
