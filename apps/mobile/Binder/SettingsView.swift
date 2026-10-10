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

                    plannedSetting("Metadata", systemImage: "list.bullet.rectangle")
                    plannedSetting("Tags", systemImage: "tag")
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Settings")
        }
    }

    private func plannedSetting(_ title: String, systemImage: String) -> some View {
        HStack {
            Label(title, systemImage: systemImage)
                .foregroundStyle(.secondary)
            Spacer()
            Text("Later")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .accessibilityElement(children: .combine)
    }
}
