import SwiftUI

@main
struct BinderApp: App {
    @UIApplicationDelegateAdaptor(BinderApplicationDelegate.self) private var appDelegate
    @StateObject private var auth = AuthViewModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ZStack {
                Color(uiColor: .systemGroupedBackground)
                    .ignoresSafeArea()

                Group {
                    if auth.user != nil { SignedInView(model: auth) }
                    else { LoginView(model: auth) }
                }
            }
            .task { await auth.refresh() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await auth.refresh() } }
            }
        }
    }
}
