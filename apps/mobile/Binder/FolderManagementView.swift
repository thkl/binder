import SwiftUI

struct FolderManagementRequest: Identifiable {
    let id = UUID()
    let folder: BinderFolder?
    let parentUUID: String?
}

struct FolderActionMenu: View {
    let createSubfolder: () -> Void
    let edit: () -> Void
    let share: () -> Void
    let delete: () -> Void

    var body: some View {
        Menu {
            Button("Add subfolder", systemImage: "folder.badge.plus", action: createSubfolder)
            Button("Rename or move", systemImage: "pencil", action: edit)
            Button("Share folder", systemImage: "person.2", action: share)
            Divider()
            Button("Delete folder", systemImage: "trash", role: .destructive, action: delete)
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.title3)
                .foregroundStyle(.secondary)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel("Manage folder")
    }
}

struct FolderManagementSheet: View {
    let folder: BinderFolder?
    let serverURL: String
    let allFolders: [BinderFolder]
    let onSaved: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var parentSelection: String
    @State private var isSaving = false
    @State private var saveError: String?

    init(
        folder: BinderFolder?,
        parentUUID: String?,
        serverURL: String,
        allFolders: [BinderFolder],
        onSaved: @escaping () async -> Void
    ) {
        self.folder = folder
        self.serverURL = serverURL
        self.allFolders = allFolders
        self.onSaved = onSaved
        _name = State(initialValue: folder?.name ?? "")
        _parentSelection = State(initialValue: folder?.parentUuid ?? parentUUID ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Folder") {
                    TextField("Name", text: $name)
                        .textInputAutocapitalization(.words)
                }

                Section("Location") {
                    Picker("Parent folder", selection: $parentSelection) {
                        Text("Top level").tag("")
                        ForEach(availableParents) { parent in
                            Text(parent.path(in: allFolders)).tag(parent.uuid)
                        }
                    }
                }

                if let saveError {
                    Section {
                        Label(saveError, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .navigationTitle(folder == nil ? "New folder" : "Edit folder")
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

    private var availableParents: [BinderFolder] {
        var excluded = Set<String>()
        if let folder {
            excluded.insert(folder.uuid)
            var foundNewDescendant = true
            while foundNewDescendant {
                let previousCount = excluded.count
                for candidate in allFolders where candidate.parentUuid.map(excluded.contains) == true {
                    excluded.insert(candidate.uuid)
                }
                foundNewDescendant = excluded.count != previousCount
            }
        }

        return allFolders
            .filter { !excluded.contains($0.uuid) }
            .sorted { $0.path(in: allFolders).localizedStandardCompare($1.path(in: allFolders)) == .orderedAscending }
    }

    @MainActor
    private func save() async {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty, !isSaving else { return }
        isSaving = true
        saveError = nil
        defer { isSaving = false }

        do {
            let parentUUID = parentSelection.isEmpty ? nil : parentSelection
            if let folder {
                if trimmedName != folder.name {
                    _ = try await BinderAPI.shared.updateFolder(
                        serverURL: serverURL,
                        uuid: folder.uuid,
                        name: trimmedName
                    )
                }
                if parentUUID != folder.parentUuid {
                    _ = try await BinderAPI.shared.moveFolder(
                        serverURL: serverURL,
                        uuid: folder.uuid,
                        parentUUID: parentUUID
                    )
                }
            } else {
                _ = try await BinderAPI.shared.createFolder(
                    serverURL: serverURL,
                    name: trimmedName,
                    parentUUID: parentUUID
                )
            }

            await onSaved()
            dismiss()
        } catch {
            saveError = error.localizedDescription
        }
    }
}
