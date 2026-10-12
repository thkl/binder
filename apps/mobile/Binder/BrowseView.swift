import SwiftUI
import UIKit
import UniformTypeIdentifiers

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
    @State private var intakeMessage: String?

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && allFolders.isEmpty {
                    ProgressView("Loading folders…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        if let errorMessage {
                            Section {
                                ErrorBanner(message: errorMessage) {
                                    Task { await loadFolders() }
                                }
                            }
                        }

                        Section("Documents") {
                            collectionRow("All Documents", symbol: "doc.on.doc", kind: .all)
                            collectionRow("Docs without folders", symbol: "tray", kind: .unassigned)
                            collectionRow("New Docs", symbol: "sparkle", kind: .new)
                        }

                        if rootFolders.isEmpty {
                            Section("Folders") {
                                ContentUnavailableView(
                                    "No folders yet",
                                    systemImage: "folder",
                                    description: Text("Create a folder to organize your documents.")
                                )
                                .listRowBackground(Color.clear)
                            }
                        } else {
                            Section("Folders") {
                                ForEach(rootFolders) { folder in folderRow(folder) }
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                    .refreshable { await loadFolders() }
                }
            }
            .navigationTitle("Folders")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    DocumentAddMenu(
                        onScan: handleScannedDocument,
                        onFiles: handleSelectedDocuments,
                        onCreateFolder: { beginCreateFolder(parentUUID: nil) },
                        onError: { intakeMessage = $0 }
                    )
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
            .alert("Document upload", isPresented: Binding(
                get: { intakeMessage != nil },
                set: { if !$0 { intakeMessage = nil } }
            )) {
                Button("OK", role: .cancel) { intakeMessage = nil }
            } message: {
                Text(intakeMessage ?? "")
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

    private func collectionRow(
        _ title: String,
        symbol: String,
        kind: BrowseDocumentCollectionKind
    ) -> some View {
        NavigationLink {
            BrowseDocumentListView(title: title, kind: kind, model: model)
        } label: {
            Label(title, systemImage: symbol)
        }
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
    private func handleScannedDocument(_ pages: [UIImage]) {
        do {
            _ = try ScannedDocumentQueue.enqueue(pages: pages)
            Task { await uploadQueuedDocuments() }
        } catch {
            intakeMessage = error.localizedDescription
        }
    }

    @MainActor
    private func handleSelectedDocuments(_ files: [URL]) {
        do {
            try DocumentIntakeQueue.enqueue(files: files)
            Task { await uploadQueuedDocuments() }
        } catch {
            intakeMessage = error.localizedDescription
        }
    }

    @MainActor
    private func uploadQueuedDocuments() async {
        let report = await DocumentUploadQueue.uploadPending(serverURL: model.serverURL)
        intakeMessage = report.summary
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

private enum BrowseDocumentCollectionKind: Equatable {
    case all
    case unassigned
    case new
}

private struct BrowseDocumentListView: View {
    let title: String
    let kind: BrowseDocumentCollectionKind
    @ObservedObject var model: AuthViewModel

    @State private var documents: [BinderDocumentSummary] = []
    @State private var page = 1
    @State private var hasNextPage = false
    @State private var isLoading = true
    @State private var isLoadingMore = false
    @State private var errorMessage: String?
    @State private var intakeMessage: String?

    var body: some View {
        Group {
            if isLoading && documents.isEmpty {
                ProgressView("Loading documents…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage, documents.isEmpty {
                ContentUnavailableView {
                    Label("Couldn’t load documents", systemImage: "doc.badge.questionmark")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Retry") { Task { await load(reset: true) } }
                }
            } else {
                List {
                    if let errorMessage {
                        Section {
                            ErrorBanner(message: errorMessage) {
                                Task { await load(reset: true) }
                            }
                        }
                    }

                    if documents.isEmpty {
                        ContentUnavailableView(
                            emptyTitle,
                            systemImage: emptySymbol,
                            description: Text(emptyDescription)
                        )
                        .listRowBackground(Color.clear)
                    } else {
                        ForEach(documents) { document in
                            NavigationLink {
                                DocumentView(
                                    document: document,
                                    serverURL: model.serverURL,
                                    onDocumentDeleted: { deletedUUID in
                                        documents.removeAll { $0.uuid == deletedUUID }
                                    },
                                    onDocumentOpened: { openedUUID, isNew in
                                        if let index = documents.firstIndex(where: { $0.uuid == openedUUID }) {
                                            documents[index].isNew = isNew
                                        }
                                        if kind == .new && !isNew {
                                            documents.removeAll { $0.uuid == openedUUID }
                                        }
                                    }
                                )
                            } label: {
                                DocumentListRow(document: document, serverURL: model.serverURL)
                            }
                            .buttonStyle(.plain)
                            .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
                        }
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
                }
                .listStyle(.insetGrouped)
                .refreshable { await load(reset: true) }
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if kind == .new {
                ToolbarItem(placement: .topBarTrailing) {
                    DocumentAddMenu(
                        onScan: handleScannedDocument,
                        onFiles: handleSelectedDocuments,
                        onError: { intakeMessage = $0 }
                    )
                }
            }
        }
        .alert("Document upload", isPresented: Binding(
            get: { intakeMessage != nil },
            set: { if !$0 { intakeMessage = nil } }
        )) {
            Button("OK", role: .cancel) { intakeMessage = nil }
        } message: {
            Text(intakeMessage ?? "")
        }
        .task { await load(reset: true) }
    }

    private var emptyTitle: String {
        switch kind {
        case .all: "No documents yet"
        case .unassigned: "No unfiled documents"
        case .new: "No new documents"
        }
    }

    private var emptySymbol: String {
        switch kind {
        case .all: "doc.on.doc"
        case .unassigned: "tray"
        case .new: "sparkle"
        }
    }

    private var emptyDescription: String {
        switch kind {
        case .all: "Your documents will appear here."
        case .unassigned: "Every document is assigned to at least one folder."
        case .new: "There are no documents awaiting review."
        }
    }

    @MainActor
    private func handleScannedDocument(_ pages: [UIImage]) {
        do {
            _ = try ScannedDocumentQueue.enqueue(pages: pages)
            Task { await uploadQueuedDocuments() }
        } catch {
            intakeMessage = error.localizedDescription
        }
    }

    @MainActor
    private func handleSelectedDocuments(_ files: [URL]) {
        do {
            try DocumentIntakeQueue.enqueue(files: files)
            Task { await uploadQueuedDocuments() }
        } catch {
            intakeMessage = error.localizedDescription
        }
    }

    @MainActor
    private func uploadQueuedDocuments() async {
        let report = await DocumentUploadQueue.uploadPending(serverURL: model.serverURL)
        intakeMessage = report.summary
        if kind == .new && report.uploadedCount > 0 { await load(reset: true) }
    }

    @MainActor
    private func load(reset: Bool) async {
        guard !isLoading || documents.isEmpty else { return }
        isLoading = true
        defer { isLoading = false }
        errorMessage = nil
        if reset { page = 1 }

        do {
            let response = try await BinderAPI.shared.browseDocuments(
                serverURL: model.serverURL,
                unassigned: kind == .unassigned,
                newOnly: kind == .new,
                page: page
            )
            if reset { documents = response.items } else { documents.append(contentsOf: response.items) }
            hasNextPage = response.hasNext
            page = response.page + 1
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func loadNextPage() async {
        guard hasNextPage, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        await load(reset: false)
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
    @State private var intakeMessage: String?
    @State private var compositionTarget: BinderDocumentSummary?
    @State private var compositionSources: [BinderDocumentSummary] = []
    @State private var composeRequest: FolderComposeRequest?
    @AppStorage("binder.compose-selection-help.dismissed") private var hasDismissedComposeHelp = false

    private var isSelectingComposeSources: Bool { compositionTarget != nil }

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
                    if isSelectingComposeSources {
                        if !hasDismissedComposeHelp {
                            Section {
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: "hand.tap")
                                        .foregroundStyle(.tint)
                                    Text("Tap a checkmark to add a PDF. Tap its title to open the document. Select Done when you’re ready to choose pages and order.")
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                    Button {
                                        hasDismissedComposeHelp = true
                                    } label: {
                                        Image(systemName: "xmark")
                                            .font(.caption.weight(.semibold))
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel("Dismiss combine instructions")
                                }
                                .padding(.vertical, 4)
                            }
                        }

                        if let compositionTarget {
                            Section("Target document") {
                                HStack(spacing: 12) {
                                    DocumentListRow(document: compositionTarget, serverURL: model.serverURL)
                                    Spacer(minLength: 8)
                                    Label("Target", systemImage: "arrow.down.to.line")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.tint)
                                }
                                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                            }
                        }
                    }

                    if let errorMessage {
                        Section {
                            ErrorBanner(message: errorMessage) {
                                Task { await loadContents() }
                            }
                        }
                    }

                    if !isSelectingComposeSources && !subfolders.isEmpty {
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
                    } else if documentsForCurrentMode.isEmpty && !isLoading {
                        Section("Documents") {
                            ContentUnavailableView(
                                isSelectingComposeSources ? "No other documents in this folder" : "No documents in this folder",
                                systemImage: "doc.text",
                                description: Text(isSelectingComposeSources
                                    ? "Choose another PDF from this folder to add it to the composition."
                                    : "Documents assigned directly to this folder will appear here.")
                            )
                            .listRowBackground(Color.clear)
                        }
                    } else if !documentsForCurrentMode.isEmpty {
                        if sortOptions.groupBy == .none {
                            Section("Documents") {
                                documentRows(documentsForCurrentMode)
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
            if isSelectingComposeSources {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { cancelComposeSelection() }
                }
                ToolbarItem(placement: .principal) {
                    Text("Select PDFs")
                        .font(.headline)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { finishComposeSelection() }
                        .fontWeight(.semibold)
                        .disabled(compositionSources.isEmpty)
                }
            } else {
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 12) {
                        DocumentAddMenu(
                            onScan: handleScannedDocument,
                            onFiles: handleSelectedDocuments,
                            onCreateFolder: { beginCreateFolder(parentUUID: folder.uuid) },
                            onError: { intakeMessage = $0 }
                        )

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
        .sheet(item: $composeRequest) { request in
            DocumentComposeView(
                targetDocument: request.target,
                serverURL: model.serverURL,
                initialSources: request.sources
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
        .alert("Document upload", isPresented: Binding(
            get: { intakeMessage != nil },
            set: { if !$0 { intakeMessage = nil } }
        )) {
            Button("OK", role: .cancel) { intakeMessage = nil }
        } message: {
            Text(intakeMessage ?? "")
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
    private func handleScannedDocument(_ pages: [UIImage]) {
        do {
            _ = try ScannedDocumentQueue.enqueue(pages: pages)
            Task { await uploadQueuedDocuments() }
        } catch {
            intakeMessage = error.localizedDescription
        }
    }

    @MainActor
    private func handleSelectedDocuments(_ files: [URL]) {
        do {
            try DocumentIntakeQueue.enqueue(files: files)
            Task { await uploadQueuedDocuments() }
        } catch {
            intakeMessage = error.localizedDescription
        }
    }

    @MainActor
    private func uploadQueuedDocuments() async {
        let report = await DocumentUploadQueue.uploadPending(serverURL: model.serverURL)
        intakeMessage = report.summary
        if report.uploadedCount > 0 { await loadDocuments(reset: true) }
    }

    private var documentsForCurrentMode: [BinderDocumentSummary] {
        guard let compositionTarget else { return documents }
        return documents.filter { $0.uuid != compositionTarget.uuid }
    }

    private func beginComposeSelection(for document: BinderDocumentSummary) {
        compositionTarget = document
        compositionSources = []
    }

    private func cancelComposeSelection() {
        compositionTarget = nil
        compositionSources = []
    }

    private func toggleComposeSource(_ document: BinderDocumentSummary) {
        guard isSelectableComposeSource(document) else { return }
        if let index = compositionSources.firstIndex(where: { $0.uuid == document.uuid }) {
            compositionSources.remove(at: index)
        } else {
            compositionSources.append(document)
        }
    }

    private func isComposeSourceSelected(_ document: BinderDocumentSummary) -> Bool {
        compositionSources.contains { $0.uuid == document.uuid }
    }

    private func isSelectableComposeSource(_ document: BinderDocumentSummary) -> Bool {
        let isPDF = document.mimeType == nil || document.mimeType == "application/pdf"
        let isReady = !["uploaded", "scanning", "quarantined"].contains(document.status ?? "")
        return isPDF && isReady && document.uuid != compositionTarget?.uuid
    }

    private func finishComposeSelection() {
        guard let compositionTarget, !compositionSources.isEmpty else { return }
        composeRequest = FolderComposeRequest(target: compositionTarget, sources: compositionSources)
        cancelComposeSelection()
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
            HStack(spacing: 12) {
                NavigationLink {
                    DocumentView(
                        document: document,
                        serverURL: model.serverURL,
                        onDocumentDeleted: { deletedUUID in
                            documents.removeAll { $0.uuid == deletedUUID }
                        },
                        onDocumentOpened: { openedUUID, isNew in
                            if let index = documents.firstIndex(where: { $0.uuid == openedUUID }) {
                                documents[index].isNew = isNew
                            }
                        },
                        onComposeRequested: beginComposeSelection,
                        isCombineModeActive: isSelectingComposeSources
                    )
                } label: {
                    DocumentListRow(document: document, serverURL: model.serverURL)
                }
                .buttonStyle(.plain)

                if isSelectingComposeSources {
                    Button {
                        toggleComposeSource(document)
                    } label: {
                        Image(systemName: isComposeSourceSelected(document) ? "checkmark.circle.fill" : "circle")
                            .font(.title3)
                            .foregroundStyle(isComposeSourceSelected(document) ? Color.accentColor : Color.secondary)
                            .frame(width: 36, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!isSelectableComposeSource(document))
                    .accessibilityLabel(isComposeSourceSelected(document) ? "Remove from composition" : "Add to composition")
                }
            }
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
        for document in documentsForCurrentMode {
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

private struct FolderComposeRequest: Identifiable {
    let id = UUID()
    let target: BinderDocumentSummary
    let sources: [BinderDocumentSummary]
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

struct DocumentAddMenu: View {
    let onScan: ([UIImage]) -> Void
    let onFiles: ([URL]) -> Void
    var onCreateFolder: (() -> Void)? = nil
    let onError: (String) -> Void

    @State private var isShowingScanner = false
    @State private var isShowingDocumentPicker = false

    var body: some View {
        Menu {
            Button {
                guard DocumentScanner.isSupported else {
                    onError("Document scanning is not available on this device.")
                    return
                }
                isShowingScanner = true
            } label: {
                Label("Scan document", systemImage: "doc.viewfinder")
            }

            Button {
                isShowingDocumentPicker = true
            } label: {
                Label("Add from Files", systemImage: "doc.badge.plus")
            }

            if let onCreateFolder {
                Button(action: onCreateFolder) {
                    Label("New folder", systemImage: "folder.badge.plus")
                }
                .accessibilityIdentifier("create-folder")
            }
        } label: {
            Image(systemName: "plus")
        }
        .accessibilityLabel(onCreateFolder == nil ? "Add document" : "Add document or folder")
        .sheet(isPresented: $isShowingScanner) {
            DocumentScanner(
                isPresented: $isShowingScanner,
                onScan: onScan,
                onError: onError
            )
            .ignoresSafeArea()
        }
        .fileImporter(
            isPresented: $isShowingDocumentPicker,
            allowedContentTypes: [.pdf, .jpeg, .png],
            allowsMultipleSelection: true
        ) { result in
            switch result {
            case .success(let files): onFiles(files)
            case .failure(let error): onError(error.localizedDescription)
            }
        }
    }
}

@MainActor
private enum DocumentIntakeQueue {
    static func enqueue(files: [URL]) throws {
        for file in files {
            let hasSecurityScopedAccess = file.startAccessingSecurityScopedResource()
            defer {
                if hasSecurityScopedAccess {
                    file.stopAccessingSecurityScopedResource()
                }
            }
            _ = try SharedPDFQueue.enqueue(from: file, filename: file.lastPathComponent)
        }
    }

}
