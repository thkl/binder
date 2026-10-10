import SwiftUI

struct BrowseView: View {
    @ObservedObject var model: AuthViewModel

    @State private var folders: [BinderFolder] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && folders.isEmpty {
                    ProgressView("Loading folders…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage, folders.isEmpty {
                    ContentUnavailableView {
                        Label("Couldn’t load folders", systemImage: "folder.badge.questionmark")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("Retry") { Task { await loadFolders() } }
                    }
                } else if folders.isEmpty {
                    ContentUnavailableView(
                        "No folders yet",
                        systemImage: "folder",
                        description: Text("Folders in your Binder library will appear here.")
                    )
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
                            ForEach(folders) { folder in
                                NavigationLink {
                                    FolderContentsView(folder: folder, model: model)
                                } label: {
                                    FolderListRow(folder: folder)
                                }
                                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                    .refreshable { await loadFolders() }
                }
            }
            .navigationTitle("Folders")
            .task { await loadFolders() }
        }
    }

    @MainActor
    private func loadFolders() async {
        guard !isLoading || folders.isEmpty else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            folders = try await BinderAPI.shared.folders(serverURL: model.serverURL)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct FolderContentsView: View {
    let folder: BinderFolder
    @ObservedObject var model: AuthViewModel

    @State private var sortOptions: BinderFolderSortOptions
    @State private var subfolders: [BinderFolder] = []
    @State private var documents: [BinderDocumentSummary] = []
    @State private var nextPage = 1
    @State private var hasNextPage = false
    @State private var isLoading = true
    @State private var isLoadingMore = false
    @State private var errorMessage: String?
    @State private var documentErrorMessage: String?

    init(folder: BinderFolder, model: AuthViewModel) {
        self.folder = folder
        self.model = model
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
                                NavigationLink {
                                    FolderContentsView(folder: child, model: model)
                                } label: {
                                    FolderListRow(folder: child)
                                }
                                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
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
