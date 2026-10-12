import SwiftUI

struct SettingsView: View {
    @ObservedObject var model: AuthViewModel
    @ObservedObject private var pushNotifications = PushNotificationManager.shared
    @State private var queuedDocumentCount = 0

    var body: some View {
        NavigationStack {
            List {
                Section("Uploads") {
                    NavigationLink {
                        UploadQueueView(serverURL: model.serverURL)
                    } label: {
                        HStack {
                            Label("Upload queue", systemImage: "tray.and.arrow.up")
                            Spacer()
                            if queuedDocumentCount > 0 {
                                Text("\(queuedDocumentCount)")
                                    .foregroundStyle(.secondary)
                                    .accessibilityLabel("\(queuedDocumentCount) queued documents")
                            }
                        }
                    }
                }

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
                    if pushNotifications.serverEnabled {
                        NavigationLink {
                            PushNotificationSettingsView(serverURL: model.serverURL)
                        } label: {
                            Label("Notifications", systemImage: "bell.badge")
                        }
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
            .onAppear(perform: refreshQueueCount)
        }
    }

    private func refreshQueueCount() {
        queuedDocumentCount = (try? SharedPDFQueue.pendingFiles().count) ?? 0
    }
}
