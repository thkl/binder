import Foundation

enum AppSettings {
    private static let defaults = UserDefaults(suiteName: "group.com.binder.shared") ?? .standard
    private static let serverKey = "binder.serverURL"
    private static let usernameKey = "binder.savedUsername"
    private static let rememberPasswordKey = "binder.rememberPassword"
    private static let pushNotificationsKey = "binder.pushNotificationsEnabled"

    static var serverURL: String {
        get { defaults.string(forKey: serverKey) ?? "" }
        set { defaults.set(newValue, forKey: serverKey) }
    }

    static var savedUsername: String {
        get { defaults.string(forKey: usernameKey) ?? "" }
        set { defaults.set(newValue, forKey: usernameKey) }
    }

    static var remembersPassword: Bool {
        get { defaults.bool(forKey: rememberPasswordKey) }
        set { defaults.set(newValue, forKey: rememberPasswordKey) }
    }

    static var pushNotificationsEnabled: Bool {
        get { defaults.bool(forKey: pushNotificationsKey) }
        set { defaults.set(newValue, forKey: pushNotificationsKey) }
    }
}
