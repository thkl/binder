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
    @Published var isEnabled: Bool {
        didSet { AppSettings.pushNotificationsEnabled = isEnabled }
    }

    private var deviceToken: String?
    private var serverURL: String?

    private init() {
        isEnabled = AppSettings.pushNotificationsEnabled
        Task { await refreshAuthorization() }
    }

    func refreshAuthorization() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        isAuthorized = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
    }

    func setEnabled(_ enabled: Bool, serverURL: String) async {
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
                UIApplication.shared.registerForRemoteNotifications()
                if let deviceToken { try await register(deviceToken, serverURL: serverURL) }
            } catch {
                isEnabled = false
                errorMessage = error.localizedDescription
            }
        } else {
            isEnabled = false
            if let deviceToken { try? await BinderAPI.shared.unregisterPushDevice(serverURL: serverURL, token: deviceToken) }
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
        guard serverEnabled else { return }
        await refreshAuthorization()
        guard isEnabled, isAuthorized else { return }
        UIApplication.shared.registerForRemoteNotifications()
        if let deviceToken {
            do { try await register(deviceToken, serverURL: serverURL) }
            catch { errorMessage = "Could not register this device: \(error.localizedDescription)" }
        }
    }

    func didRegister(deviceToken data: Data) async {
        let token = data.map { String(format: "%02x", $0) }.joined()
        deviceToken = token
        guard isEnabled, let serverURL else { return }
        do { try await register(token, serverURL: serverURL) }
        catch { errorMessage = "Could not register this device: \(error.localizedDescription)" }
    }

    func didFailToRegister(error: Error) {
        errorMessage = "iOS could not register this device: \(error.localizedDescription)"
    }

    func unregister(serverURL: String) async {
        if let deviceToken { try? await BinderAPI.shared.unregisterPushDevice(serverURL: serverURL, token: deviceToken) }
    }

    private func register(_ token: String, serverURL: String) async throws {
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        try await BinderAPI.shared.registerPushDevice(serverURL: serverURL, token: token, environment: environment)
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
                .disabled(!manager.serverEnabled)
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
