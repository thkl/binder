import SwiftUI

struct BrowseView: View {
    @ObservedObject var model: AuthViewModel

    @State private var allFolders: [BinderFolder] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var folderEditorRequest: FolderManagementRequest?
    @State private var shareRequest: ShareManagementRequest?
    @State private var folderToDelete: BinderFolder?
    @State private var showingDeleteConfirmation = false
    @State private var managementError: String?

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && allFolders.isEmpty {
                    ProgressView("Loading folders…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage, allFolders.isEmpty {
                    ContentUnavailableView {
                        Label("Couldn’t load folders", systemImage: "folder.badge.questionmark")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("Retry") { Task { await loadFolders() } }
                    }
                } else if rootFolders.isEmpty {
                    ContentUnavailableView {
                        Label("No folders yet", systemImage: "folder")
                    } description: {
                        Text("Create a folder to organize your documents.")
                    } actions: {
                        Button("Create folder") { beginCreateFolder(parentUUID: nil) }
                    }
                } else {
                    List {
                        if let errorMessage {
                            Section {
                                ErrorBanner(message: errorMessage) {
                                    Task { await loadFolders() }
                                }
                            }
                        }

                        Section("Folders") {
                            ForEach(rootFolders) { folder in folderRow(folder) }
                        }
                    }
                    .listStyle(.insetGrouped)
                    .refreshable { await loadFolders() }
                }
            }
            .navigationTitle("Folders")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { beginCreateFolder(parentUUID: nil) } label: {
                        Label("New folder", systemImage: "plus")
                    }
                    .accessibilityIdentifier("create-folder")
                }
            }
            .sheet(item: $folderEditorRequest) { request in
                FolderManagementSheet(
                    folder: request.folder,
                    parentUUID: request.parentUUID,
                    serverURL: model.serverURL,
                    allFolders: allFolders,
                    onSaved: { await loadFolders() }
                )
            }
            .sheet(item: $shareRequest) { request in
                ShareManagementView(
                    resource: request.resource,
                    resourceUUID: request.uuid,
                    serverURL: model.serverURL
                )
            }
            .confirmationDialog(
                "Delete folder?",
                isPresented: $showingDeleteConfirmation,
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    if let folderToDelete { Task { await deleteFolder(folderToDelete) } }
                }
                Button("Cancel", role: .cancel) { folderToDelete = nil }
            } message: {
                Text("Its documents will be unlinked, and its child folders will be moved to the top level.")
            }
            .alert("Folder update failed", isPresented: Binding(
                get: { managementError != nil },
                set: { if !$0 { managementError = nil } }
            )) {
                Button("OK", role: .cancel) { managementError = nil }
            } message: {
                Text(managementError ?? "")
            }
            .task { await loadFolders() }
        }
    }

    private var rootFolders: [BinderFolder] {
        allFolders
            .filter { $0.parentUuid == nil }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    private func folderRow(_ folder: BinderFolder) -> some View {
        HStack(spacing: 8) {
            NavigationLink {
                FolderContentsView(
                    folder: folder,
                    model: model,
                    allFolders: $allFolders,
                    onFolderTreeChanged: loadFolders
                )
            } label: {
                FolderListRow(folder: folder)
            }
            .buttonStyle(.plain)

            FolderActionMenu(
                createSubfolder: { beginCreateFolder(parentUUID: folder.uuid) },
                edit: { beginEditFolder(folder) },
                share: { shareRequest = ShareManagementRequest(resource: .folders, uuid: folder.uuid) },
                delete: { confirmDelete(folder) }
            )
        }
        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 8))
    }

    private func beginCreateFolder(parentUUID: String?) {
        folderEditorRequest = FolderManagementRequest(folder: nil, parentUUID: parentUUID)
    }

    private func beginEditFolder(_ folder: BinderFolder) {
        folderEditorRequest = FolderManagementRequest(folder: folder, parentUUID: folder.parentUuid)
    }

    private func confirmDelete(_ folder: BinderFolder) {
        folderToDelete = folder
        showingDeleteConfirmation = true
    }

    @MainActor
    private func loadFolders() async {
        guard !isLoading || allFolders.isEmpty else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            allFolders = try await BinderAPI.shared.allFolders(serverURL: model.serverURL)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func deleteFolder(_ folder: BinderFolder) async {
        folderToDelete = nil
        do {
            try await BinderAPI.shared.deleteFolder(serverURL: model.serverURL, uuid: folder.uuid)
            await loadFolders()
        } catch {
            managementError = error.localizedDescription
        }
    }
}

private struct FolderContentsView: View {
    let folder: BinderFolder
    @ObservedObject var model: AuthViewModel
    @Binding var allFolders: [BinderFolder]
    let onFolderTreeChanged: () async -> Void

    @State private var sortOptions: BinderFolderSortOptions
    @State private var subfolders: [BinderFolder] = []
    @State private var documents: [BinderDocumentSummary] = []
    @State private var nextPage = 1
    @State private var hasNextPage = false
    @State private var isLoading = true
    @State private var isLoadingMore = false
    @State private var errorMessage: String?
    @State private var documentErrorMessage: String?
    @State private var folderEditorRequest: FolderManagementRequest?
    @State private var shareRequest: ShareManagementRequest?
    @State private var folderToDelete: BinderFolder?
    @State private var showingDeleteConfirmation = false
    @State private var managementError: String?

    init(
        folder: BinderFolder,
        model: AuthViewModel,
        allFolders: Binding<[BinderFolder]>,
        onFolderTreeChanged: @escaping () async -> Void
    ) {
        self.folder = folder
        self.model = model
        self._allFolders = allFolders
        self.onFolderTreeChanged = onFolderTreeChanged
        _sortOptions = State(initialValue: FolderSortPreferenceStore.load(
            serverURL: model.serverURL,
            accountID: model.user?.uuid ?? model.username,
            folderUUID: folder.uuid
        ))
    }

    var body: some View {
        Group {
            if isLoading && subfolders.isEmpty && documents.isEmpty {
                ProgressView("Loading folder…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage, subfolders.isEmpty && documents.isEmpty {
                ContentUnavailableView {
                    Label("Couldn’t load folder", systemImage: "folder.badge.questionmark")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Retry") { Task { await loadContents() } }
                }
            } else {
                List {
                    if let errorMessage {
                        Section {
                            ErrorBanner(message: errorMessage) {
                                Task { await loadContents() }
                            }
                        }
                    }

                    if !subfolders.isEmpty {
                        Section("Folders") {
                            ForEach(subfolders) { child in
                                folderRow(child)
                            }
                        }
                    }

                    if let documentErrorMessage {
                        Section("Documents") {
                            ErrorBanner(message: documentErrorMessage) {
                                Task { await loadDocuments(reset: true) }
                            }
                        }
                    } else if documents.isEmpty && !isLoading {
                        Section("Documents") {
                            ContentUnavailableView(
                                "No documents in this folder",
                                systemImage: "doc.text",
                                description: Text("Documents assigned directly to this folder will appear here.")
                            )
                            .listRowBackground(Color.clear)
                        }
                    } else if !documents.isEmpty {
                        if sortOptions.groupBy == .none {
                            Section("Documents") {
                                documentRows(documents)
                                loadMoreRow
                            }
                        } else {
                            ForEach(documentGroups) { group in
                                Section(group.label) {
                                    documentRows(group.documents)
                                }
                            }
                            if hasNextPage {
                                Section { loadMoreRow }
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable { await loadContents() }
            }
        }
        .navigationTitle(folder.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 12) {
                    Button { beginCreateFolder(parentUUID: folder.uuid) } label: {
                        Image(systemName: "folder.badge.plus")
                    }
                    .accessibilityLabel("Create subfolder")

                    Button {
                        shareRequest = ShareManagementRequest(resource: .folders, uuid: folder.uuid)
                    } label: {
                        Label("Share folder", systemImage: "person.2")
                    }

                    Menu {
                        Picker("Group by", selection: $sortOptions.groupBy) {
                            ForEach(BinderGroupMode.allCases) { mode in
                                Text(mode.label).tag(mode)
                            }
                        }
                        Picker("Sort order", selection: $sortOptions.direction) {
                            ForEach(BinderSortDirection.allCases) { direction in
                                Text(direction.label).tag(direction)
                            }
                        }
                        if sortOptions.groupBy != .none {
                            Picker("Group order", selection: $sortOptions.groupDirection) {
                                ForEach(BinderSortDirection.allCases) { direction in
                                    Text(direction.label).tag(direction)
                                }
                            }
                        }
                    } label: {
                        Label("Sort", systemImage: "arrow.up.arrow.down")
                    }
                    .accessibilityLabel("Sort and group documents")
                }
            }
        }
        .sheet(item: $folderEditorRequest) { request in
            FolderManagementSheet(
                folder: request.folder,
                parentUUID: request.parentUUID,
                serverURL: model.serverURL,
                allFolders: allFolders,
                onSaved: {
                    await onFolderTreeChanged()
                    await loadContents()
                }
            )
        }
        .sheet(item: $shareRequest) { request in
            ShareManagementView(
                resource: request.resource,
                resourceUUID: request.uuid,
                serverURL: model.serverURL
            )
        }
        .confirmationDialog(
            "Delete folder?",
            isPresented: $showingDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let folderToDelete { Task { await deleteFolder(folderToDelete) } }
            }
            Button("Cancel", role: .cancel) { folderToDelete = nil }
        } message: {
            Text("Its documents will be unlinked, and its child folders will be moved to the top level.")
        }
        .alert("Folder update failed", isPresented: Binding(
            get: { managementError != nil },
            set: { if !$0 { managementError = nil } }
        )) {
            Button("OK", role: .cancel) { managementError = nil }
        } message: {
            Text(managementError ?? "")
        }
        .task(id: "\(model.serverURL)-\(folder.uuid)") {
            await loadContentsWhenViewSettles()
        }
        .onChange(of: sortOptions) { _, newOptions in
            FolderSortPreferenceStore.save(
                newOptions,
                serverURL: model.serverURL,
                accountID: model.user?.uuid ?? model.username,
                folderUUID: folder.uuid
            )
            Task { await loadDocuments(reset: true) }
        }
    }

    private func folderRow(_ child: BinderFolder) -> some View {
        HStack(spacing: 8) {
            NavigationLink {
                FolderContentsView(
                    folder: child,
                    model: model,
                    allFolders: $allFolders,
                    onFolderTreeChanged: onFolderTreeChanged
                )
            } label: {
                FolderListRow(folder: child)
            }
            .buttonStyle(.plain)

            FolderActionMenu(
                createSubfolder: { beginCreateFolder(parentUUID: child.uuid) },
                edit: { beginEditFolder(child) },
                share: { shareRequest = ShareManagementRequest(resource: .folders, uuid: child.uuid) },
                delete: { confirmDelete(child) }
            )
        }
        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 8))
    }

    private func beginCreateFolder(parentUUID: String?) {
        folderEditorRequest = FolderManagementRequest(folder: nil, parentUUID: parentUUID)
    }

    private func beginEditFolder(_ folder: BinderFolder) {
        folderEditorRequest = FolderManagementRequest(folder: folder, parentUUID: folder.parentUuid)
    }

    private func confirmDelete(_ folder: BinderFolder) {
        folderToDelete = folder
        showingDeleteConfirmation = true
    }

    @MainActor
    private func deleteFolder(_ folderToRemove: BinderFolder) async {
        folderToDelete = nil
        do {
            try await BinderAPI.shared.deleteFolder(serverURL: model.serverURL, uuid: folderToRemove.uuid)
            await onFolderTreeChanged()
            await loadContents()
        } catch {
            managementError = error.localizedDescription
        }
    }

    @ViewBuilder
    private func documentRows(_ rows: [BinderDocumentSummary]) -> some View {
        ForEach(rows) { document in
            NavigationLink {
                DocumentPDFView(document: document, serverURL: model.serverURL)
            } label: {
                DocumentListRow(document: document, serverURL: model.serverURL)
            }
            .buttonStyle(.plain)
            .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
        }
    }

    @ViewBuilder
    private var loadMoreRow: some View {
        if hasNextPage {
            Button {
                Task { await loadNextPage() }
            } label: {
                HStack {
                    Spacer()
                    if isLoadingMore {
                        ProgressView("Loading more…")
                    } else {
                        Text("Load more documents")
                    }
                    Spacer()
                }
                .frame(minHeight: 44)
            }
            .disabled(isLoadingMore)
        }
    }

    private var documentGroups: [FolderDocumentGroup] {
        var grouped: [String: FolderDocumentGroup] = [:]
        for document in documents {
            let values = groupValues(for: document)
            let groupValues = values.isEmpty ? [(key: "__unassigned", label: "Unassigned")] : values
            for value in groupValues {
                var group = grouped[value.key] ?? FolderDocumentGroup(key: value.key, label: value.label, documents: [])
                group.documents.append(document)
                grouped[value.key] = group
            }
        }
        let direction = sortOptions.groupDirection == .asc ? 1 : -1
        return grouped.values.sorted { left, right in
            let comparison = left.label.localizedStandardCompare(right.label)
            if comparison == .orderedSame { return left.key < right.key }
            return direction > 0
                ? comparison == .orderedAscending
                : comparison == .orderedDescending
        }
    }

    private func groupValues(for document: BinderDocumentSummary) -> [(key: String, label: String)] {
        switch sortOptions.groupBy {
        case .none:
            return []
        case .documentType:
            return document.metadataSummary?.documentType.map { [($0.uuid ?? $0.name, $0.name)] } ?? []
        case .category:
            return document.metadataSummary?.category.map { [($0.uuid ?? $0.name, $0.name)] } ?? []
        case .issuer:
            return document.metadataSummary?.issuer.map { [($0.uuid ?? $0.name, $0.name)] } ?? []
        case .tag:
            return (document.metadataSummary?.tags ?? []).map { ($0.uuid ?? $0.name, $0.name) }
        case .status:
            guard let status = document.status else { return [] }
            return [(status, status.replacingOccurrences(of: "-", with: " ").capitalized)]
        case .isNew:
            guard let isNew = document.isNew else { return [] }
            return [(isNew ? "new" : "reviewed", isNew ? "New" : "Reviewed")]
        }
    }

    @MainActor
    private func loadContentsWhenViewSettles() async {
        do {
            try await Task.sleep(for: .milliseconds(450))
            try Task.checkCancellation()
            await loadContents()
        } catch is CancellationError {
            // The folder view left the navigation stack before loading began.
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }

    @MainActor
    private func loadContents() async {
        guard !isLoading || (subfolders.isEmpty && documents.isEmpty) else { return }
        isLoading = true
        errorMessage = nil
        documentErrorMessage = nil
        defer { isLoading = false }

        do {
            subfolders = try await BinderAPI.shared.folders(
                serverURL: model.serverURL,
                parentUUID: folder.uuid
            )
        } catch {
            errorMessage = error.localizedDescription
        }

        await loadDocuments(reset: true)
    }

    @MainActor
    private func loadDocuments(reset: Bool) async {
        if reset {
            nextPage = 1
            documentErrorMessage = nil
        }
        do {
            let response = try await BinderAPI.shared.documentsInFolder(
                serverURL: model.serverURL,
                folderUUID: folder.uuid,
                page: nextPage,
                sortDirection: sortOptions.direction,
                groupBy: sortOptions.groupBy,
                groupDirection: sortOptions.groupDirection
            )
            if reset { documents = response.items } else { documents.append(contentsOf: response.items) }
            hasNextPage = response.hasNext
            nextPage = response.page + 1
        } catch {
            documentErrorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func loadNextPage() async {
        guard hasNextPage, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        await loadDocuments(reset: false)
    }
}

private struct FolderDocumentGroup: Identifiable {
    let key: String
    let label: String
    var documents: [BinderDocumentSummary]

    var id: String { key }
}

private enum FolderSortPreferenceStore {
    private static let defaults = UserDefaults(suiteName: "group.com.binder.shared") ?? .standard

    static func load(serverURL: String, accountID: String, folderUUID: String) -> BinderFolderSortOptions {
        guard let data = defaults.data(forKey: key(serverURL: serverURL, accountID: accountID, folderUUID: folderUUID)),
              let options = try? JSONDecoder().decode(BinderFolderSortOptions.self, from: data) else {
            return BinderFolderSortOptions()
        }
        return options
    }

    static func save(_ options: BinderFolderSortOptions, serverURL: String, accountID: String, folderUUID: String) {
        guard let data = try? JSONEncoder().encode(options) else { return }
        defaults.set(data, forKey: key(serverURL: serverURL, accountID: accountID, folderUUID: folderUUID))
    }

    private static func key(serverURL: String, accountID: String, folderUUID: String) -> String {
        let scope = "\(serverURL.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())|\(accountID.lowercased())|\(folderUUID)"
        let encoded = Data(scope.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return "binder.folder-sort.v1.\(encoded)"
    }
}

private struct FolderListRow: View {
    let folder: BinderFolder

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: folder.hasChildren ? "folder.fill" : "folder")
                .font(.title3)
                .foregroundStyle(Color.accentColor)
                .frame(width: 30)

            VStack(alignment: .leading, spacing: 3) {
                Text(folder.name)
                    .font(.body.weight(.medium))
                    .foregroundStyle(.primary)
                Text(countDescription)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }

    private var countDescription: String {
        let folderLabel = folder.childCount == 1 ? "folder" : "folders"
        let documentLabel = folder.documentCount == 1 ? "document" : "documents"
        return "\(folder.childCount) \(folderLabel) · \(folder.documentCount) \(documentLabel)"
    }
}

private struct ErrorBanner: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline)
                .foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
            Button("Retry", action: retry)
                .font(.subheadline.weight(.semibold))
                .frame(minHeight: 44)
        }
        .padding(.vertical, 4)
    }
}
