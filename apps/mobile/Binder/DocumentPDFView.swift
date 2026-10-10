import SwiftUI
import UIKit
import PDFKit

struct DocumentPDFView: View {
    let result: BinderSearchResult
    let serverURL: String

    @State private var pdfData: Data?
    @State private var pdfFileURL: URL?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var isSharing = false
    @State private var shareError: String?

    private var filename: String {
        let original = result.document.originalFilename.trimmingCharacters(in: .whitespacesAndNewlines)
        return original.isEmpty ? "document.pdf" : original
    }

    private var displayTitle: String {
        let title = result.document.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return title.isEmpty ? filename : title
    }

    var body: some View {
        Group {
            if let pdfData {
                PDFDocumentView(data: pdfData)
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
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    isSharing = true
                } label: {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
                .disabled(pdfFileURL == nil)
                .accessibilityIdentifier("share-document-pdf")
            }
        }
        .sheet(isPresented: $isSharing) {
            if let pdfFileURL {
                PDFShareSheet(fileURL: pdfFileURL)
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
        .task(id: "\(serverURL)-\(result.document.uuid)") {
            await loadPDF()
        }
    }

    @MainActor
    private func loadPDF() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let data = try await BinderAPI.shared.documentFile(
                serverURL: serverURL,
                documentUUID: result.document.uuid
            )
            guard PDFDocument(data: data) != nil else {
                errorMessage = "The server response isn’t a readable PDF."
                return
            }
            let safeFilename = URL(fileURLWithPath: filename).lastPathComponent
            let shareURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("Binder-\(UUID().uuidString)", isDirectory: true)
                .appendingPathComponent(safeFilename)
            try FileManager.default.createDirectory(
                at: shareURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try data.write(to: shareURL, options: .atomic)
            pdfData = data
            pdfFileURL = shareURL
        } catch {
            if pdfData == nil {
                errorMessage = error.localizedDescription
            } else {
                shareError = error.localizedDescription
            }
        }
    }
}

private struct PDFDocumentView: UIViewRepresentable {
    let data: Data

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.backgroundColor = .systemBackground
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        view.document = PDFDocument(data: data)
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

