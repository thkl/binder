import SwiftUI

struct DocumentComposeView: View {
    let targetDocument: BinderDocumentSummary
    let serverURL: String

    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""
    @State private var documents: [BinderDocumentSummary] = []
    @State private var selectedSources: [ComposeSourceSelection] = []
    @State private var isConfiguring = false
    @State private var insertAfterPage: Int
    @State private var copyMetadata = true
    @State private var autoApplySuggestions = false
    @State private var composedDocument: BinderDocumentSummary?
    @State private var hasNextPage = false
    @State private var nextPage = 1
    @State private var isLoading = false
    @State private var isComposing = false
    @State private var errorMessage: String?

    private var targetPageCount: Int { max(1, targetDocument.pageCount ?? 1) }

    init(targetDocument: BinderDocumentSummary, serverURL: String) {
        self.targetDocument = targetDocument
        self.serverURL = serverURL
        _insertAfterPage = State(initialValue: max(1, targetDocument.pageCount ?? 1))
    }

    init(
        targetDocument: BinderDocumentSummary,
        serverURL: String,
        initialSources: [BinderDocumentSummary]
    ) {
        self.targetDocument = targetDocument
        self.serverURL = serverURL
        _insertAfterPage = State(initialValue: max(1, targetDocument.pageCount ?? 1))
        _selectedSources = State(initialValue: initialSources.map { document in
            let pageCount = max(1, document.pageCount ?? 1)
            return ComposeSourceSelection(document: document, startPage: 1, endPage: pageCount)
        })
        _isConfiguring = State(initialValue: !initialSources.isEmpty)
    }

    var body: some View {
        NavigationStack {
            Group {
                if let composedDocument {
                    compositionResult(composedDocument)
                } else if isConfiguring {
                    compositionForm
                } else {
                    sourcePicker
                }
            }
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(
                        composedDocument != nil ? "Done" : (isConfiguring ? "Back" : "Cancel")
                    ) {
                        if isConfiguring && composedDocument == nil {
                            isConfiguring = false
                            errorMessage = nil
                        } else {
                            dismiss()
                        }
                    }
                    .disabled(isComposing)
                }
                if composedDocument == nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            if isConfiguring {
                                Task { await compose() }
                            } else {
                                isConfiguring = true
                            }
                        } label: {
                            if isComposing {
                                ProgressView()
                            } else {
                                Text(isConfiguring ? "Combine" : "Continue")
                                    .fontWeight(.semibold)
                            }
                        }
                        .disabled(isComposing || (!isConfiguring && selectedSources.isEmpty))
                    }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(isComposing)
        .task(id: searchText) {
            guard !isConfiguring, composedDocument == nil else { return }
            do {
                try await Task.sleep(for: .milliseconds(300))
                try Task.checkCancellation()
                await loadDocuments(reset: true)
            } catch is CancellationError {
                // A newer search term replaced this request.
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private var navigationTitle: String {
        if composedDocument != nil { return "Combine complete" }
        return isConfiguring ? "Choose pages and order" : "Choose PDFs"
    }

    private var sourcePicker: some View {
        List {
            Section("Target document") {
                DocumentListRow(document: targetDocument, serverURL: serverURL, footer: "First PDF")
            }

            Section("Choose PDFs to insert") {
                if documents.isEmpty && isLoading {
                    HStack { Spacer(); ProgressView("Loading documents…"); Spacer() }
                } else if documents.isEmpty {
                    ContentUnavailableView(
                        "No other PDFs found",
                        systemImage: "doc.text.magnifyingglass",
                        description: Text("Search for another owned document to insert.")
                    )
                } else {
                    ForEach(documents.filter { $0.uuid != targetDocument.uuid && isPDFDocument($0) && isContentAvailable($0) }) { document in
                        Button {
                            toggleSource(document)
                            errorMessage = nil
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: isSelected(document) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(isSelected(document) ? Color.accentColor : Color.secondary)
                                    .accessibilityHidden(true)
                                DocumentListRow(
                                    document: document,
                                    serverURL: serverURL,
                                    footer: "\(document.pageCount ?? 1) pages"
                                )
                                .contentShape(Rectangle())
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }

                if hasNextPage {
                    Button {
                        Task { await loadDocuments(reset: false) }
                    } label: {
                        HStack { Spacer(); Text(isLoading ? "Loading…" : "Load more documents"); Spacer() }
                    }
                    .disabled(isLoading)
                }
            }

            if let errorMessage {
                Section {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                }
            }
        }
        .listStyle(.insetGrouped)
        .searchable(text: $searchText, prompt: "Search your documents")
    }

    private var compositionForm: some View {
        Form {
            Section("Target document") {
                DocumentListRow(
                    document: targetDocument,
                    serverURL: serverURL,
                    footer: "Target · \(targetPageCount) pages"
                )
            }

            ForEach(selectedSources.indices, id: \.self) { index in
                let selection = selectedSources[index]
                let pageCount = max(1, selection.document.pageCount ?? 1)
                let canMoveUp = selectedSources.count > 1 && index > 0
                let canMoveDown = selectedSources.count > 1 && index < selectedSources.count - 1
                Section("Source PDF \(index + 1)") {
                    DocumentListRow(
                        document: selection.document,
                        serverURL: serverURL,
                        footer: "Source PDF \(index + 1) · \(pageCount) pages"
                    )
                    Text("Include pages \(selection.startPage)–\(selection.endPage) of \(pageCount)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Stepper(
                        "First page",
                        value: Binding(
                            get: { selectedSources[index].startPage },
                            set: { setStartPage($0, at: index) }
                        ),
                        in: 1...pageCount
                    )
                    Stepper(
                        "Last page",
                        value: Binding(
                            get: { selectedSources[index].endPage },
                            set: { selectedSources[index].endPage = $0 }
                        ),
                        in: selection.startPage...pageCount
                    )
                    HStack {
                        Button {
                            moveSource(at: index, by: -1)
                        } label: {
                            Label("Move up", systemImage: "arrow.up")
                        }
                        .disabled(!canMoveUp)

                        Button {
                            moveSource(at: index, by: 1)
                        } label: {
                            Label("Move down", systemImage: "arrow.down")
                        }
                        .disabled(!canMoveDown)
                    }
                    .buttonStyle(.bordered)
                    Button("Remove source", role: .destructive) {
                        selectedSources.remove(at: index)
                        if selectedSources.isEmpty { isConfiguring = false }
                    }
                }
            }

            Section("Insertion point") {
                Stepper(value: $insertAfterPage, in: 0...targetPageCount) {
                    LabeledContent(
                        insertAfterPage == 0 ? "Insert before page 1" : "Insert after page",
                        value: insertAfterPage == 0 ? "—" : "\(insertAfterPage)"
                    )
                }
                Text("The chosen page ranges are inserted in the order shown above. The target stays in version history, and the combined PDF becomes its next version.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Section("Processing") {
                Toggle("Copy target metadata and folders", isOn: $copyMetadata)
                Toggle("Apply AI suggestions automatically", isOn: $autoApplySuggestions)
            }

            if let errorMessage {
                Section {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func compositionResult(_ document: BinderDocumentSummary) -> some View {
        List {
            Section {
                Label("Combined PDF queued for processing", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                DocumentComposeRow(document: document, detail: "New version · \(document.status ?? "processing")")
            } footer: {
                Text("The combined document will appear in the target document’s version history when processing finishes.")
            }
        }
        .listStyle(.insetGrouped)
    }

    private func isContentAvailable(_ document: BinderDocumentSummary) -> Bool {
        !["uploaded", "scanning", "quarantined"].contains(document.status ?? "")
    }

    private func isPDFDocument(_ document: BinderDocumentSummary) -> Bool {
        document.mimeType == nil || document.mimeType == "application/pdf"
    }

    private func isSelected(_ document: BinderDocumentSummary) -> Bool {
        selectedSources.contains { $0.document.uuid == document.uuid }
    }

    private func toggleSource(_ document: BinderDocumentSummary) {
        if let index = selectedSources.firstIndex(where: { $0.document.uuid == document.uuid }) {
            selectedSources.remove(at: index)
        } else {
            let pageCount = max(1, document.pageCount ?? 1)
            selectedSources.append(
                ComposeSourceSelection(document: document, startPage: 1, endPage: pageCount)
            )
        }
    }

    private func setStartPage(_ page: Int, at index: Int) {
        selectedSources[index].startPage = page
        if selectedSources[index].endPage < page {
            selectedSources[index].endPage = page
        }
    }

    private func moveSource(at index: Int, by offset: Int) {
        let destination = index + offset
        guard selectedSources.indices.contains(index), selectedSources.indices.contains(destination) else { return }
        selectedSources.swapAt(index, destination)
    }

    @MainActor
    private func loadDocuments(reset: Bool) async {
        guard !isLoading else { return }
        if reset {
            nextPage = 1
            documents = []
            errorMessage = nil
        }
        isLoading = true
        defer { isLoading = false }

        do {
            let page = try await BinderAPI.shared.ownedDocuments(
                serverURL: serverURL,
                query: searchText.trimmingCharacters(in: .whitespacesAndNewlines),
                page: nextPage
            )
            if reset { documents = page.items } else { documents.append(contentsOf: page.items) }
            hasNextPage = page.hasNext
            nextPage = page.page + 1
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func compose() async {
        guard isConfiguring, !selectedSources.isEmpty, !isComposing else { return }
        isComposing = true
        errorMessage = nil
        defer { isComposing = false }

        do {
            composedDocument = try await BinderAPI.shared.composeDocuments(
                serverURL: serverURL,
                targetDocumentUUID: targetDocument.uuid,
                sources: selectedSources.map {
                    (documentUUID: $0.document.uuid, startPage: $0.startPage, endPage: $0.endPage)
                },
                insertAfterPage: insertAfterPage,
                copyMetadata: copyMetadata,
                autoApplySuggestions: autoApplySuggestions
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct ComposeSourceSelection: Identifiable {
    let document: BinderDocumentSummary
    var startPage: Int
    var endPage: Int

    var id: String { document.uuid }
}

private struct DocumentComposeRow: View {
    let document: BinderDocumentSummary
    let detail: String

    private var title: String {
        let candidate = document.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return candidate.isEmpty ? document.originalFilename : candidate
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.body.weight(.medium))
                .lineLimit(2)
            Text(detail)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}
