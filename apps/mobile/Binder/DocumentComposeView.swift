import SwiftUI

struct DocumentComposeView: View {
    let targetDocument: BinderDocumentSummary
    let serverURL: String

    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""
    @State private var documents: [BinderDocumentSummary] = []
    @State private var selectedSource: BinderDocumentSummary?
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

    var body: some View {
        NavigationStack {
            Group {
                if let composedDocument {
                    compositionResult(composedDocument)
                } else if let selectedSource {
                    compositionForm(source: selectedSource)
                } else {
                    sourcePicker
                }
            }
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(selectedSource == nil && composedDocument == nil ? "Cancel" : "Done") {
                        if selectedSource != nil && composedDocument == nil {
                            selectedSource = nil
                            errorMessage = nil
                        } else {
                            dismiss()
                        }
                    }
                    .disabled(isComposing)
                }
                if selectedSource != nil && composedDocument == nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            Task { await compose() }
                        } label: {
                            if isComposing {
                                ProgressView()
                            } else {
                                Text("Combine")
                                    .fontWeight(.semibold)
                            }
                        }
                        .disabled(isComposing)
                    }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(isComposing)
        .task(id: searchText) {
            guard selectedSource == nil, composedDocument == nil else { return }
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
        return selectedSource == nil ? "Choose a PDF" : "Combine PDFs"
    }

    private var sourcePicker: some View {
        List {
            Section("Target document") {
                DocumentComposeRow(document: targetDocument, detail: "First PDF")
            }

            Section("Choose the PDF to insert") {
                if documents.isEmpty && isLoading {
                    HStack { Spacer(); ProgressView("Loading documents…"); Spacer() }
                } else if documents.isEmpty {
                    ContentUnavailableView(
                        "No other PDFs found",
                        systemImage: "doc.text.magnifyingglass",
                        description: Text("Search for another owned document to insert.")
                    )
                } else {
                    ForEach(documents.filter { $0.uuid != targetDocument.uuid && isContentAvailable($0) }) { document in
                        Button {
                            selectedSource = document
                            insertAfterPage = targetPageCount
                            errorMessage = nil
                        } label: {
                            DocumentComposeRow(document: document, detail: "\(document.pageCount ?? 1) pages")
                                .contentShape(Rectangle())
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

    private func compositionForm(source: BinderDocumentSummary) -> some View {
        Form {
            Section("Documents") {
                DocumentComposeRow(document: targetDocument, detail: "Target · \(targetPageCount) pages")
                DocumentComposeRow(document: source, detail: "Inserted · \(source.pageCount ?? 1) pages")
            }

            Section("Insertion point") {
                Stepper(value: $insertAfterPage, in: 0...targetPageCount) {
                    LabeledContent(
                        insertAfterPage == 0 ? "Insert before page 1" : "Insert after page",
                        value: insertAfterPage == 0 ? "—" : "\(insertAfterPage)"
                    )
                }
                Text("The selected PDF’s pages will be inserted at this point. The target stays in version history, and the combined PDF becomes its next version.")
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
        guard let source = selectedSource, !isComposing else { return }
        isComposing = true
        errorMessage = nil
        defer { isComposing = false }

        do {
            composedDocument = try await BinderAPI.shared.composeDocuments(
                serverURL: serverURL,
                targetDocumentUUID: targetDocument.uuid,
                sourceDocumentUUID: source.uuid,
                insertAfterPage: insertAfterPage,
                copyMetadata: copyMetadata,
                autoApplySuggestions: autoApplySuggestions
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }
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
