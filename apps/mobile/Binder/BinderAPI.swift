import Foundation

struct BinderUser: Decodable {
    let uuid: String?
    let username: String?
}

private struct LoginEnvelope: Decodable {
    let data: BinderUser
    let csrfToken: String
}

private struct SessionEnvelope: Decodable {
    let data: BinderUser?
    let csrfToken: String
}

private struct SSOStatusEnvelope: Decodable {
    let data: SSOStatus
    struct SSOStatus: Decodable { let isActive: Bool }
}

private struct APIErrorEnvelope: Decodable {
    let message: String?
}

final class BinderAPI {
    static let shared = BinderAPI()

    private(set) var csrfToken: String?
    private let urlSession: URLSession

    init(urlSession: URLSession? = nil) {
        if let urlSession {
            self.urlSession = urlSession
        } else {
            let configuration = URLSessionConfiguration.default
            configuration.httpCookieStorage = nil
            configuration.httpShouldSetCookies = false
            self.urlSession = URLSession(configuration: configuration)
        }
    }

    func isSSOActive(serverURL: String) async throws -> Bool {
        let (data, _) = try await request(path: "ssoauth/active", serverURL: serverURL)
        return try JSONDecoder().decode(SSOStatusEnvelope.self, from: data).data.isActive
    }

    func login(serverURL: String, username: String, password: String) async throws -> BinderUser {
        let body = try JSONSerialization.data(withJSONObject: ["username": username, "password": password])
        var request = try makeRequest(path: "auth/native/login", serverURL: serverURL, method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let (data, response) = try await urlSession.data(for: request)
        try absorbSessionCookie(from: response, for: request)
        try validate(response, data: data)
        let envelope = try JSONDecoder().decode(LoginEnvelope.self, from: data)
        csrfToken = envelope.csrfToken
        try saveSessionCookieAndCSRF(envelope.csrfToken, serverURL: serverURL)
        return envelope.data
    }

    func currentUser(serverURL: String) async throws -> BinderUser? {
        let (data, _) = try await request(path: "auth/session", serverURL: serverURL)
        let envelope = try JSONDecoder().decode(SessionEnvelope.self, from: data)
        csrfToken = envelope.csrfToken
        if let cookie = KeychainStore.sessionCookie(origin: origin(for: serverURL)) {
            try KeychainStore.saveSession(
                cookie: cookie,
                csrfToken: envelope.csrfToken,
                origin: origin(for: serverURL)
            )
        }
        return envelope.data
    }

    func exchangeSSOCode(serverURL: String, code: String, verifier: String) async throws -> BinderUser {
        let body = try JSONSerialization.data(withJSONObject: ["code": code, "codeVerifier": verifier])
        var request = try makeRequest(path: "auth/native/sso/exchange", serverURL: serverURL, method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let (data, response) = try await urlSession.data(for: request)
        try absorbSessionCookie(from: response, for: request)
        try validate(response, data: data)
        let envelope = try JSONDecoder().decode(LoginEnvelope.self, from: data)
        csrfToken = envelope.csrfToken
        try saveSessionCookieAndCSRF(envelope.csrfToken, serverURL: serverURL)
        return envelope.data
    }

    func logout(serverURL: String) async throws {
        var request = try makeRequest(path: "auth/logout", serverURL: serverURL, method: "POST")
        if let csrfToken = csrfToken ?? KeychainStore.csrfToken(origin: origin(for: serverURL)) {
            request.setValue(csrfToken, forHTTPHeaderField: "X-CSRF-Token")
        }
        let (data, response) = try await urlSession.data(for: request)
        try absorbSessionCookie(from: response, for: request)
        try validate(response, data: data)
        csrfToken = nil
        KeychainStore.deleteSession(origin: origin(for: serverURL))
    }

    func clearCookies(serverURL: String) {
        KeychainStore.deleteSession(origin: origin(for: serverURL))
        csrfToken = nil
    }

    private func request(path: String, serverURL: String) async throws -> (Data, URLResponse) {
        let request = try makeRequest(path: path, serverURL: serverURL, method: "GET")
        let (data, response) = try await urlSession.data(for: request)
        try absorbSessionCookie(from: response, for: request)
        try validate(response, data: data)
        return (data, response)
    }

    private func makeRequest(path: String, serverURL: String, method: String) throws -> URLRequest {
        guard var components = URLComponents(string: serverURL.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = components.scheme?.lowercased(), ["http", "https"].contains(scheme),
              components.host != nil, components.user == nil, components.password == nil else {
            throw BinderAPIError.invalidServerURL
        }
        components.path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.path += "/api/v1/" + path
        guard let url = components.url else { throw BinderAPIError.invalidServerURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let cookie = KeychainStore.sessionCookie(origin: origin(for: serverURL)) {
            request.setValue(cookie, forHTTPHeaderField: "Cookie")
        }
        return request
    }

    private func absorbSessionCookie(from response: URLResponse, for request: URLRequest) throws {
        guard let response = response as? HTTPURLResponse, let url = request.url else { return }
        var headers: [String: String] = [:]
        for (key, value) in response.allHeaderFields {
            guard let key = key as? String else { continue }
            headers[key] = String(describing: value)
        }
        guard let cookie = HTTPCookie.cookies(withResponseHeaderFields: headers, for: url)
            .first(where: { $0.name == "connect.sid" }) else { return }
        let responseOrigin = origin(for: url.absoluteString)
        guard cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))
            .caseInsensitiveCompare(url.host ?? "") == .orderedSame else {
            throw BinderAPIError.invalidResponse
        }
        guard !cookie.isSecure || url.scheme?.lowercased() == "https" else { return }
        if cookie.expiresDate.map({ $0 <= Date() }) == true {
            KeychainStore.deleteSession(origin: responseOrigin)
        } else {
            try KeychainStore.saveSession(cookie: "\(cookie.name)=\(cookie.value)", csrfToken: nil, origin: responseOrigin)
        }
    }

    private func saveSessionCookieAndCSRF(_ token: String, serverURL: String) throws {
        guard let cookie = KeychainStore.sessionCookie(origin: origin(for: serverURL)) else {
            throw BinderAPIError.sessionCookieMissing
        }
        try KeychainStore.saveSession(cookie: cookie, csrfToken: token, origin: origin(for: serverURL))
    }

    private func origin(for serverURL: String) -> String {
        guard let components = URLComponents(string: serverURL),
              let scheme = components.scheme, let host = components.host else { return serverURL }
        let port = components.port.map { ":\($0)" } ?? ""
        return "\(scheme.lowercased())://\(host.lowercased())\(port)"
    }

    private func validate(_ response: URLResponse, data: Data) throws {
        guard let response = response as? HTTPURLResponse else { throw BinderAPIError.invalidResponse }
        guard (200..<300).contains(response.statusCode) else {
            let apiMessage = try? JSONDecoder().decode(APIErrorEnvelope.self, from: data).message
            throw BinderAPIError.server(apiMessage ?? HTTPURLResponse.localizedString(forStatusCode: response.statusCode))
        }
    }
}

enum BinderAPIError: LocalizedError {
    case invalidServerURL
    case invalidResponse
    case server(String)
    case invalidSSOCallback
    case ssoCouldNotStart
    case ssoNotConfigured
    case sessionCookieMissing

    var errorDescription: String? {
        switch self {
        case .invalidServerURL: "Enter a complete server URL, including http:// or https://."
        case .invalidResponse: "The server returned an invalid response."
        case .server(let message): message
        case .invalidSSOCallback: "The SSO sign-in response could not be verified. Please try again."
        case .ssoCouldNotStart: "The system sign-in window could not be opened."
        case .ssoNotConfigured: "Single sign-on is not configured on this server."
        case .sessionCookieMissing: "The server did not establish a session. Check the server URL and cookie configuration."
        }
    }
}
