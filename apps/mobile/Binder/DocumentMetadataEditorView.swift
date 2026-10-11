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
                if selectedFolders.isEmpty {
                    Text("No folders selected")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(selectedFolders) { folder in
                        Text(folder.path(in: folders))
                    }
                    .onDelete(perform: removeSelectedFolders)
                }

                NavigationLink {
                    FolderSelectionView(
                        folders: sortedFolders,
                        selectedFolderUUIDs: $selectedFolderUUIDs
                    )
                } label: {
                    Label("Add folder", systemImage: "folder.badge.plus")
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
        case "date":
            DatePicker(
                definition.label,
                selection: dateBinding(definition.key, includesTime: false),
                displayedComponents: .date
            )
            .datePickerStyle(.compact)
        case "datetime":
            DatePicker(
                definition.label,
                selection: dateBinding(definition.key, includesTime: true),
                displayedComponents: [.date, .hourAndMinute]
            )
            .datePickerStyle(.compact)
        case "number":
            TextField(definition.label, text: textBinding(definition.key))
                .keyboardType(.decimalPad)
        case "text":
            TextField(definition.label, text: textBinding(definition.key))
        default:
            TextField(definition.label, text: textBinding(definition.key))
        }
    }

    private func dateBinding(_ key: String, includesTime: Bool) -> Binding<Date> {
        Binding(
            get: {
                guard case .string(let value) = customValues[key],
                      let date = parseDate(value, includesTime: includesTime) else {
                    return Date()
                }
                return date
            },
            set: { customValues[key] = .string(formatDate($0, includesTime: includesTime)) }
        )
    }

    private func parseDate(_ value: String, includesTime: Bool) -> Date? {
        if includesTime {
            let isoFormatter = ISO8601DateFormatter()
            isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = isoFormatter.date(from: value) { return date }
            isoFormatter.formatOptions = [.withInternetDateTime]
            if let date = isoFormatter.date(from: value) { return date }
        } else if value.count >= 10 {
            // Date fields may arrive as a date-only value or as an ISO timestamp.
            let datePrefix = String(value.prefix(10))
            if let date = parseLocalDate(datePrefix, format: "yyyy-MM-dd") { return date }
        }

        let formats = includesTime
            ? ["yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm:ss.SSS"]
            : ["yyyy-MM-dd"]
        for format in formats {
            if let date = parseLocalDate(value, format: format) { return date }
        }
        return nil
    }

    private func parseLocalDate(_ value: String, format: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        formatter.isLenient = false
        formatter.dateFormat = format
        return formatter.date(from: value)
    }

    private func formatDate(_ date: Date, includesTime: Bool) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        formatter.dateFormat = includesTime ? "yyyy-MM-dd'T'HH:mm" : "yyyy-MM-dd"
        return formatter.string(from: date)
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

    private var selectedFolders: [BinderFolder] {
        sortedFolders.filter { selectedFolderUUIDs.contains($0.uuid) }
    }

    private func removeSelectedFolders(at offsets: IndexSet) {
        let activeFolders = selectedFolders
        let removedUUIDs = offsets.compactMap { activeFolders[$0].uuid }
        selectedFolderUUIDs = selectedFolderUUIDs.subtracting(removedUUIDs)
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
        // The view can reappear after navigating back from the folder picker. Preserve
        // in-progress edits instead of reloading server state over the user's selection.
        guard options == nil else { return }
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
            let assignedFolderUUIDs = Set(loadedAssignedFolders.map(\.uuid))
            originalFolderUUIDs = assignedFolderUUIDs
            selectedFolderUUIDs = assignedFolderUUIDs
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

            let folderSelectionChanged = selectedFolderUUIDs != originalFolderUUIDs
            if folderSelectionChanged {
                // Metadata saving can add automatic routing folders. Reconcile against
                // the server's latest links so both additions and swipe deletions apply.
                let currentlyAssignedFolders = try await BinderAPI.shared.foldersForDocument(
                    serverURL: serverURL,
                    documentUUID: document.uuid
                )
                try await BinderAPI.shared.updateDocumentFolders(
                    serverURL: serverURL,
                    documentUUID: document.uuid,
                    selectedFolderUUIDs: selectedFolderUUIDs,
                    originalFolderUUIDs: Set(currentlyAssignedFolders.map(\.uuid))
                )
            }

            let updatedDocument = updatedSummary(title: normalizedTitle, options: options)
            let updatedFolders = try await BinderAPI.shared.foldersForDocument(
                serverURL: serverURL,
                documentUUID: document.uuid
            )
            if folderSelectionChanged, Set(updatedFolders.map(\.uuid)) != selectedFolderUUIDs {
                throw BinderAPIError.server("The folder assignments could not be saved. Please try again.")
            }
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
            isNew: document.isNew,
            versionNumber: document.versionNumber,
            createdAt: document.createdAt
        )
    }
}

private struct FolderSelectionView: View {
    let folders: [BinderFolder]
    @Binding var selectedFolderUUIDs: Set<String>

    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""

    private var filteredFolders: [BinderFolder] {
        guard !searchText.isEmpty else { return folders }
        return folders.filter { $0.path(in: folders).localizedCaseInsensitiveContains(searchText) }
    }

    var body: some View {
        List(filteredFolders) { folder in
            Button {
                var updatedSelection = selectedFolderUUIDs
                if updatedSelection.contains(folder.uuid) {
                    updatedSelection.remove(folder.uuid)
                } else {
                    updatedSelection.insert(folder.uuid)
                }
                selectedFolderUUIDs = updatedSelection
            } label: {
                HStack(spacing: 12) {
                    Text(folder.path(in: folders))
                        .foregroundStyle(.primary)
                    Spacer(minLength: 12)
                    if selectedFolderUUIDs.contains(folder.uuid) {
                        Image(systemName: "checkmark")
                            .fontWeight(.semibold)
                            .foregroundStyle(.tint)
                            .accessibilityLabel("Selected")
                    }
                }
                .contentShape(Rectangle())
                .frame(minHeight: 44)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(selectedFolderUUIDs.contains(folder.uuid) ? .isSelected : [])
        }
        .overlay {
            if folders.isEmpty {
                ContentUnavailableView("No folders available", systemImage: "folder")
            } else if filteredFolders.isEmpty {
                ContentUnavailableView.search(text: searchText)
            }
        }
        .searchable(text: $searchText, prompt: "Search folders")
        .navigationTitle("Add folders")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() }
            }
        }
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
