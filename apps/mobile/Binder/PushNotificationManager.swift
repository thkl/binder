import Foundation
import SwiftUI
import UIKit
import UserNotifications

@MainActor
final class PushNotificationManager: ObservableObject {
    static let shared = PushNotificationManager()

    @Published private(set) var isAuthorized = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var serverEnabled = false
    @Published private(set) var isUpdating = false
    @Published var isEnabled: Bool {
        didSet { AppSettings.pushNotificationsEnabled = isEnabled }
    }

    private var deviceToken: String?
    private var serverURL: String?
    private var shouldForceRegistration = false

    private init() {
        isEnabled = AppSettings.pushNotificationsEnabled
        Task { await refreshAuthorization() }
    }

    func refreshAuthorization() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        isAuthorized = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
    }

    func setEnabled(_ enabled: Bool, serverURL: String) async {
        guard !isUpdating else { return }
        isUpdating = true
        defer { isUpdating = false }
        errorMessage = nil
        self.serverURL = serverURL
        if enabled {
            do {
                serverEnabled = try await BinderAPI.shared.pushNotificationsEnabled(serverURL: serverURL)
                guard serverEnabled else { return }
                let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
                isAuthorized = granted
                guard granted else {
                    isEnabled = false
                    errorMessage = "Allow notifications for Binder in iOS Settings to enable push notifications."
                    return
                }
                isEnabled = true
                shouldForceRegistration = true
                UIApplication.shared.registerForRemoteNotifications()
                if let deviceToken {
                    try await register(deviceToken, serverURL: serverURL)
                    AppSettings.pushRegisteredToken = deviceToken
                    AppSettings.pushRegisteredServer = serverURL
                    AppSettings.pushRegisteredEnvironment = apnsEnvironment
                    shouldForceRegistration = false
                }
            } catch {
                isEnabled = false
                errorMessage = error.localizedDescription
            }
        } else {
            isEnabled = false
            if let token = tokenRegisteredWith(serverURL: serverURL) {
                do {
                    try await BinderAPI.shared.unregisterPushDevice(serverURL: serverURL, token: token)
                    clearRegistrationCache()
                } catch {
                    errorMessage = "Notifications are off, but the server could not remove this device: \(error.localizedDescription)"
                }
            } else {
                clearRegistrationCache()
            }
            UIApplication.shared.unregisterForRemoteNotifications()
        }
    }

    func sync(serverURL: String) async {
        self.serverURL = serverURL
        do {
            serverEnabled = try await BinderAPI.shared.pushNotificationsEnabled(serverURL: serverURL)
        } catch {
            serverEnabled = false
            errorMessage = "Could not check notification availability on this server."
            return
        }
        guard serverEnabled else {
            isEnabled = false
            return
        }
        await refreshAuthorization()
        let knownToken = deviceToken ?? (AppSettings.pushRegisteredServer == serverURL ? AppSettings.pushRegisteredToken : nil)
        if let knownToken {
            do {
                let registration = try await BinderAPI.shared.pushDeviceRegistration(serverURL: serverURL, token: knownToken)
                isEnabled = registration.enabled
                if registration.enabled {
                    AppSettings.pushRegisteredToken = knownToken
                    AppSettings.pushRegisteredServer = serverURL
                    AppSettings.pushRegisteredEnvironment = registration.environment ?? ""
                } else {
                    clearRegistrationCache()
                }
            } catch {
                errorMessage = "Could not check this device's push registration: \(error.localizedDescription)"
            }
        } else {
            isEnabled = false
        }
        if isAuthorized { UIApplication.shared.registerForRemoteNotifications() }
    }

    func didRegister(deviceToken data: Data) async {
        let token = data.map { String(format: "%02x", $0) }.joined()
        deviceToken = token
        guard let serverURL else { return }
        if !isEnabled {
            do {
                serverEnabled = try await BinderAPI.shared.pushNotificationsEnabled(serverURL: serverURL)
                guard serverEnabled else { return }
                let registration = try await BinderAPI.shared.pushDeviceRegistration(serverURL: serverURL, token: token)
                isEnabled = registration.enabled
                guard registration.enabled else { return }
                AppSettings.pushRegisteredToken = token
                AppSettings.pushRegisteredServer = serverURL
                AppSettings.pushRegisteredEnvironment = registration.environment ?? ""
            } catch {
                errorMessage = "Could not check this device's push registration: \(error.localizedDescription)"
                return
            }
        }
        guard shouldForceRegistration
            || AppSettings.pushRegisteredToken != token
            || AppSettings.pushRegisteredServer != serverURL
            || AppSettings.pushRegisteredEnvironment != apnsEnvironment else { return }
        do { try await register(token, serverURL: serverURL) }
        catch { errorMessage = "Could not register this device: \(error.localizedDescription)"; return }
        AppSettings.pushRegisteredToken = token
        AppSettings.pushRegisteredServer = serverURL
        AppSettings.pushRegisteredEnvironment = apnsEnvironment
        shouldForceRegistration = false
    }

    func didFailToRegister(error: Error) {
        errorMessage = "iOS could not register this device: \(error.localizedDescription)"
    }

    func unregister(serverURL: String) async {
        if let token = tokenRegisteredWith(serverURL: serverURL) {
            try? await BinderAPI.shared.unregisterPushDevice(serverURL: serverURL, token: token)
        }
        clearRegistrationCache()
    }

    private func tokenRegisteredWith(serverURL: String) -> String? {
        if let deviceToken { return deviceToken }
        guard AppSettings.pushRegisteredServer == serverURL, !AppSettings.pushRegisteredToken.isEmpty else { return nil }
        return AppSettings.pushRegisteredToken
    }

    private func clearRegistrationCache() {
        AppSettings.pushRegisteredToken = ""
        AppSettings.pushRegisteredServer = ""
        AppSettings.pushRegisteredEnvironment = ""
        shouldForceRegistration = false
    }

    private var apnsEnvironment: String {
        #if DEBUG
        "sandbox"
        #else
        "production"
        #endif
    }

    private func register(_ token: String, serverURL: String) async throws {
        try await BinderAPI.shared.registerPushDevice(
            serverURL: serverURL,
            token: token,
            environment: apnsEnvironment,
            deviceName: UIDevice.current.name
        )
        let previousToken = AppSettings.pushRegisteredServer == serverURL ? AppSettings.pushRegisteredToken : ""
        if !previousToken.isEmpty, previousToken != token {
            do { try await BinderAPI.shared.unregisterPushDevice(serverURL: serverURL, token: previousToken) }
            catch { errorMessage = "This device registered with a new APNs token, but the old registration could not be removed: \(error.localizedDescription)" }
        }
    }
}

final class BinderApplicationDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await PushNotificationManager.shared.didRegister(deviceToken: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { @MainActor in PushNotificationManager.shared.didFailToRegister(error: error) }
    }
}

struct PushNotificationSettingsView: View {
    let serverURL: String
    @ObservedObject private var manager = PushNotificationManager.shared

    var body: some View {
        Form {
            Section {
                Toggle("Enable push notifications", isOn: Binding(
                    get: { manager.isEnabled },
                    set: { value in Task { await manager.setEnabled(value, serverURL: serverURL) } }
                ))
                .disabled(!manager.serverEnabled || manager.isUpdating)
                LabeledContent("Permission", value: manager.isAuthorized ? "Allowed" : "Not allowed")
            } footer: {
                Text(manager.serverEnabled
                     ? "Binder registers this device with your server. You can change alert permissions in iOS Settings."
                     : "Push notifications are disabled on this server.")
            }
            if let error = manager.errorMessage {
                Section { Text(error).foregroundStyle(.red) }
            }
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task { await manager.sync(serverURL: serverURL) }
    }
}
