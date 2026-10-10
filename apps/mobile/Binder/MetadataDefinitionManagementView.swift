import SwiftUI

private struct DefinitionLabelRequest: Identifiable {
    let id = UUID()
    let definition: BinderMetadataDefinition
}

private enum MetadataFieldKind: String, CaseIterable, Identifiable {
    case text
    case number
    case date
    case datetime
    case boolean
    case select
    case multiSelect = "multi-select"

    var id: String { rawValue }
    var title: String {
        switch self {
        case .text: "Text"
        case .number: "Number"
        case .date: "Date"
        case .datetime: "Date and time"
        case .boolean: "Yes / No"
        case .select: "Select"
        case .multiSelect: "Multi-select"
        }
    }
    var needsOptions: Bool { self == .select || self == .multiSelect }
}

struct MetadataDefinitionManagementView: View {
    @ObservedObject var model: AuthViewModel

    @State private var definitions: [BinderMetadataDefinition] = []
    @State private var scope = "personal"
    @State private var fieldKey = ""
    @State private var fieldLabel = ""
    @State private var fieldType: MetadataFieldKind = .text
    @State private var fieldOptions = ""
    @State private var isMandatory = false
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var labelRequest: DefinitionLabelRequest?
    @State private var definitionToDelete: BinderMetadataDefinition?

    private var isAdmin: Bool { model.user?.isAdmin == true }
    private var visibleDefinitions: [BinderMetadataDefinition] {
        definitions
            .filter { $0.active != false && $0.scope == scope }
            .sorted { $0.label.localizedStandardCompare($1.label) == .orderedAscending }
    }

    var body: some View {
        Group {
            if isLoading && definitions.isEmpty {
                ProgressView("Loading custom fields…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    if let errorMessage {
                        Section {
                            Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                                .foregroundStyle(.red)
                            Button("Retry") { Task { await load() } }
                        }
                    }

                    Section("Add a custom field") {
                        MetadataFormField(title: "Field key") {
                            TextField("Example: issueDate", text: $fieldKey)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .onChange(of: fieldKey) { _, value in
                                    fieldKey = value.filter { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_") }
                                    if let first = fieldKey.first, !first.isLowercase {
                                        fieldKey = fieldKey.prefix(1).lowercased() + fieldKey.dropFirst()
                                    }
                                }
                        }
                        MetadataFormField(title: "Display label") {
                            TextField("Shown in document metadata", text: $fieldLabel)
                                .textInputAutocapitalization(.words)
                        }
                        MetadataFormField(title: "Field type") {
                            Picker("Field type", selection: $fieldType) {
                                ForEach(MetadataFieldKind.allCases) { type in
                                    Text(type.title).tag(type)
                                }
                            }
                            .pickerStyle(.menu)
                        }
                        if fieldType.needsOptions {
                            MetadataFormField(title: "Options") {
                                TextField("Comma-separated values", text: $fieldOptions, axis: .vertical)
                                    .lineLimit(2...4)
                            }
                        }
                        Toggle("Required", isOn: $isMandatory)
                        Button {
                            Task { await createDefinition() }
                        } label: {
                            HStack {
                                Spacer()
                                if isSaving { ProgressView() }
                                else { Label("Add field", systemImage: "plus") }
                                Spacer()
                            }
                        }
                        .disabled(isSaving || !isValidKey || fieldLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (fieldType.needsOptions && parsedOptions.isEmpty))
                    }

                    Section("Custom fields · \(visibleDefinitions.count)") {
                        if visibleDefinitions.isEmpty {
                            Text("No custom fields in this scope yet.")
                                .foregroundStyle(.secondary)
                        }
                        ForEach(visibleDefinitions) { definition in
                            HStack(alignment: .center, spacing: 12) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(definition.label).font(.body.weight(.semibold))
                                    Text("\(definition.key) · \(typeTitle(definition.type))\(definition.mandatory == true ? " · Required" : "")")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Menu {
                                    if canManage(definition) {
                                        Button("Edit label", systemImage: "pencil") {
                                            labelRequest = DefinitionLabelRequest(definition: definition)
                                        }
                                        Button("Delete", systemImage: "trash", role: .destructive) {
                                            definitionToDelete = definition
                                        }
                                    }
                                } label: {
                                    Image(systemName: "ellipsis")
                                        .foregroundStyle(.secondary)
                                        .frame(width: 36, height: 36)
                                        .contentShape(Rectangle())
                                }
                                .accessibilityLabel("Actions for \(definition.label)")
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable { await load() }
            }
        }
        .navigationTitle("Custom fields")
        .toolbar {
            if isAdmin {
                ToolbarItem(placement: .principal) {
                    Picker("Scope", selection: $scope) {
                        Text("Personal").tag("personal")
                        Text("Workspace").tag("system")
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 240)
                }
            }
        }
        .sheet(item: $labelRequest) { request in
            MetadataDefinitionLabelEditorView(
                definition: request.definition,
                serverURL: model.serverURL,
                onSaved: { await load() }
            )
        }
        .confirmationDialog(
            "Delete this custom field? Existing document values remain stored but will no longer be editable.",
            isPresented: Binding(
                get: { definitionToDelete != nil },
                set: { if !$0 { definitionToDelete = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let definitionToDelete { Task { await delete(definitionToDelete) } }
                definitionToDelete = nil
            }
            Button("Cancel", role: .cancel) { definitionToDelete = nil }
        }
        .task(id: model.serverURL) { await load() }
    }

    private var parsedOptions: [String] {
        fieldOptions.split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private var isValidKey: Bool {
        guard let first = fieldKey.first, first.isLowercase else { return false }
        return fieldKey.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_") }
    }

    private func typeTitle(_ type: String) -> String {
        MetadataFieldKind(rawValue: type)?.title ?? type
    }

    private func canManage(_ definition: BinderMetadataDefinition) -> Bool {
        definition.scope == "personal" || isAdmin
    }

    @MainActor
    private func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            definitions = try await BinderAPI.shared.metadataEditorOptions(serverURL: model.serverURL)
                .definitions
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func createDefinition() async {
        let normalizedKey = fieldKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedLabel = fieldLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isValidKey, !normalizedLabel.isEmpty, !isSaving else { return }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            try await BinderAPI.shared.createMetadataDefinition(
                serverURL: model.serverURL,
                payload: BinderMetadataDefinitionCreatePayload(
                    key: normalizedKey,
                    label: normalizedLabel,
                    type: fieldType.rawValue,
                    options: fieldType.needsOptions ? parsedOptions : nil,
                    unique: false,
                    mandatory: isMandatory,
                    scope: scope
                )
            )
            fieldKey = ""
            fieldLabel = ""
            fieldType = .text
            fieldOptions = ""
            isMandatory = false
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func delete(_ definition: BinderMetadataDefinition) async {
        do {
            try await BinderAPI.shared.deleteMetadataDefinition(serverURL: model.serverURL, uuid: definition.uuid)
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct MetadataDefinitionLabelEditorView: View {
    let definition: BinderMetadataDefinition
    let serverURL: String
    let onSaved: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var label: String
    @State private var errorMessage: String?
    @State private var isSaving = false

    init(definition: BinderMetadataDefinition, serverURL: String, onSaved: @escaping () async -> Void) {
        self.definition = definition
        self.serverURL = serverURL
        self.onSaved = onSaved
        _label = State(initialValue: definition.label)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Custom field") {
                    LabeledContent("Key", value: definition.key)
                    LabeledContent("Type", value: MetadataFieldKind(rawValue: definition.type)?.title ?? definition.type)
                    MetadataFormField(title: "Display label") {
                        TextField("Enter label", text: $label)
                    }
                }
                if let errorMessage {
                    Section { Label(errorMessage, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
                }
            }
            .navigationTitle("Edit custom field")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() }.disabled(isSaving) }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") { Task { await save() } }
                        .disabled(isSaving || label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    @MainActor
    private func save() async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            try await BinderAPI.shared.updateMetadataDefinition(
                serverURL: serverURL,
                uuid: definition.uuid,
                payload: BinderMetadataDefinitionUpdatePayload(
                    label: label.trimmingCharacters(in: .whitespacesAndNewlines)
                )
            )
            await onSaved()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
