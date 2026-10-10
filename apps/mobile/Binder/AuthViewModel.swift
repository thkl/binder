import Foundation
import Combine

@MainActor
final class AuthViewModel: ObservableObject {
    @Published var serverURL = AppSettings.serverURL
    @Published var username = AppSettings.savedUsername
    @Published var password = KeychainStore.password() ?? ""
    @Published var rememberPassword = AppSettings.remembersPassword
    @Published var ssoIsActive = false
    @Published var serverMessage: String?
    @Published var isBusy = false
    @Published var errorMessage: String?
    @Published var user: BinderUser?
    @Published private(set) var hasCompletedInitialAuthCheck = false

    private let api = BinderAPI.shared
    private let sso = NativeSSO()
    private var isRefreshing = false

    func refresh() async {
        guard !isRefreshing, !isBusy else { return }
        let normalized = normalizedServerURL
        guard !normalized.isEmpty else {
            hasCompletedInitialAuthCheck = true
            return
        }
        isRefreshing = true
        defer {
            isRefreshing = false
            hasCompletedInitialAuthCheck = true
        }
        serverURL = normalized
        do {
            let current = try await api.currentUser(serverURL: normalized)
            user = current
            if current != nil {
                return
            }
        } catch {
            // Try saved credentials below in case the session has expired.
        }

        if AppSettings.remembersPassword,
           let savedPassword = KeychainStore.password(),
           !AppSettings.savedUsername.isEmpty {
            username = AppSettings.savedUsername
            password = savedPassword
            do {
                user = try await api.login(serverURL: normalized, username: username, password: savedPassword)
                errorMessage = nil
            } catch {
                errorMessage = "Automatic sign-in failed. Check the saved password and try again."
            }
        }

        if user == nil {
            await refreshSSOStatus(serverURL: normalized)
        }
    }

    func signIn() async {
        await perform { [self] in
            let normalized = try validatedServerURL()
            let previous = AppSettings.serverURL
            if !previous.isEmpty, previous != normalized {
                api.clearCookies(serverURL: previous)
                forgetSavedPassword()
            }
            serverURL = normalized
            AppSettings.serverURL = normalized
            // SSO discovery is optional for password sign-in. A transient failure
            // from this endpoint must not prevent the username/password request.
            await refreshSSOStatus(serverURL: normalized)
            let signedInUser = try await api.login(serverURL: normalized, username: username, password: password)
            AppSettings.savedUsername = username
            AppSettings.remembersPassword = rememberPassword
            if rememberPassword { try KeychainStore.savePassword(password) }
            else { KeychainStore.deletePassword() }
            user = signedInUser
            serverMessage = "Connected to Binder."
        }
    }

    func checkServer() async {
        await perform { [self] in
            let normalized = try validatedServerURL()
            let previous = AppSettings.serverURL
            if !previous.isEmpty, previous != normalized {
                api.clearCookies(serverURL: previous)
                forgetSavedPassword()
            }
            serverURL = normalized
            AppSettings.serverURL = normalized
            ssoIsActive = try await api.isSSOActive(serverURL: normalized)
            serverMessage = ssoIsActive ? "Connected. SSO is available." : "Connected."
        }
    }

    func signInWithSSO() async {
        await perform { [self] in
            let normalized = try validatedServerURL()
            let previous = AppSettings.serverURL
            if !previous.isEmpty, previous != normalized { api.clearCookies(serverURL: previous) }
            serverURL = normalized
            AppSettings.serverURL = normalized
            // The identity provider owns SSO credentials. Do not save a local
            // Binder password when the user chooses SSO.
            forgetSavedPassword()
            ssoIsActive = try await api.isSSOActive(serverURL: normalized)
            guard ssoIsActive else { throw BinderAPIError.ssoNotConfigured }
            user = try await sso.authenticate(serverURL: normalized, api: api)
        }
    }

    func signOut() async {
        let url = normalizedServerURL
        do { try await api.logout(serverURL: url) } catch { api.clearCookies(serverURL: url) }
        user = nil
        password = ""
        rememberPassword = false
        AppSettings.remembersPassword = false
        KeychainStore.deletePassword()
    }

    private var normalizedServerURL: String {
        serverURL.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    private func validatedServerURL() throws -> String {
        let normalized = normalizedServerURL
        guard let components = URLComponents(string: normalized),
              let scheme = components.scheme?.lowercased(), ["http", "https"].contains(scheme),
              components.host != nil else { throw BinderAPIError.invalidServerURL }
        return normalized
    }

    private func forgetSavedPassword() {
        password = ""
        rememberPassword = false
        AppSettings.remembersPassword = false
        KeychainStore.deletePassword()
    }

    private func refreshSSOStatus(serverURL: String) async {
        do {
            ssoIsActive = try await api.isSSOActive(serverURL: serverURL)
        } catch {
            // Do not keep showing an SSO option based on a stale status response.
            ssoIsActive = false
        }
    }

    private func perform(_ operation: () async throws -> Void) async {
        guard !isBusy else { return }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do { try await operation() }
        catch { errorMessage = error.localizedDescription }
    }
}
