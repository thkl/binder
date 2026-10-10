import Foundation
import Security

enum KeychainStore {
    private static let service = "com.binder.ios.credentials"
    private static var sharedAccessGroup: String? {
        Bundle.main.object(forInfoDictionaryKey: "BinderSharedKeychainAccessGroup") as? String
    }

    static func savePassword(_ password: String) throws { try save(password, account: "saved-password", shared: true) }
    static func password() -> String? {
        if let sharedPassword = read(account: "saved-password", shared: true) { return sharedPassword }
        guard let legacyPassword = read(account: "saved-password", shared: false) else { return nil }
        try? save(legacyPassword, account: "saved-password", shared: true)
        return legacyPassword
    }
    static func deletePassword() {
        delete(account: "saved-password", shared: true)
        delete(account: "saved-password", shared: false)
    }

    static func saveSession(cookie: String, csrfToken: String?, origin: String) throws {
        try save(cookie, account: "session-cookie-\(origin)", shared: true)
        if let csrfToken { try save(csrfToken, account: "csrf-token-\(origin)", shared: true) }
    }

    static func sessionCookie(origin: String) -> String? { read(account: "session-cookie-\(origin)", shared: true) }
    static func csrfToken(origin: String) -> String? { read(account: "csrf-token-\(origin)", shared: true) }

    static func deleteSession(origin: String) {
        delete(account: "session-cookie-\(origin)", shared: true)
        delete(account: "csrf-token-\(origin)", shared: true)
    }

    private static func save(_ value: String, account: String, shared: Bool) throws {
        let data = Data(value.utf8)
        var query = baseQuery(account: account, shared: shared)
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecDuplicateItem {
            let updateStatus = SecItemUpdate(baseQuery(account: account, shared: shared) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
            guard updateStatus == errSecSuccess else { throw KeychainError(status: updateStatus) }
        } else if status != errSecSuccess {
            throw KeychainError(status: status)
        }
    }

    private static func read(account: String, shared: Bool) -> String? {
        var query = baseQuery(account: account, shared: shared)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func delete(account: String, shared: Bool) {
        SecItemDelete(baseQuery(account: account, shared: shared) as CFDictionary)
    }

    private static func baseQuery(account: String, shared: Bool) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        if shared, let sharedAccessGroup {
            query[kSecAttrAccessGroup as String] = sharedAccessGroup
        }
        return query
    }
}

struct KeychainError: LocalizedError {
    let status: OSStatus
    var errorDescription: String? { "Could not save credentials to Keychain (status \(status))." }
}
