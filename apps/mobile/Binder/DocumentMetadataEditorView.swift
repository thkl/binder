import SwiftUI

struct DocumentMetadataEditorView: View {
    let document: BinderDocumentSummary
    let serverURL: String
    let onSaved: (BinderDocumentSummary, [BinderFolder]) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var options: BinderMetadataEditorOptions?
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var isSuggesting = false
    @State private var loadError: String?
    @State private var saveError: String?
    @State private var suggestionError: String?
    @State private var suggestion: BinderAISuggestion?
    @State private var selectedSuggestionFields: Set<String> = []
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

            suggestionSection(options)

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
    private func suggestionSection(_ options: BinderMetadataEditorOptions) -> some View {
        Section {
            if let suggestion {
                VStack(alignment: .leading, spacing: 6) {
                    Label("AI suggestions", systemImage: "sparkles")
                        .font(.headline)
                    Text("\(Int((suggestion.confidence * 100).rounded()))% confidence")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if suggestion.classificationSource == "feedback" || suggestion.classificationSource == "mixed" {
                        Text("Some suggestions use your previous classification choices.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 3)

                suggestionToggle("title", title: "Title", value: suggestion.suggestedTitle)
                if let uuid = suggestion.documentTypeUuid {
                    suggestionToggle(
                        "documentTypeUuid",
                        title: "Document type",
                        value: options.vocabulary.documentTypes.first(where: { $0.uuid == uuid })?.name ?? "Unavailable"
                    )
                }
                if let uuid = suggestion.categoryUuid {
                    suggestionToggle(
                        "categoryUuid",
                        title: "Category",
                        value: options.vocabulary.categories.first(where: { $0.uuid == uuid })?.name ?? "Unavailable"
                    )
                }
                if suggestion.issuerUuid != nil || suggestion.suggestedIssuer != nil {
                    let issuerName = suggestion.issuerUuid.flatMap { uuid in
                        options.issuers.first(where: { $0.uuid == uuid })?.name
                    } ?? suggestion.suggestedIssuer?.name ?? "Unavailable"
                    suggestionToggle("issuerUuid", title: "Issuer", value: issuerName)
                }
                if !suggestion.tagUuids.isEmpty {
                    let tagNames = suggestion.tagUuids.compactMap { uuid in
                        options.vocabulary.tags.first(where: { $0.uuid == uuid })?.name
                    }
                    suggestionToggle("tagUuids", title: "Tags", value: tagNames.joined(separator: ", "))
                }
                if !suggestion.custom.isEmpty {
                    let fieldNames = suggestion.custom.keys.sorted().map { key in
                        options.definitions.first(where: { $0.key == key })?.label ?? key
                    }
                    suggestionToggle("custom", title: "Custom fields", value: fieldNames.joined(separator: ", "))
                }

                Button("Apply selected and save") {
                    Task { await applySelectedSuggestions(selectAll: false) }
                }
                .disabled(selectedSuggestionFields.isEmpty || isSaving || isSuggesting)

                Button("Accept all and save") {
                    Task { await applySelectedSuggestions(selectAll: true) }
                }
                .disabled(isSaving || isSuggesting)

                Button("Dismiss suggestions", role: .destructive) {
                    Task { await dismissSuggestions() }
                }
                .disabled(isSaving || isSuggesting)

                Button {
                    Task { await generateSuggestions() }
                } label: {
                    if isSuggesting { ProgressView() }
                    else { Label("Regenerate suggestions", systemImage: "arrow.clockwise") }
                }
                .disabled(isSuggesting || isSaving)
            } else {
                Button {
                    Task { await generateSuggestions() }
                } label: {
                    if isSuggesting {
                        ProgressView("Generating suggestions…")
                    } else {
                        Label("Suggest metadata with AI", systemImage: "sparkles")
                    }
                }
                .disabled(isSuggesting || isSaving)
            }

            if let suggestionError {
                Label(suggestionError, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } header: {
            Text("AI suggestions")
        }
    }

    private func suggestionToggle(_ field: String, title: String, value: String) -> some View {
        Toggle(isOn: Binding(
            get: { selectedSuggestionFields.contains(field) },
            set: { selected in
                if selected { selectedSuggestionFields.insert(field) }
                else { selectedSuggestionFields.remove(field) }
            }
        )) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(value.isEmpty ? "No value" : value)
                    .font(.body)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
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
            async let pendingSuggestion = BinderAPI.shared.documentSuggestion(
                serverURL: serverURL,
                documentUUID: document.uuid
            )
            let (loadedOptions, loadedFolders, loadedAssignedFolders, loadedSuggestion) = try await (
                editorOptions,
                allFolders,
                assignedFolders,
                pendingSuggestion
            )
            options = loadedOptions
            folders = loadedFolders
            suggestion = loadedSuggestion
            let assignedFolderUUIDs = Set(loadedAssignedFolders.map(\.uuid))
            originalFolderUUIDs = assignedFolderUUIDs
            selectedFolderUUIDs = assignedFolderUUIDs
        } catch {
            loadError = error.localizedDescription
        }
    }

    @MainActor
    private func save(clearPendingSuggestion: Bool = false) async {
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
            if clearPendingSuggestion {
                _ = try await BinderAPI.shared.clearDocumentSuggestion(
                    serverURL: serverURL,
                    documentUUID: document.uuid
                )
                suggestion = nil
                selectedSuggestionFields = []
            }
            onSaved(updatedDocument, updatedFolders)
            dismiss()
        } catch {
            saveError = error.localizedDescription
        }
    }

    @MainActor
    private func generateSuggestions() async {
        guard !isSuggesting else { return }
        isSuggesting = true
        suggestionError = nil
        defer { isSuggesting = false }
        do {
            suggestion = try await BinderAPI.shared.suggestDocumentMetadata(
                serverURL: serverURL,
                documentUUID: document.uuid
            )
            selectedSuggestionFields = []
        } catch {
            suggestionError = error.localizedDescription
        }
    }

    @MainActor
    private func dismissSuggestions() async {
        guard !isSaving else { return }
        suggestionError = nil
        do {
            _ = try await BinderAPI.shared.clearDocumentSuggestion(
                serverURL: serverURL,
                documentUUID: document.uuid
            )
            suggestion = nil
            selectedSuggestionFields = []
        } catch {
            suggestionError = error.localizedDescription
        }
    }

    @MainActor
    private func applySelectedSuggestions(selectAll: Bool) async {
        guard let suggestion, !isSaving else { return }
        if selectAll {
            var allFields: Set<String> = ["title"]
            if suggestion.documentTypeUuid != nil { allFields.insert("documentTypeUuid") }
            if suggestion.categoryUuid != nil { allFields.insert("categoryUuid") }
            if suggestion.issuerUuid != nil || suggestion.suggestedIssuer != nil {
                allFields.insert("issuerUuid")
            }
            if !suggestion.tagUuids.isEmpty { allFields.insert("tagUuids") }
            if !suggestion.custom.isEmpty { allFields.insert("custom") }
            selectedSuggestionFields = allFields
        }
        guard !selectedSuggestionFields.isEmpty else { return }

        suggestionError = nil
        if selectedSuggestionFields.contains("title") {
            title = suggestion.suggestedTitle
        }
        if selectedSuggestionFields.contains("documentTypeUuid"),
           let documentTypeUuid = suggestion.documentTypeUuid {
            self.documentTypeUUID = documentTypeUuid
        }
        if selectedSuggestionFields.contains("categoryUuid"),
           let categoryUuid = suggestion.categoryUuid {
            self.categoryUUID = categoryUuid
        }
        if selectedSuggestionFields.contains("issuerUuid") {
            if let issuerUuid = suggestion.issuerUuid {
                self.issuerUUID = issuerUuid
            } else if let candidate = suggestion.suggestedIssuer, let options {
                do {
                    let normalized: (String?) -> String = { $0?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? "" }
                    let existingIssuer = options.issuers.first { issuer in
                        normalized(issuer.name) == normalized(candidate.name) &&
                        [
                            (candidate.address, issuer.address),
                            (candidate.zipCode, issuer.zipCode),
                            (candidate.city, issuer.city),
                            (candidate.country, issuer.country),
                        ].allSatisfy { pair in
                            pair.0 == nil || normalized(pair.1) == normalized(pair.0)
                        }
                    }
                    let issuer: BinderIssuer
                    if let existingIssuer {
                        issuer = existingIssuer
                    } else {
                        issuer = try await BinderAPI.shared.createIssuer(
                            serverURL: serverURL,
                            payload: IssuerMutationPayload(
                                name: candidate.name,
                                address: candidate.address,
                                zipCode: candidate.zipCode,
                                city: candidate.city,
                                country: candidate.country,
                                custom: candidate.custom ?? [:],
                                folderUuid: nil
                            )
                        )
                    }
                    self.issuerUUID = issuer.uuid
                } catch {
                    suggestionError = error.localizedDescription
                    return
                }
            }
        }
        if selectedSuggestionFields.contains("tagUuids") {
            selectedTagUUIDs = Set(suggestion.tagUuids)
        }
        if selectedSuggestionFields.contains("custom") {
            customValues.merge(suggestion.custom) { _, suggestedValue in suggestedValue }
        }

        await save(clearPendingSuggestion: true)
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
            mimeType: document.mimeType,
            pageCount: document.pageCount,
            metadataSummary: metadata,
            status: document.status,
            isNew: document.isNew,
            versionNumber: document.versionNumber,
            versionParentUuid: document.versionParentUuid,
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
