import SwiftUI

struct DocumentMetadataEditorView: View {
    let document: BinderDocumentSummary
    let serverURL: String
    let onSaved: (BinderDocumentSummary, [BinderFolder]) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var options: BinderMetadataEditorOptions?
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var loadError: String?
    @State private var saveError: String?
    @State private var title: String
    @State private var issuerUUID: String
    @State private var documentTypeUUID: String
    @State private var categoryUUID: String
    @State private var selectedTagUUIDs: Set<String>
    @State private var folders: [BinderFolder] = []
    @State private var selectedFolderUUIDs: Set<String> = []
    @State private var originalFolderUUIDs: Set<String> = []
    @State private var customValues: [String: BinderMetadataValue]

    init(
        document: BinderDocumentSummary,
        serverURL: String,
        onSaved: @escaping (BinderDocumentSummary, [BinderFolder]) -> Void
    ) {
        self.document = document
        self.serverURL = serverURL
        self.onSaved = onSaved
        _title = State(initialValue: document.title ?? document.originalFilename)
        _issuerUUID = State(initialValue: document.metadataSummary?.issuer?.uuid ?? "")
        _documentTypeUUID = State(initialValue: document.metadataSummary?.documentType?.uuid ?? "")
        _categoryUUID = State(initialValue: document.metadataSummary?.category?.uuid ?? "")
        _selectedTagUUIDs = State(initialValue: Set(document.metadataSummary?.tags?.compactMap(\.uuid) ?? []))
        _customValues = State(initialValue: Dictionary(
            (document.metadataSummary?.custom ?? []).map { ($0.key, $0.value) },
            uniquingKeysWith: { _, latest in latest }
        ))
    }

    var body: some View {
        Group {
            if isLoading {
                ProgressView("Loading metadata options…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let loadError {
                ContentUnavailableView {
                    Label("Couldn’t load metadata options", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(loadError)
                } actions: {
                    Button("Retry") { Task { await loadOptions() } }
                }
            } else if let options {
                editorForm(options)
            }
        }
        .navigationTitle("Edit metadata")
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
                    if isSaving {
                        ProgressView()
                    } else {
                        Text("Save")
                            .fontWeight(.semibold)
                    }
                }
                .disabled(isLoading || isSaving || options == nil)
            }
        }
        .task { await loadOptions() }
    }

    private func editorForm(_ options: BinderMetadataEditorOptions) -> some View {
        Form {
            if let saveError {
                Section {
                    Label(saveError, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Section("Document") {
                TextField("Title", text: $title)
                    .textInputAutocapitalization(.sentences)
                    .accessibilityLabel("Document title")
            }

            Section("Classification") {
                Picker("Issuer", selection: $issuerUUID) {
                    Text("No issuer").tag("")
                    ForEach(options.issuers) { issuer in
                        Text(issuer.city.map { "\(issuer.name) · \($0)" } ?? issuer.name)
                            .tag(issuer.uuid)
                    }
                }

                Picker("Document type", selection: $documentTypeUUID) {
                    Text("Not classified").tag("")
                    ForEach(options.vocabulary.documentTypes) { item in
                        Text(item.name).tag(item.uuid)
                    }
                }

                Picker("Category", selection: $categoryUUID) {
                    Text("No category").tag("")
                    ForEach(options.vocabulary.categories) { item in
                        Text(item.name).tag(item.uuid)
                    }
                }
            }

            Section("Tags") {
                if options.vocabulary.tags.isEmpty {
                    Text("No tags are available")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(options.vocabulary.tags) { tag in
                        Toggle(tag.name, isOn: tagBinding(tag.uuid))
                    }
                }
            }

            Section("Folders") {
                if folders.isEmpty {
                    Text("No folders are available")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(sortedFolders) { folder in
                        Toggle(folder.path(in: folders), isOn: folderBinding(folder.uuid))
                    }
                }
            }

            if !options.definitions.isEmpty {
                Section("Custom fields") {
                    ForEach(options.definitions) { definition in
                        customField(definition)
                    }
                }
            }

            let unmatchedValues = customValues.keys
                .filter { key in !options.definitions.contains(where: { $0.key == key }) }
                .sorted()
            if !unmatchedValues.isEmpty {
                Section("Other saved fields") {
                    ForEach(unmatchedValues, id: \.self) { key in
                        LabeledContent(key, value: customValues[key]?.displayText ?? "—")
                    }
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }

    @ViewBuilder
    private func customField(_ definition: BinderMetadataDefinition) -> some View {
        switch definition.type {
        case "boolean":
            Toggle(definition.label, isOn: booleanBinding(definition.key))
        case "select":
            Picker(definition.label, selection: textBinding(definition.key)) {
                Text("None").tag("")
                ForEach(definition.options ?? [], id: \.self) { option in
                    Text(option).tag(option)
                }
            }
        case "multi-select":
            DisclosureGroup(definition.label) {
                ForEach(definition.options ?? [], id: \.self) { option in
                    Toggle(option, isOn: multiSelectBinding(definition.key, option: option))
                }
            }
        case "number":
            TextField(definition.label, text: textBinding(definition.key))
                .keyboardType(.decimalPad)
        case "date", "datetime":
            TextField(definition.label, text: textBinding(definition.key))
                .textInputAutocapitalization(.never)
        default:
            TextField(definition.label, text: textBinding(definition.key))
        }
    }

    private func tagBinding(_ uuid: String) -> Binding<Bool> {
        Binding(
            get: { selectedTagUUIDs.contains(uuid) },
            set: { selected in
                if selected { selectedTagUUIDs.insert(uuid) }
                else { selectedTagUUIDs.remove(uuid) }
            }
        )
    }

    private var sortedFolders: [BinderFolder] {
        folders.sorted {
            $0.path(in: folders).localizedStandardCompare($1.path(in: folders)) == .orderedAscending
        }
    }

    private func folderBinding(_ uuid: String) -> Binding<Bool> {
        Binding(
            get: { selectedFolderUUIDs.contains(uuid) },
            set: { selected in
                if selected { selectedFolderUUIDs.insert(uuid) }
                else { selectedFolderUUIDs.remove(uuid) }
            }
        )
    }

    private func booleanBinding(_ key: String) -> Binding<Bool> {
        Binding(
            get: {
                guard case .boolean(let value) = customValues[key] else { return false }
                return value
            },
            set: { customValues[key] = .boolean($0) }
        )
    }

    private func textBinding(_ key: String) -> Binding<String> {
        Binding(
            get: { customValues[key]?.displayText == "—" ? "" : (customValues[key]?.displayText ?? "") },
            set: { value in
                if let definition = options?.definitions.first(where: { $0.key == key }), definition.type == "number" {
                    let normalized = value.replacingOccurrences(of: ",", with: ".")
                    customValues[key] = Double(normalized).map(BinderMetadataValue.number) ?? .string(value)
                } else {
                    customValues[key] = .string(value)
                }
            }
        )
    }

    private func multiSelectBinding(_ key: String, option: String) -> Binding<Bool> {
        Binding(
            get: {
                guard case .array(let values) = customValues[key] else { return false }
                return values.contains { value in
                    if case .string(let string) = value { return string == option }
                    return false
                }
            },
            set: { selected in
                var values: [String] = []
                if case .array(let current) = customValues[key] {
                    values = current.compactMap { value in
                        if case .string(let string) = value { return string }
                        return nil
                    }
                }
                if selected, !values.contains(option) { values.append(option) }
                if !selected { values.removeAll { $0 == option } }
                customValues[key] = .array(values.map(BinderMetadataValue.string))
            }
        )
    }

    @MainActor
    private func loadOptions() async {
        isLoading = true
        loadError = nil
        defer { isLoading = false }
        do {
            async let editorOptions = BinderAPI.shared.metadataEditorOptions(serverURL: serverURL)
            async let allFolders = BinderAPI.shared.allFolders(serverURL: serverURL)
            async let assignedFolders = BinderAPI.shared.foldersForDocument(
                serverURL: serverURL,
                documentUUID: document.uuid
            )
            let (loadedOptions, loadedFolders, loadedAssignedFolders) = try await (
                editorOptions,
                allFolders,
                assignedFolders
            )
            options = loadedOptions
            folders = loadedFolders
            originalFolderUUIDs = Set(loadedAssignedFolders.map(\.uuid))
            selectedFolderUUIDs = originalFolderUUIDs
        } catch {
            loadError = error.localizedDescription
        }
    }

    @MainActor
    private func save() async {
        guard let options, !isSaving else { return }
        let normalizedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedTitle.isEmpty else {
            saveError = "Title can’t be empty."
            return
        }

        isSaving = true
        saveError = nil
        defer { isSaving = false }
        do {
            let originalTitle = document.title?.trimmingCharacters(in: .whitespacesAndNewlines)
                .nilIfBlank ?? document.originalFilename
            if normalizedTitle != originalTitle {
                try await BinderAPI.shared.updateDocumentTitle(
                    serverURL: serverURL,
                    documentUUID: document.uuid,
                    title: normalizedTitle
                )
            }
            try await BinderAPI.shared.updateDocumentMetadata(
                serverURL: serverURL,
                documentUUID: document.uuid,
                issuerUUID: issuerUUID.nilIfBlank,
                documentTypeUUID: documentTypeUUID.nilIfBlank,
                categoryUUID: categoryUUID.nilIfBlank,
                tagUUIDs: Array(selectedTagUUIDs),
                custom: customValues
            )

            var routingFolderUUIDs: Set<String> = []
            if let folderUUID = options.issuers.first(where: { $0.uuid == issuerUUID })?.folderUuid {
                routingFolderUUIDs.insert(folderUUID)
            }
            if let folderUUID = options.vocabulary.documentTypes.first(where: { $0.uuid == documentTypeUUID })?.folderUuid {
                routingFolderUUIDs.insert(folderUUID)
            }
            if let folderUUID = options.vocabulary.categories.first(where: { $0.uuid == categoryUUID })?.folderUuid {
                routingFolderUUIDs.insert(folderUUID)
            }
            if selectedFolderUUIDs != originalFolderUUIDs {
                try await BinderAPI.shared.updateDocumentFolders(
                    serverURL: serverURL,
                    documentUUID: document.uuid,
                    selectedFolderUUIDs: selectedFolderUUIDs,
                    originalFolderUUIDs: originalFolderUUIDs.union(routingFolderUUIDs)
                )
            }

            let updatedDocument = updatedSummary(title: normalizedTitle, options: options)
            let updatedFolders = try await BinderAPI.shared.foldersForDocument(
                serverURL: serverURL,
                documentUUID: document.uuid
            )
            onSaved(updatedDocument, updatedFolders)
            dismiss()
        } catch {
            saveError = error.localizedDescription
        }
    }

    private func updatedSummary(title: String, options: BinderMetadataEditorOptions) -> BinderDocumentSummary {
        let metadata = BinderDocumentMetadataSummary(
            documentType: options.vocabulary.documentTypes.first(where: { $0.uuid == documentTypeUUID })
                .map { BinderVocabularyValue(uuid: $0.uuid, name: $0.name) },
            category: options.vocabulary.categories.first(where: { $0.uuid == categoryUUID })
                .map { BinderVocabularyValue(uuid: $0.uuid, name: $0.name) },
            issuer: options.issuers.first(where: { $0.uuid == issuerUUID })
                .map { BinderIssuerValue(uuid: $0.uuid, name: $0.name) },
            tags: options.vocabulary.tags.filter { selectedTagUUIDs.contains($0.uuid) }
                .map { BinderVocabularyValue(uuid: $0.uuid, name: $0.name) },
            custom: customValues.map { key, value in
                BinderCustomMetadataSummary(
                    key: key,
                    label: options.definitions.first(where: { $0.key == key })?.label ?? key,
                    value: value
                )
            }.sorted { $0.label.localizedStandardCompare($1.label) == .orderedAscending }
        )
        return BinderDocumentSummary(
            uuid: document.uuid,
            title: title,
            originalFilename: document.originalFilename,
            pageCount: document.pageCount,
            metadataSummary: metadata,
            status: document.status,
            isNew: document.isNew
        )
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
