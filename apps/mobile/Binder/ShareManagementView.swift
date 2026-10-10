import SwiftUI

struct ShareManagementRequest: Identifiable {
    let resource: ShareResource
    let uuid: String

    var id: String { "\(resource.rawValue)-\(uuid)" }
}

struct ShareManagementView: View {
    let resource: ShareResource
    let resourceUUID: String
    let serverURL: String

    @Environment(\.dismiss) private var dismiss
    @State private var recipients: [BinderShareRecipient] = []
    @State private var grants: [BinderShareGrant] = []
    @State private var selectedRecipientUUID = ""
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var availableRecipients: [BinderShareRecipient] {
        let granted = Set(grants.map(\.recipientUuid))
        return recipients.filter { !granted.contains($0.uuid) }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if isLoading {
                        ProgressView("Loading sharing options…")
                    } else if grants.isEmpty {
                        Text("This \(resource.title.lowercased()) is not shared yet.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(grants) { grant in
                            HStack(spacing: 12) {
                                Label(grant.recipientUsername, systemImage: "person.crop.circle")
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                Button(role: .destructive) {
                                    Task { await remove(grant) }
                                } label: {
                                    if isSaving {
                                        ProgressView()
                                            .frame(width: 44, height: 44)
                                    } else {
                                        Image(systemName: "person.badge.minus")
                                            .frame(width: 44, height: 44)
                                    }
                                }
                                .buttonStyle(.borderless)
                                .disabled(isSaving)
                                .accessibilityLabel("Stop sharing with \(grant.recipientUsername)")
                            }
                        }
                    }
                } header: {
                    Text("Shared with")
                } footer: {
                    Text("Recipients can view and download this item.")
                }

                if !isLoading && !availableRecipients.isEmpty {
                    Section("Add someone") {
                        Picker("Workspace user", selection: $selectedRecipientUUID) {
                            Text("Choose a user").tag("")
                            ForEach(availableRecipients) { recipient in
                                Text(recipient.username).tag(recipient.uuid)
                            }
                        }
                        .disabled(isSaving)

                        Button {
                            Task { await addSelectedRecipient() }
                        } label: {
                            HStack {
                                Spacer()
                                if isSaving { ProgressView() }
                                else { Label("Share", systemImage: "person.badge.plus") }
                                Spacer()
                            }
                            .frame(minHeight: 32)
                        }
                        .disabled(isSaving || selectedRecipientUUID.isEmpty)
                    }
                } else if !isLoading && recipients.isEmpty {
                    Section("Add someone") {
                        Text("No other active workspace users are available.")
                            .foregroundStyle(.secondary)
                    }
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                            .fixedSize(horizontal: false, vertical: true)
                        Button("Retry") { Task { await load() } }
                            .disabled(isSaving)
                    }
                }
            }
            .navigationTitle("Share \(resource.title.lowercased())")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .disabled(isSaving)
                }
            }
            .task { await load() }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    @MainActor
    private func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            async let loadedRecipients = BinderAPI.shared.shareRecipients(serverURL: serverURL)
            async let loadedGrants = BinderAPI.shared.shares(
                serverURL: serverURL,
                resource: resource,
                uuid: resourceUUID
            )
            recipients = try await loadedRecipients
            grants = try await loadedGrants
            if !availableRecipients.contains(where: { $0.uuid == selectedRecipientUUID }) {
                selectedRecipientUUID = availableRecipients.first?.uuid ?? ""
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func addSelectedRecipient() async {
        guard !selectedRecipientUUID.isEmpty, !isSaving else { return }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            grants = try await BinderAPI.shared.addShare(
                serverURL: serverURL,
                resource: resource,
                uuid: resourceUUID,
                recipientUUID: selectedRecipientUUID
            )
            selectedRecipientUUID = availableRecipients.first?.uuid ?? ""
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func remove(_ grant: BinderShareGrant) async {
        guard !isSaving else { return }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            grants = try await BinderAPI.shared.removeShare(
                serverURL: serverURL,
                resource: resource,
                uuid: resourceUUID,
                recipientUUID: grant.recipientUuid
            )
            selectedRecipientUUID = grant.recipientUuid
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
