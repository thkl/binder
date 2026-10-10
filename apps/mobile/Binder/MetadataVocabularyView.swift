import SwiftUI

private struct VocabularyEditorRequest: Identifiable {
    let id = UUID()
    let item: BinderMetadataOption?
    let scope: String
}

struct MetadataVocabularyView: View {
    @ObservedObject var model: AuthViewModel
    let kind: BinderVocabularyKind

    @State private var items: [BinderMetadataOption] = []
    @State private var folders: [BinderFolder] = []
    @State private var scope = "personal"
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var editorRequest: VocabularyEditorRequest?
    @State private var itemToDelete: BinderMetadataOption?

    private var isAdmin: Bool { model.user?.isAdmin == true }

    private var visibleItems: [BinderMetadataOption] {
        items
            .filter {
                $0.active != false && (kind == .tags
                    ? scope == "all" || !isAdmin || $0.scope == scope
                    : $0.scope == scope)
            }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    var body: some View {
        Group {
            if isLoading && items.isEmpty {
                ProgressView("Loading metadata…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage, items.isEmpty {
                ContentUnavailableView {
                    Label("Couldn’t load metadata", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Retry") { Task { await load() } }
                }
            } else if visibleItems.isEmpty {
                ContentUnavailableView(
                    "No \(kind.title.lowercased())",
                    systemImage: kind.systemImage,
                    description: Text("Add a value to use it in document metadata.")
                )
            } else {
                List {
                    if let errorMessage {
                        Section {
                            Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                                .foregroundStyle(.red)
                            Button("Retry") { Task { await load() } }
                        }
                    }

                    Section("\(kind.title) · \(visibleItems.count)") {
                        ForEach(visibleItems) { item in
                            HStack(alignment: .top, spacing: 12) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(item.name).font(.body.weight(.semibold))
                                    if let description = item.description, !description.isEmpty {
                                        Text(description)
                                            .font(.subheadline)
                                            .foregroundStyle(.secondary)
                                    }
                                    if let folderUUID = item.folderUuid,
                                       let folder = folders.first(where: { $0.uuid == folderUUID }) {
                                        Label(folder.path(in: folders), systemImage: "folder")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                Spacer(minLength: 4)
                                if canEdit(item) || (item.scope == "system" && kind != .tags) || canDelete(item) {
                                    Menu {
                                        if canEdit(item) {
                                            Button("Edit", systemImage: "pencil") {
                                                editorRequest = VocabularyEditorRequest(item: item, scope: scope)
                                            }
                                        }
                                        if item.scope == "system" && kind != .tags {
                                            Button("Copy to personal", systemImage: "doc.on.doc") {
                                                Task { await clone(item) }
                                            }
                                        }
                                        if canDelete(item) {
                                            Button("Delete", systemImage: "trash", role: .destructive) {
                                                itemToDelete = item
                                            }
                                        }
                                    } label: {
                                        Image(systemName: "ellipsis")
                                            .foregroundStyle(.secondary)
                                            .frame(width: 36, height: 36)
                                            .contentShape(Rectangle())
                                    }
                                    .accessibilityLabel("Actions for \(item.name)")
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable { await load() }
            }
        }
        .navigationTitle(kind.title)
        .toolbar {
            if isAdmin {
                ToolbarItem(placement: .principal) {
                    Picker("Scope", selection: $scope) {
                        if kind == .tags { Text("All").tag("all") }
                        Text("Personal").tag("personal")
                        Text("Workspace").tag("system")
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 240)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    editorRequest = VocabularyEditorRequest(item: nil, scope: scope)
                } label: {
                    Label("Add", systemImage: "plus")
                }
            }
        }
        .sheet(item: $editorRequest) { request in
            MetadataVocabularyEditorView(
                item: request.item,
                kind: kind,
                folders: folders,
                scope: request.scope,
                serverURL: model.serverURL,
                onSaved: { await load() }
            )
        }
        .confirmationDialog(
            "Delete this value? Existing documents keep their current metadata.",
            isPresented: Binding(
                get: { itemToDelete != nil },
                set: { if !$0 { itemToDelete = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let itemToDelete { Task { await delete(itemToDelete) } }
                itemToDelete = nil
            }
            Button("Cancel", role: .cancel) { itemToDelete = nil }
        }
        .task(id: model.serverURL) {
            if kind == .tags && isAdmin { scope = "all" }
            await load()
        }
    }

    private func canEdit(_ item: BinderMetadataOption) -> Bool {
        item.scope == "personal" || isAdmin
    }

    private func canDelete(_ item: BinderMetadataOption) -> Bool {
        kind != .tags && (item.scope == "personal" || isAdmin)
    }

    @MainActor
    private func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            async let vocabulary = BinderAPI.shared.metadataEditorOptions(serverURL: model.serverURL)
            async let loadedFolders = BinderAPI.shared.allFolders(serverURL: model.serverURL)
            let (options, folders) = try await (vocabulary, loadedFolders)
            switch kind {
            case .documentTypes: items = options.vocabulary.documentTypes
            case .categories: items = options.vocabulary.categories
            case .tags: items = options.vocabulary.tags
            }
            self.folders = folders
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func clone(_ item: BinderMetadataOption) async {
        do {
            try await BinderAPI.shared.cloneVocabulary(
                serverURL: model.serverURL,
                kind: kind,
                uuid: item.uuid
            )
            scope = "personal"
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func delete(_ item: BinderMetadataOption) async {
        do {
            try await BinderAPI.shared.deleteVocabulary(
                serverURL: model.serverURL,
                kind: kind,
                uuid: item.uuid
            )
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct MetadataVocabularyEditorView: View {
    let item: BinderMetadataOption?
    let kind: BinderVocabularyKind
    let folders: [BinderFolder]
    let scope: String
    let serverURL: String
    let onSaved: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var description: String
    @State private var englishName: String
    @State private var germanName: String
    @State private var folderUUID: String
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(
        item: BinderMetadataOption?,
        kind: BinderVocabularyKind,
        folders: [BinderFolder],
        scope: String,
        serverURL: String,
        onSaved: @escaping () async -> Void
    ) {
        self.item = item
        self.kind = kind
        self.folders = folders
        self.scope = scope
        self.serverURL = serverURL
        self.onSaved = onSaved
        _name = State(initialValue: item?.name ?? "")
        _description = State(initialValue: item?.description ?? "")
        _englishName = State(initialValue: item?.translations?["en"] ?? "")
        _germanName = State(initialValue: item?.translations?["de"] ?? "")
        _folderUUID = State(initialValue: item?.folderUuid ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(kind.title) {
                    LabeledContent("Name") {
                        TextField("Enter name", text: $name)
                            .textInputAutocapitalization(.words)
                    }
                    LabeledContent("Description") {
                        TextField("Optional description", text: $description, axis: .vertical)
                            .lineLimit(2...4)
                    }
                    LabeledContent("English translation") {
                        TextField("Optional", text: $englishName)
                            .textInputAutocapitalization(.words)
                    }
                    LabeledContent("German translation") {
                        TextField("Optional", text: $germanName)
                            .textInputAutocapitalization(.words)
                    }
                }

                if kind != .tags && scope == "personal" && !folders.isEmpty {
                    Section {
                        Picker("Automatic folder", selection: $folderUUID) {
                            Text("No automatic folder").tag("")
                            ForEach(sortedFolders) { folder in
                                Text(folder.path(in: folders)).tag(folder.uuid)
                            }
                        }
                    } footer: {
                        Text("Documents with this value can be routed to the selected folder.")
                    }
                }

                if let errorMessage {
                    Section { Label(errorMessage, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
                }
            }
            .navigationTitle(item == nil ? "New \(kind.singularTitle)" : "Edit \(kind.singularTitle)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }.disabled(isSaving)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") { Task { await save() } }
                        .fontWeight(.semibold)
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
        errorMessage = nil
        defer { isSaving = false }

        let translations = ["en": englishName, "de": germanName].reduce(into: [String: String]()) {
            result, pair in
            let value = pair.value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty { result[pair.key] = value }
        }
        do {
            if let item {
                try await BinderAPI.shared.updateVocabulary(
                    serverURL: serverURL,
                    kind: kind,
                    uuid: item.uuid,
                    payload: BinderVocabularyUpdatePayload(
                        name: normalizedName,
                        description: description.nilIfBlank,
                        translations: translations,
                        folderUuid: item.scope == "personal" ? folderUUID.nilIfBlank : nil
                    )
                )
            } else {
                try await BinderAPI.shared.createVocabulary(
                    serverURL: serverURL,
                    kind: kind,
                    payload: BinderVocabularyCreatePayload(
                        name: normalizedName,
                        description: description.nilIfBlank,
                        translations: translations,
                        scope: scope == "all" ? "personal" : scope,
                        folderUuid: scope == "personal" ? folderUUID.nilIfBlank : nil
                    )
                )
            }
            await onSaved()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
