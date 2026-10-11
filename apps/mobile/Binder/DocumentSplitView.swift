import SwiftUI

struct DocumentSplitView: View {
    let document: BinderDocumentSummary
    let serverURL: String

    @Environment(\.dismiss) private var dismiss
    @State private var splitAfterPage: Int
    @State private var autoApplySuggestions = false
    @State private var isSplitting = false
    @State private var errorMessage: String?
    @State private var result: BinderSplitDocumentResult?

    private var pageCount: Int { document.pageCount ?? 1 }

    init(document: BinderDocumentSummary, serverURL: String) {
        self.document = document
        self.serverURL = serverURL
        _splitAfterPage = State(initialValue: max(1, (document.pageCount ?? 2) / 2))
    }

    var body: some View {
        NavigationStack {
            Group {
                if let result {
                    splitResults(result)
                } else {
                    splitForm
                }
            }
            .navigationTitle(result == nil ? "Split PDF" : "Split complete")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(result == nil ? "Cancel" : "Done") { dismiss() }
                        .disabled(isSplitting)
                }
                if result == nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            Task { await split() }
                        } label: {
                            if isSplitting {
                                ProgressView()
                            } else {
                                Text("Split")
                                    .fontWeight(.semibold)
                            }
                        }
                        .disabled(isSplitting || pageCount < 2)
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(isSplitting)
    }

    private var splitForm: some View {
        Form {
            Section("Split point") {
                Stepper(value: $splitAfterPage, in: 1...max(1, pageCount - 1)) {
                    LabeledContent("Split after page", value: "\(splitAfterPage)")
                }
                LabeledContent("First document", value: "Pages 1–\(splitAfterPage)")
                LabeledContent(
                    "Extracted document",
                    value: "Pages \(splitAfterPage + 1)–\(pageCount)"
                )
                Text("The original PDF stays in version history. The extracted pages become a separate document.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Section("Processing") {
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

    private func splitResults(_ result: BinderSplitDocumentResult) -> some View {
        List {
            Section("Remaining pages") {
                resultRow(
                    document: result.remainingDocument,
                    description: "Pages 1–\(splitAfterPage)"
                )
            }
            Section("Extracted pages") {
                resultRow(
                    document: result.extractedDocument,
                    description: "Pages \(splitAfterPage + 1)–\(pageCount)"
                )
            }
        }
        .listStyle(.insetGrouped)
    }

    @ViewBuilder
    private func resultRow(document: BinderDocumentSummary, description: String) -> some View {
        if isContentAvailable(document) {
            NavigationLink {
                DocumentView(document: document, serverURL: serverURL)
            } label: {
                DocumentSplitResultRow(document: document, description: description)
            }
        } else {
            DocumentSplitResultRow(document: document, description: "Processing · \(description)")
        }
    }

    private func isContentAvailable(_ document: BinderDocumentSummary) -> Bool {
        !["uploaded", "scanning", "quarantined"].contains(document.status ?? "")
    }

    @MainActor
    private func split() async {
        guard !isSplitting, pageCount > 1 else { return }
        isSplitting = true
        errorMessage = nil
        defer { isSplitting = false }

        do {
            result = try await BinderAPI.shared.splitDocument(
                serverURL: serverURL,
                documentUUID: document.uuid,
                splitAfterPage: splitAfterPage,
                autoApplySuggestions: autoApplySuggestions
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct DocumentSplitResultRow: View {
    let document: BinderDocumentSummary
    let description: String

    private var title: String {
        let candidate = document.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return candidate.isEmpty ? document.originalFilename : candidate
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.body.weight(.medium))
                .lineLimit(2)
            Text(description)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}
