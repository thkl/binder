import SwiftUI

@main
struct BinderApp: App {
    @StateObject private var auth = AuthViewModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Group {
                if auth.user != nil { SignedInView(model: auth) }
                else { LoginView(model: auth) }
            }
            .task { await auth.refresh() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await auth.refresh() } }
            }
        }
    }
}
