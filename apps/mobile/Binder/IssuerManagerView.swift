import SwiftUI

private struct IssuerEditorRequest: Identifiable {
    let id = UUID()
    let issuer: BinderIssuer?
}

struct IssuerManagerView: View {
    @ObservedObject var model: AuthViewModel

    @State private var issuers: [BinderIssuer] = []
    @State private var folders: [BinderFolder] = []
    @State private var searchText = ""
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var editorRequest: IssuerEditorRequest?

    var body: some View {
        Group {
            if isLoading && issuers.isEmpty {
                ProgressView("Loading issuers…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let loadError, issuers.isEmpty {
                ContentUnavailableView {
                    Label("Couldn’t load issuers", systemImage: "person.crop.rectangle.badge.exclamationmark")
                } description: {
                    Text(loadError)
                } actions: {
                    Button("Retry") { Task { await loadIssuers() } }
                }
            } else if visibleIssuers.isEmpty {
                ContentUnavailableView(
                    searchText.isEmpty ? "No issuers yet" : "No matching issuers",
                    systemImage: "person.text.rectangle",
                    description: Text(searchText.isEmpty
                        ? "Add an issuer to reuse it in document metadata."
                        : "Try a different issuer name or location.")
                )
            } else {
                List {
                    if let loadError {
                        Section {
                            Label(loadError, systemImage: "exclamationmark.triangle.fill")
                                .foregroundStyle(.red)
                            Button("Retry") { Task { await loadIssuers() } }
                        }
                    }

                    Section("Issuers · \(visibleIssuers.count)") {
                        ForEach(visibleIssuers) { issuer in
                            Button {
                                editorRequest = IssuerEditorRequest(issuer: issuer)
                            } label: {
                                IssuerListRow(issuer: issuer, folders: folders)
                            }
                            .buttonStyle(.plain)
                            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable { await loadIssuers() }
            }
        }
        .navigationTitle("Issuers")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    editorRequest = IssuerEditorRequest(issuer: nil)
                } label: {
                    Label("Add issuer", systemImage: "plus")
                }
                .accessibilityIdentifier("add-issuer")
            }
        }
        .searchable(text: $searchText, prompt: "Search issuers")
        .sheet(item: $editorRequest) { request in
            IssuerEditorView(
                issuer: request.issuer,
                folders: folders,
                serverURL: model.serverURL,
                onSaved: { await loadIssuers() }
            )
        }
        .task(id: model.serverURL) { await loadIssuers() }
    }

    private var visibleIssuers: [BinderIssuer] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return issuers
            .filter { issuer in
                query.isEmpty || [issuer.name, issuer.address, issuer.zipCode, issuer.city, issuer.country]
                    .compactMap { $0 }
                    .contains { $0.localizedCaseInsensitiveContains(query) }
            }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    @MainActor
    private func loadIssuers() async {
        isLoading = true
        loadError = nil
        defer { isLoading = false }

        do {
            async let loadedIssuers = BinderAPI.shared.issuers(serverURL: model.serverURL)
            async let loadedFolders = BinderAPI.shared.allFolders(serverURL: model.serverURL)
            let (issuerList, folderList) = try await (loadedIssuers, loadedFolders)
            issuers = issuerList
            folders = folderList
        } catch {
            loadError = error.localizedDescription
        }
    }
}

private struct IssuerListRow: View {
    let issuer: BinderIssuer
    let folders: [BinderFolder]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(issuer.name)
                .font(.body.weight(.semibold))
                .foregroundStyle(.primary)
            let location = [issuer.city, issuer.country].compactMap { $0 }.joined(separator: ", ")
            if !location.isEmpty {
                Text(location)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if let folderUUID = issuer.folderUuid,
               let folder = folders.first(where: { $0.uuid == folderUUID }) {
                Label(folder.path(in: folders), systemImage: "folder")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .contentShape(Rectangle())
    }
}

private struct IssuerEditorView: View {
    let issuer: BinderIssuer?
    let folders: [BinderFolder]
    let serverURL: String
    let onSaved: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var address: String
    @State private var zipCode: String
    @State private var city: String
    @State private var country: String
    @State private var folderSelection: String
    @State private var customJSON: String
    @State private var isSaving = false
    @State private var saveError: String?

    init(
        issuer: BinderIssuer?,
        folders: [BinderFolder],
        serverURL: String,
        onSaved: @escaping () async -> Void
    ) {
        self.issuer = issuer
        self.folders = folders
        self.serverURL = serverURL
        self.onSaved = onSaved
        _name = State(initialValue: issuer?.name ?? "")
        _address = State(initialValue: issuer?.address ?? "")
        _zipCode = State(initialValue: issuer?.zipCode ?? "")
        _city = State(initialValue: issuer?.city ?? "")
        _country = State(initialValue: issuer?.country ?? "")
        _folderSelection = State(initialValue: issuer?.folderUuid ?? "")
        _customJSON = State(initialValue: Self.formattedCustomJSON(issuer?.custom ?? [:]))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Issuer") {
                    TextField("Name", text: $name)
                        .textInputAutocapitalization(.words)
                    TextField("Address", text: $address)
                        .textInputAutocapitalization(.words)
                    TextField("Postal code", text: $zipCode)
                        .textInputAutocapitalization(.characters)
                    TextField("City", text: $city)
                        .textInputAutocapitalization(.words)
                    TextField("Country", text: $country)
                        .textInputAutocapitalization(.words)
                }

                Section {
                    Picker("Automatic folder", selection: $folderSelection) {
                        Text("No automatic folder").tag("")
                        ForEach(sortedFolders) { folder in
                            Text(folder.path(in: folders)).tag(folder.uuid)
                        }
                    }
                } header: {
                    Text("Folder routing")
                } footer: {
                    Text("Documents assigned to this issuer can be routed to this folder when metadata is saved.")
                }

                Section {
                    TextEditor(text: $customJSON)
                        .font(.system(.body, design: .monospaced))
                        .frame(minHeight: 140)
                        .accessibilityLabel("Custom fields JSON")
                } header: {
                    Text("Custom fields (JSON)")
                } footer: {
                    Text("Enter a JSON object, for example {\"accountNumber\": \"123\"}.")
                }

                if let saveError {
                    Section {
                        Label(saveError, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(issuer == nil ? "New issuer" : "Edit issuer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await save() }
                    } label: {
                        if isSaving { ProgressView() }
                        else { Text("Save").fontWeight(.semibold) }
                    }
                    .disabled(isSaving || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    private var sortedFolders: [BinderFolder] {
        folders.sorted {
            $0.path(in: folders).localizedStandardCompare($1.path(in: folders)) == .orderedAscending
        }
    }

    @MainActor
    private func save() async {
        let normalizedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedName.isEmpty, !isSaving else { return }
        isSaving = true
        saveError = nil
        defer { isSaving = false }

        do {
            let custom: [String: BinderMetadataValue]
            do {
                custom = try JSONDecoder().decode(
                    [String: BinderMetadataValue].self,
                    from: Data(customJSON.utf8)
                )
            } catch {
                saveError = "Custom fields must be a valid JSON object."
                return
            }
            let payload = IssuerMutationPayload(
                name: normalizedName,
                address: address.nilIfBlank,
                zipCode: zipCode.nilIfBlank,
                city: city.nilIfBlank,
                country: country.nilIfBlank,
                custom: custom,
                folderUuid: folderSelection.isEmpty ? nil : folderSelection
            )
            if let issuer {
                _ = try await BinderAPI.shared.updateIssuer(
                    serverURL: serverURL,
                    uuid: issuer.uuid,
                    payload: payload
                )
            } else {
                _ = try await BinderAPI.shared.createIssuer(serverURL: serverURL, payload: payload)
            }
            await onSaved()
            dismiss()
        } catch {
            saveError = error.localizedDescription
        }
    }

    private static func formattedCustomJSON(_ custom: [String: BinderMetadataValue]) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(custom),
              let string = String(data: data, encoding: .utf8) else { return "{}" }
        return string
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
