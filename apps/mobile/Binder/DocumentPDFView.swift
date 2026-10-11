import SwiftUI
import UIKit
import PDFKit
import ImageIO

struct DocumentPDFView: View {
    @State private var document: BinderDocumentSummary
    let serverURL: String
    private let onCurrentVersionDeleted: (BinderDocumentSummary) -> Void
    private let onDocumentDeleted: (String) -> Void
    private let onComposeRequested: ((BinderDocumentSummary) -> Void)?
    private let isCombineModeActive: Bool
    @Environment(\.dismiss) private var dismiss

    @State private var loadedPDF: PreparedPDFDocument?
    @State private var loadedImage: UIImage?
    @State private var pdfFileURL: URL?
    @State private var isLoading = true
    @State private var isWaitingForMalwareScan = false
    @State private var isRequeuing = false
    @State private var hasRequeued = false
    @State private var isDeleting = false
    @State private var showingDeleteConfirmation = false
    @State private var errorMessage: String?
    @State private var activeSheet: DocumentPDFSheet?
    @State private var actionAlert: DocumentPDFAlert?

    init(
        document: BinderDocumentSummary,
        serverURL: String,
        onCurrentVersionDeleted: @escaping (BinderDocumentSummary) -> Void = { _ in },
        onDocumentDeleted: @escaping (String) -> Void = { _ in },
        onComposeRequested: ((BinderDocumentSummary) -> Void)? = nil,
        isCombineModeActive: Bool = false
    ) {
        _document = State(initialValue: document)
        self.serverURL = serverURL
        self.onCurrentVersionDeleted = onCurrentVersionDeleted
        self.onDocumentDeleted = onDocumentDeleted
        self.onComposeRequested = onComposeRequested
        self.isCombineModeActive = isCombineModeActive
    }

    private var filename: String {
        let original = document.originalFilename.trimmingCharacters(in: .whitespacesAndNewlines)
        if !original.isEmpty { return original }
        return isImageDocument ? "document.jpg" : "document.pdf"
    }

    private var displayTitle: String {
        let title = document.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return title.isEmpty ? filename : title
    }

    private var canSplitDocument: Bool {
        guard isPDFDocument else { return false }
        guard (document.pageCount ?? 0) > 1 else { return false }
        return !["uploaded", "scanning", "quarantined"].contains(document.status ?? "")
    }

    private var canComposeDocument: Bool {
        guard isPDFDocument else { return false }
        return (document.pageCount ?? 0) > 0 &&
            !["uploaded", "scanning", "quarantined"].contains(document.status ?? "")
    }

    private var canRotateDocument: Bool {
        guard isPDFDocument else { return false }
        return (document.pageCount ?? 0) > 0 &&
            !["uploaded", "scanning", "quarantined"].contains(document.status ?? "")
    }

    private var canRequeueDocument: Bool {
        !hasRequeued && ["failed", "ready", "quarantined"].contains(document.status ?? "")
    }

    private var isPDFDocument: Bool {
        document.mimeType == nil || document.mimeType == "application/pdf"
    }

    private var isImageDocument: Bool {
        document.mimeType?.hasPrefix("image/") == true
    }

    var body: some View {
        Group {
            if let loadedPDF {
                PDFDocumentView(document: loadedPDF.document)
                    .background(Color(uiColor: .secondarySystemBackground))
            } else if let loadedImage {
                Image(uiImage: loadedImage)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(uiColor: .secondarySystemBackground))
            } else if isLoading {
                ProgressView(isWaitingForMalwareScan ? "Waiting for malware scan…" : "Loading document…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(spacing: 12) {
                    ContentUnavailableView(
                        isImageDocument ? "Couldn’t load image" : "Couldn’t load PDF",
                        systemImage: "doc.questionmark",
                        description: Text(errorMessage ?? "Check your connection and try again.")
                    )
                    Button("Retry") {
                        Task { await loadPDFWhenViewIsReady() }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        }
        .navigationTitle(displayTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        if let pdfFileURL { activeSheet = .share(pdfFileURL) }
                    } label: {
                        Label(isImageDocument ? "Share image" : "Share PDF", systemImage: "square.and.arrow.up")
                    }
                    .disabled(pdfFileURL == nil || isCombineModeActive)
                    .accessibilityIdentifier("share-document-pdf")

                    Button {
                        activeSheet = .metadata(document)
                    } label: {
                        Label("Metadata", systemImage: "info.circle")
                    }
                    .accessibilityIdentifier("show-document-metadata")

                    Button {
                        activeSheet = .sharing(document.uuid)
                    } label: {
                        Label("Share access", systemImage: "person.2")
                    }
                    .disabled(isCombineModeActive)
                    .accessibilityIdentifier("manage-document-sharing")

                    if canRequeueDocument || canSplitDocument || canComposeDocument || canRotateDocument {
                        Divider()
                    }

                    if canRequeueDocument {
                        Button {
                            Task { await requeueDocument() }
                        } label: {
                            Label(isRequeuing ? "Requeueing…" : "Requeue", systemImage: "arrow.clockwise")
                        }
                        .disabled(isRequeuing || isCombineModeActive)
                    }
                    if canRotateDocument {
                        Button {
                            activeSheet = .rotate(document)
                        } label: {
                            Label("Rotate a page", systemImage: "rotate.right")
                        }
                        .disabled(isCombineModeActive)
                    }
                    if canSplitDocument {
                        Button {
                            activeSheet = .split(document)
                        } label: {
                            Label("Split PDF", systemImage: "scissors")
                        }
                        .disabled(isCombineModeActive)
                    }
                    if canComposeDocument {
                        Button {
                            if let onComposeRequested {
                                let target = document
                                dismiss()
                                Task { @MainActor in
                                    try? await Task.sleep(for: .milliseconds(350))
                                    onComposeRequested(target)
                                }
                            } else {
                                activeSheet = .compose(document)
                            }
                        } label: {
                            Label(
                                onComposeRequested == nil ? "Combine with another PDF" : "Select PDFs to combine",
                                systemImage: "doc.on.doc"
                            )
                        }
                        .disabled(isCombineModeActive)
                    }

                    Divider()
                    Button(role: .destructive) {
                        showingDeleteConfirmation = true
                    } label: {
                        Label("Delete document", systemImage: "trash")
                    }
                    .disabled(isDeleting || isCombineModeActive)
                } label: {
                    Label("Document actions", systemImage: "ellipsis.circle")
                }
                .accessibilityIdentifier("document-actions")
            }
        }
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .share(let fileURL):
                PDFShareSheet(fileURL: fileURL)
            case .metadata(let document):
                DocumentMetadataSheet(
                    document: document,
                    serverURL: serverURL,
                    onCurrentVersionChanged: { currentDocument in
                        self.document = currentDocument
                        onCurrentVersionDeleted(currentDocument)
                    }
                )
            case .sharing(let documentUUID):
                ShareManagementView(
                    resource: .documents,
                    resourceUUID: documentUUID,
                    serverURL: serverURL
                )
            case .split(let document):
                DocumentSplitView(document: document, serverURL: serverURL)
            case .compose(let document):
                DocumentComposeView(targetDocument: document, serverURL: serverURL)
            case .rotate(let document):
                DocumentRotateView(document: document, serverURL: serverURL)
            }
        }
        .alert(item: $actionAlert) { alert in
            Alert(
                title: Text(alert.title),
                message: Text(alert.message),
                dismissButton: .default(Text("OK"))
            )
        }
        .confirmationDialog(
            "Delete document?",
            isPresented: $showingDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                Task { await deleteDocument() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This permanently deletes the document. If it has versions, only this version is deleted and the remaining version history is kept.")
        }
        .task(id: "\(serverURL)-\(document.uuid)") {
            await loadPDFWhenViewIsReady()
        }
    }

    @MainActor
    private func loadPDFWhenViewIsReady() async {
        isLoading = true
        isWaitingForMalwareScan = false
        errorMessage = nil
        loadedPDF = nil
        loadedImage = nil
        if let pdfFileURL {
            try? FileManager.default.removeItem(at: pdfFileURL.deletingLastPathComponent())
        }
        pdfFileURL = nil
        defer { isLoading = false }
        do {
            // Let the navigation push finish before starting network and PDF work.
            try await Task.sleep(for: .milliseconds(450))
            let data: Data
            while true {
                try Task.checkCancellation()
                let latestDocument = try await BinderAPI.shared.documentSummary(
                    serverURL: serverURL,
                    documentUUID: document.uuid
                )
                if latestDocument.status == "quarantined" {
                    throw BinderAPIError.server("This document was quarantined and cannot be opened.")
                }

                if ["uploaded", "scanning"].contains(latestDocument.status ?? "") {
                    isWaitingForMalwareScan = true
                    try await Task.sleep(for: .seconds(2))
                    continue
                }

                isWaitingForMalwareScan = false
                do {
                    data = try await BinderAPI.shared.documentFile(
                        serverURL: serverURL,
                        documentUUID: document.uuid
                    )
                    break
                } catch BinderAPIError.server("The document is waiting for malware scanning") {
                    // The scan may start between the status refresh and the file request.
                    isWaitingForMalwareScan = true
                    try await Task.sleep(for: .seconds(2))
                }
            }
            let safeFilename = URL(fileURLWithPath: filename).lastPathComponent
            let localURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("Binder-\(UUID().uuidString)", isDirectory: true)
                .appendingPathComponent(safeFilename)
            try FileManager.default.createDirectory(
                at: localURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try data.write(to: localURL, options: .atomic)
            if isImageDocument {
                let imageData = await Task.detached(priority: .userInitiated) {
                    Self.previewImageData(at: localURL)
                }.value
                guard let imageData, let image = UIImage(data: imageData) else {
                    try? FileManager.default.removeItem(at: localURL.deletingLastPathComponent())
                    throw BinderPDFError.unreadableDocument
                }
                if Task.isCancelled {
                    try? FileManager.default.removeItem(at: localURL.deletingLastPathComponent())
                    return
                }
                loadedImage = image
                pdfFileURL = localURL
                return
            }
            let preparedPDF = try await Task.detached(priority: .userInitiated) {
                guard let pdfDocument = PDFDocument(url: localURL) else {
                    try? FileManager.default.removeItem(at: localURL.deletingLastPathComponent())
                    throw BinderPDFError.unreadableDocument
                }
                return PreparedPDFDocument(document: pdfDocument, fileURL: localURL)
            }.value
            if Task.isCancelled {
                try? FileManager.default.removeItem(at: preparedPDF.fileURL.deletingLastPathComponent())
                return
            }
            loadedPDF = preparedPDF
            pdfFileURL = preparedPDF.fileURL
        } catch {
            if error is CancellationError { return }
            isWaitingForMalwareScan = false
            if loadedPDF == nil && loadedImage == nil {
                errorMessage = error.localizedDescription
            } else {
                actionAlert = DocumentPDFAlert(title: "Couldn’t share document", message: error.localizedDescription)
            }
        }
    }

    nonisolated private static func previewImageData(at url: URL) -> Data? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(
                source,
                0,
                [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceThumbnailMaxPixelSize: 2400,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                ] as CFDictionary
              ) else { return nil }
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil) else {
            return nil
        }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return data as Data
    }

    @MainActor
    private func requeueDocument() async {
        guard !isRequeuing else { return }
        isRequeuing = true
        defer { isRequeuing = false }
        do {
            _ = try await BinderAPI.shared.requeueDocument(
                serverURL: serverURL,
                documentUUID: document.uuid
            )
            hasRequeued = true
            actionAlert = DocumentPDFAlert(
                title: "Processing queued",
                message: "The document has been queued for processing again."
            )
        } catch {
            actionAlert = DocumentPDFAlert(title: "Couldn’t requeue document", message: error.localizedDescription)
        }
    }

    @MainActor
    private func deleteDocument() async {
        guard !isDeleting else { return }
        isDeleting = true
        defer { isDeleting = false }
        do {
            if let newCurrentVersion = try await BinderAPI.shared.deleteDocumentOrVersion(
                serverURL: serverURL,
                documentUUID: document.uuid
            ) {
                onCurrentVersionDeleted(newCurrentVersion)
            }
            onDocumentDeleted(document.uuid)
            dismiss()
        } catch {
            actionAlert = DocumentPDFAlert(
                title: "Couldn’t delete document",
                message: error.localizedDescription
            )
        }
    }
}

private struct DocumentPDFAlert: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

private enum DocumentPDFSheet: Identifiable {
    case share(URL)
    case metadata(BinderDocumentSummary)
    case sharing(String)
    case split(BinderDocumentSummary)
    case compose(BinderDocumentSummary)
    case rotate(BinderDocumentSummary)

    var id: String {
        switch self {
        case .share(let url): "share-\(url.absoluteString)"
        case .metadata(let document): "metadata-\(document.uuid)"
        case .sharing(let uuid): "sharing-\(uuid)"
        case .split(let document): "split-\(document.uuid)"
        case .compose(let document): "compose-\(document.uuid)"
        case .rotate(let document): "rotate-\(document.uuid)"
        }
    }
}

private struct DocumentMetadataSheet: View {
    @State private var document: BinderDocumentSummary
    @State private var folders: [BinderFolder] = []
    @State private var versions: [BinderDocumentSummary] = []
    @State private var isLoadingFolders = true
    @State private var isLoadingMetadata = true
    @State private var isLoadingVersions = true
    @State private var folderError: String?
    @State private var metadataError: String?
    @State private var versionError: String?
    @State private var versionToDelete: BinderDocumentSummary?
    @State private var confirmVersionDelete = false
    @State private var versionDeleteError: String?
    @State private var isDeletingVersion = false
    @State private var navigationPath: [DocumentMetadataRoute] = []
    let serverURL: String
    let onCurrentVersionChanged: (BinderDocumentSummary) -> Void
    @Environment(\.dismiss) private var dismiss

    init(
        document: BinderDocumentSummary,
        serverURL: String,
        onCurrentVersionChanged: @escaping (BinderDocumentSummary) -> Void
    ) {
        _document = State(initialValue: document)
        self.serverURL = serverURL
        self.onCurrentVersionChanged = onCurrentVersionChanged
    }

    private var metadataRows: [(label: String, value: String)] {
        guard let metadata = document.metadataSummary else { return [] }
        var rows: [(String, String)] = []
        if let value = metadata.documentType?.name { rows.append(("Document type", value)) }
        if let value = metadata.category?.name { rows.append(("Category", value)) }
        if let value = metadata.issuer?.name { rows.append(("Issuer", value)) }
        if let tags = metadata.tags, !tags.isEmpty {
            rows.append(("Tags", tags.map(\.name).joined(separator: ", ")))
        }
        rows.append(contentsOf: (metadata.custom ?? []).map { ($0.label, $0.value.displayText) })
        return rows
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            List {
                Section("Document") {
                    LabeledContent("Title", value: document.title?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
                                   ? document.title ?? document.originalFilename
                                   : document.originalFilename)
                    LabeledContent("Filename", value: document.originalFilename)
                    if let pageCount = document.pageCount {
                        LabeledContent("Pages", value: String(pageCount))
                    }
                }

                Section("Version history") {
                    if isLoadingVersions {
                        ProgressView("Loading versions…")
                    } else if let versionError {
                        VStack(alignment: .leading, spacing: 8) {
                            Label(versionError, systemImage: "exclamationmark.triangle")
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                            Button("Retry") { Task { await loadVersionHistory() } }
                                .frame(minHeight: 44)
                        }
                    } else if sortedVersions.isEmpty {
                        Text("No version history available")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(sortedVersions) { version in
                            let isCurrent = version.versionParentUuid == nil
                            if version.uuid == document.uuid {
                                DocumentVersionRow(version: version, isCurrent: isCurrent)
                                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                        versionDeleteAction(version)
                                    }
                            } else {
                                NavigationLink(value: DocumentMetadataRoute.version(version.uuid)) {
                                    DocumentVersionRow(version: version, isCurrent: isCurrent)
                                }
                                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                    versionDeleteAction(version)
                                }
                            }
                        }
                        if sortedVersions.count == 1 {
                            Text("No previous versions")
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Section("Metadata") {
                    if isLoadingMetadata {
                        ProgressView("Refreshing metadata…")
                    } else if metadataRows.isEmpty {
                        Text("No metadata assigned")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(Array(metadataRows.enumerated()), id: \.offset) { item in
                            let row = item.element
                            LabeledContent(row.label, value: row.value)
                        }
                    }
                    if let metadataError {
                        Label(metadataError, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        Button("Retry") { Task { await loadDocumentInfo() } }
                    }
                }

                Section("Folders") {
                    if isLoadingFolders {
                        ProgressView("Loading folders…")
                    } else if let folderError {
                        VStack(alignment: .leading, spacing: 8) {
                            Label(folderError, systemImage: "exclamationmark.triangle")
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                            Button("Retry") { Task { await loadDocumentInfo() } }
                                .frame(minHeight: 44)
                        }
                    } else if sortedFolders.isEmpty {
                        Text("No folders assigned")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(sortedFolders) { folder in
                            Text(folder.path(in: folders))
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Document info")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: DocumentMetadataRoute.self) { route in
                switch route {
                case .edit:
                    DocumentMetadataEditorView(document: document, serverURL: serverURL) { updatedDocument, updatedFolders in
                        document = updatedDocument
                        folders = updatedFolders
                        isLoadingFolders = false
                        isLoadingMetadata = false
                        folderError = nil
                        metadataError = nil
                        Task { await loadDocumentInfo() }
                    }
                case .version(let uuid):
                    if let version = versions.first(where: { $0.uuid == uuid }) {
                        DocumentPDFView(
                            document: version,
                            serverURL: serverURL,
                            onCurrentVersionDeleted: { currentDocument in
                                document = currentDocument
                                onCurrentVersionChanged(currentDocument)
                            }
                        )
                    } else {
                        ContentUnavailableView("Version unavailable", systemImage: "doc.questionmark")
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink(value: DocumentMetadataRoute.edit) {
                        Text("Edit")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents(navigationPath.isEmpty ? [.medium, .large] : [.large])
        .presentationDragIndicator(navigationPath.isEmpty ? .visible : .hidden)
        .task { await loadDocumentInfo() }
        .confirmationDialog(
            "Delete this version?",
            isPresented: $confirmVersionDelete,
            titleVisibility: .visible
        ) {
            Button("Delete version", role: .destructive) {
                Task { await deleteVersion() }
            }
            Button("Cancel", role: .cancel) { versionToDelete = nil }
        } message: {
            Text("This permanently deletes the PDF version. If it is current, the previous version becomes current.")
        }
        .alert(
            "Couldn’t delete version",
            isPresented: Binding(
                get: { versionDeleteError != nil },
                set: { if !$0 { versionDeleteError = nil } }
            )
        ) {
            Button("OK", role: .cancel) { versionDeleteError = nil }
        } message: {
            Text(versionDeleteError ?? "")
        }
    }

    private var sortedFolders: [BinderFolder] {
        folders.sorted {
            $0.path(in: folders).localizedStandardCompare($1.path(in: folders)) == .orderedAscending
        }
    }

    private var sortedVersions: [BinderDocumentSummary] {
        versions.sorted { ($0.versionNumber ?? 0) > ($1.versionNumber ?? 0) }
    }

    @ViewBuilder
    private func versionDeleteAction(_ version: BinderDocumentSummary) -> some View {
        if sortedVersions.count > 1 {
            Button(role: .destructive) {
                versionToDelete = version
                confirmVersionDelete = true
            } label: {
                Label("Delete version", systemImage: "trash")
            }
            .disabled(isDeletingVersion)
        }
    }

    @MainActor
    private func loadDocumentInfo() async {
        isLoadingFolders = true
        isLoadingMetadata = true
        folderError = nil
        metadataError = nil

        async let documentRequest = BinderAPI.shared.documentSummary(
            serverURL: serverURL,
            documentUUID: document.uuid
        )
        async let foldersRequest = BinderAPI.shared.foldersForDocument(
            serverURL: serverURL,
            documentUUID: document.uuid
        )
        async let versionsRequest = BinderAPI.shared.documentVersions(
            serverURL: serverURL,
            documentUUID: document.uuid
        )

        do {
            document = try await documentRequest
        } catch {
            metadataError = error.localizedDescription
        }
        isLoadingMetadata = false

        do {
            folders = try await foldersRequest
        } catch {
            folderError = error.localizedDescription
        }
        isLoadingFolders = false

        do {
            versions = try await versionsRequest
            versionError = nil
        } catch {
            versionError = error.localizedDescription
        }
        isLoadingVersions = false
    }

    @MainActor
    private func loadVersionHistory() async {
        isLoadingVersions = true
        versionError = nil
        defer { isLoadingVersions = false }
        do {
            versions = try await BinderAPI.shared.documentVersions(
                serverURL: serverURL,
                documentUUID: document.uuid
            )
            versionError = nil
        } catch {
            versionError = error.localizedDescription
        }
    }

    @MainActor
    private func deleteVersion() async {
        guard let version = versionToDelete, !isDeletingVersion else { return }
        isDeletingVersion = true
        defer {
            isDeletingVersion = false
            versionToDelete = nil
        }
        do {
            let currentDocument = try await BinderAPI.shared.deleteDocumentVersion(
                serverURL: serverURL,
                documentUUID: version.uuid
            )
            if version.uuid == document.uuid || version.versionParentUuid == nil {
                document = currentDocument
                navigationPath = []
                onCurrentVersionChanged(currentDocument)
            }
            await loadVersionHistory()
        } catch {
            versionDeleteError = error.localizedDescription
        }
    }
}

private enum DocumentMetadataRoute: Hashable {
    case edit
    case version(String)
}

private struct DocumentVersionRow: View {
    let version: BinderDocumentSummary
    let isCurrent: Bool

    private var title: String {
        let candidate = version.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return candidate.isEmpty ? version.originalFilename : candidate
    }

    private var createdDate: String? {
        guard let createdAt = version.createdAt else { return nil }
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = fractionalFormatter.date(from: createdAt)
            ?? ISO8601DateFormatter().date(from: createdAt)
        return date?.formatted(date: .abbreviated, time: .shortened)
    }

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Version \(version.versionNumber ?? 1)")
                    .font(.headline)
                Text(title)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                HStack(spacing: 8) {
                    if let createdDate {
                        Text(createdDate)
                    }
                    if let pageCount = version.pageCount {
                        Text("\(pageCount) pages")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            if isCurrent {
                Label("Current", systemImage: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(.tint)
                    .labelStyle(.titleAndIcon)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

private struct PDFDocumentView: UIViewRepresentable {
    let document: PDFDocument

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.backgroundColor = .systemBackground
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        if view.document !== document {
            view.document = document
        }
    }
}

private struct PreparedPDFDocument: @unchecked Sendable {
    let document: PDFDocument
    let fileURL: URL
}

private enum BinderPDFError: LocalizedError {
    case unreadableDocument

    var errorDescription: String? {
        switch self {
        case .unreadableDocument:
            "The server response isn’t a readable document."
        }
    }
}

private struct PDFShareSheet: UIViewControllerRepresentable {
    let fileURL: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {
        // The activity controller is created for the selected document and does not need updates.
    }
}

