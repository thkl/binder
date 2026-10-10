import SwiftUI
import UIKit
import PDFKit

struct DocumentPDFView: View {
    let document: BinderDocumentSummary
    let serverURL: String

    @State private var loadedPDF: PreparedPDFDocument?
    @State private var pdfFileURL: URL?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var activeSheet: DocumentPDFSheet?
    @State private var shareError: String?

    private var filename: String {
        let original = document.originalFilename.trimmingCharacters(in: .whitespacesAndNewlines)
        return original.isEmpty ? "document.pdf" : original
    }

    private var displayTitle: String {
        let title = document.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return title.isEmpty ? filename : title
    }

    var body: some View {
        Group {
            if let loadedPDF {
                PDFDocumentView(document: loadedPDF.document)
                    .background(Color(uiColor: .secondarySystemBackground))
            } else if isLoading {
                ProgressView("Loading PDF…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailableView(
                    "Couldn’t load PDF",
                    systemImage: "doc.questionmark",
                    description: Text(errorMessage ?? "Check your connection and try again.")
                )
            }
        }
        .navigationTitle(displayTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    activeSheet = .metadata(document)
                } label: {
                    Label("Metadata", systemImage: "info.circle")
                }
                .accessibilityIdentifier("show-document-metadata")

                Button {
                    if let pdfFileURL { activeSheet = .share(pdfFileURL) }
                } label: {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
                .disabled(pdfFileURL == nil)
                .accessibilityIdentifier("share-document-pdf")
            }
        }
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .share(let fileURL):
                PDFShareSheet(fileURL: fileURL)
            case .metadata(let document):
                DocumentMetadataSheet(document: document, serverURL: serverURL)
            }
        }
        .alert("Couldn’t share PDF", isPresented: Binding(
            get: { shareError != nil },
            set: { if !$0 { shareError = nil } }
        )) {
            Button("OK", role: .cancel) { shareError = nil }
        } message: {
            Text(shareError ?? "")
        }
        .task(id: "\(serverURL)-\(document.uuid)") {
            await loadPDFWhenViewIsReady()
        }
    }

    @MainActor
    private func loadPDFWhenViewIsReady() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            // Let the navigation push finish before starting network and PDF work.
            try await Task.sleep(for: .milliseconds(450))
            try Task.checkCancellation()
            let data = try await BinderAPI.shared.documentFile(
                serverURL: serverURL,
                documentUUID: document.uuid
            )
            let safeFilename = URL(fileURLWithPath: filename).lastPathComponent
            let preparedPDF = try await Task.detached(priority: .userInitiated) {
                let shareURL = FileManager.default.temporaryDirectory
                    .appendingPathComponent("Binder-\(UUID().uuidString)", isDirectory: true)
                    .appendingPathComponent(safeFilename)
                try FileManager.default.createDirectory(
                    at: shareURL.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                try data.write(to: shareURL, options: .atomic)
                guard let pdfDocument = PDFDocument(url: shareURL) else {
                    try? FileManager.default.removeItem(at: shareURL.deletingLastPathComponent())
                    throw BinderPDFError.unreadablePDF
                }
                return PreparedPDFDocument(document: pdfDocument, fileURL: shareURL)
            }.value
            if Task.isCancelled {
                try? FileManager.default.removeItem(at: preparedPDF.fileURL.deletingLastPathComponent())
                return
            }
            loadedPDF = preparedPDF
            pdfFileURL = preparedPDF.fileURL
        } catch {
            if error is CancellationError { return }
            if loadedPDF == nil {
                errorMessage = error.localizedDescription
            } else {
                shareError = error.localizedDescription
            }
        }
    }
}

private enum DocumentPDFSheet: Identifiable {
    case share(URL)
    case metadata(BinderDocumentSummary)

    var id: String {
        switch self {
        case .share(let url): "share-\(url.absoluteString)"
        case .metadata(let document): "metadata-\(document.uuid)"
        }
    }
}

private struct DocumentMetadataSheet: View {
    @State private var document: BinderDocumentSummary
    @State private var folders: [BinderFolder] = []
    @State private var isLoadingFolders = true
    @State private var isLoadingMetadata = true
    @State private var folderError: String?
    @State private var metadataError: String?
    @State private var navigationPath: [DocumentMetadataRoute] = []
    let serverURL: String
    @Environment(\.dismiss) private var dismiss

    init(document: BinderDocumentSummary, serverURL: String) {
        _document = State(initialValue: document)
        self.serverURL = serverURL
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
    }

    private var sortedFolders: [BinderFolder] {
        folders.sorted {
            $0.path(in: folders).localizedStandardCompare($1.path(in: folders)) == .orderedAscending
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
    }
}

private enum DocumentMetadataRoute: Hashable {
    case edit
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
    case unreadablePDF

    var errorDescription: String? {
        switch self {
        case .unreadablePDF:
            "The server response isn’t a readable PDF."
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

