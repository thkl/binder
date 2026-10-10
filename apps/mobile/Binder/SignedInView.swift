import SwiftUI
import UIKit

struct SignedInView: View {
    @ObservedObject var model: AuthViewModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var query = ""
    @State private var results: [BinderSearchResult] = []
    @State private var resultCount = 0
    @State private var searchedQuery = ""
    @State private var hasSearched = false
    @State private var isSearching = false
    @State private var errorMessage: String?
    @State private var isUploadingQueuedPDFs = false
    @State private var queuedUploadMessage: String?
    @State private var canRetryQueuedPDFs = false
    @State private var isShowingScanner = false
    @State private var scannerError: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                searchBar

                if isUploadingQueuedPDFs {
                    ProgressView("Uploading queued PDFs…")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal)
                        .padding(.vertical, 10)
                } else if let queuedUploadMessage {
                    HStack(spacing: 12) {
                        Label(queuedUploadMessage, systemImage: "doc.badge.arrow.up")
                            .font(.footnote)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if canRetryQueuedPDFs {
                            Button("Retry") { Task { await uploadQueuedPDFs() } }
                                .font(.footnote.weight(.semibold))
                        }
                    }
                    .padding(.horizontal)
                    .padding(.vertical, 10)
                    .background(Color(uiColor: .secondarySystemGroupedBackground))
                }

                if isSearching {
                    ProgressView("Searching…")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal)
                        .padding(.vertical, 12)
                }

                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline)
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                if !hasSearched {
                    ContentUnavailableView(
                        "Search your documents",
                        systemImage: "magnifyingglass",
                        description: Text("Search document titles and text inside your PDFs.")
                    )
                } else if results.isEmpty && !isSearching {
                    ContentUnavailableView(
                        errorMessage == nil ? "No documents found" : "Search failed",
                        systemImage: errorMessage == nil ? "doc.text.magnifyingglass" : "exclamationmark.magnifyingglass",
                        description: Text(errorMessage == nil ? "Try another search phrase." : "Check your connection and try again.")
                    )
                } else {
                    List {
                        if !results.isEmpty {
                            Section("\(resultCount) results for “\(searchedQuery)”") {
                                ForEach(results) { result in
                                    NavigationLink {
                                        DocumentPDFView(result: result, serverURL: model.serverURL)
                                    } label: {
                                        BinderSearchResultRow(result: result, serverURL: model.serverURL)
                                    }
                                    .buttonStyle(.plain)
                                    .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
                                }
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Binder")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        guard DocumentScanner.isSupported else {
                            scannerError = "Document scanning is not available on this device."
                            return
                        }
                        isShowingScanner = true
                    } label: {
                        Image(systemName: "doc.viewfinder")
                    }
                    .accessibilityLabel("Scan document")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Sign out", role: .destructive) { Task { await model.signOut() } }
                }
            }
            .sheet(isPresented: $isShowingScanner) {
                DocumentScanner(
                    isPresented: $isShowingScanner,
                    onScan: saveScannedPDF,
                    onError: { scannerError = $0 }
                )
                .ignoresSafeArea()
            }
            .alert("Document scanner", isPresented: Binding(
                get: { scannerError != nil },
                set: { if !$0 { scannerError = nil } }
            )) {
                Button("OK", role: .cancel) { scannerError = nil }
            } message: {
                Text(scannerError ?? "")
            }
            .task { await uploadQueuedPDFs() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await uploadQueuedPDFs() } }
            }
            .background(Color(uiColor: .systemGroupedBackground).ignoresSafeArea())
        }
    }

    private var searchBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("Search documents", text: $query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .onSubmit { Task { await search() } }
                .accessibilityLabel("Search documents")
            if !query.isEmpty {
                Button {
                    query = ""
                    results = []
                    resultCount = 0
                    hasSearched = false
                    errorMessage = nil
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .accessibilityLabel("Clear search")
            }
            Button("Search") { Task { await search() } }
                .fontWeight(.semibold)
                .disabled(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSearching)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
        .padding()
        .background(Color(uiColor: .systemGroupedBackground))
    }

    @MainActor
    private func search() async {
        let phrase = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !phrase.isEmpty, !isSearching else { return }
        isSearching = true
        errorMessage = nil
        defer { isSearching = false }
        do {
            let response = try await BinderAPI.shared.search(serverURL: model.serverURL, query: phrase)
            results = response.items
            resultCount = response.total
            searchedQuery = response.query
            hasSearched = true
        } catch {
            results = []
            resultCount = 0
            searchedQuery = phrase
            errorMessage = error.localizedDescription
            hasSearched = true
        }
    }

    @MainActor
    private func uploadQueuedPDFs() async {
        guard !isUploadingQueuedPDFs else { return }
        do {
            let files = try SharedPDFQueue.pendingFiles()
            guard !files.isEmpty else {
                queuedUploadMessage = nil
                canRetryQueuedPDFs = false
                return
            }

            isUploadingQueuedPDFs = true
            queuedUploadMessage = nil
            canRetryQueuedPDFs = false
            defer { isUploadingQueuedPDFs = false }
            var uploaded = 0

            for file in files {
                do {
                    try await BinderAPI.shared.uploadDocument(serverURL: model.serverURL, fileURL: file)
                    try SharedPDFQueue.remove(fileAt: file)
                    uploaded += 1
                } catch {
                    let remaining = files.count - uploaded
                    queuedUploadMessage = "\(remaining) PDF(s) remain queued. Check the server connection and retry."
                    canRetryQueuedPDFs = true
                    return
                }
            }

            queuedUploadMessage = "Uploaded \(uploaded) queued PDF(s)."
        } catch {
            queuedUploadMessage = error.localizedDescription
            canRetryQueuedPDFs = true
        }
    }

    @MainActor
    private func saveScannedPDF(_ pages: [UIImage]) {
        do {
            _ = try ScannedDocumentQueue.enqueue(pages: pages)
            queuedUploadMessage = "Scan saved. Uploading PDF…"
            canRetryQueuedPDFs = false
            Task { await uploadQueuedPDFs() }
        } catch {
            scannerError = error.localizedDescription
        }
    }

}

private struct BinderSearchResultRow: View {
    let result: BinderSearchResult
    let serverURL: String
    @State private var thumbnail: UIImage?

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Group {
                if let thumbnail {
                    Image(uiImage: thumbnail)
                        .resizable()
                        .scaledToFill()
                } else {
                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color(uiColor: .tertiarySystemGroupedBackground))
                        Image(systemName: "doc.richtext")
                            .font(.system(size: 26))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(width: 66, height: 88)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 5) {
                Text(displayTitle)
                    .font(.headline)
                    .lineLimit(2)
                    .foregroundStyle(.primary)
                Text(result.document.originalFilename)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                if let snippet = result.snippet.nilIfBlank {
                    Text(snippet)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                let metadata = [
                    result.document.metadataSummary?.documentType?.name,
                    result.document.metadataSummary?.category?.name,
                    result.document.metadataSummary?.issuer?.name
                ].compactMap { $0?.nilIfBlank }
                if !metadata.isEmpty {
                    Text(metadata.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(Color.accentColor)
                        .lineLimit(1)
                }

                Text(result.pageNumber.map { "Page \($0)" } ?? "Title match")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .task(id: "\(serverURL)-\(result.document.uuid)") {
            do {
                let data = try await BinderAPI.shared.thumbnail(
                    serverURL: serverURL,
                    documentUUID: result.document.uuid
                )
                thumbnail = UIImage(data: data)
            } catch {
                // Some documents do not have a generated thumbnail yet.
            }
        }
    }

    private var displayTitle: String {
        guard let title = result.document.title?.nilIfBlank else { return result.document.originalFilename }
        return title
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
