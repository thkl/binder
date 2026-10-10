import SwiftUI

struct SettingsView: View {
    @ObservedObject var model: AuthViewModel

    var body: some View {
        NavigationStack {
            List {
                Section("Document data") {
                    NavigationLink {
                        IssuerManagerView(model: model)
                    } label: {
                        Label("Issuers", systemImage: "person.text.rectangle")
                    }

                    NavigationLink {
                        MetadataManagementView(model: model)
                    } label: {
                        Label("Metadata", systemImage: "list.bullet.rectangle")
                    }
                    NavigationLink {
                        MetadataVocabularyView(model: model, kind: .tags)
                    } label: {
                        Label("Tags", systemImage: "tag")
                    }
                }

                Section("Account") {
                    NavigationLink {
                        PushNotificationSettingsView(serverURL: model.serverURL)
                    } label: {
                        Label("Notifications", systemImage: "bell.badge")
                    }
                    Button(role: .destructive) {
                        Task { await model.signOut() }
                    } label: {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Settings")
        }
    }
}
