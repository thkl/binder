import SwiftUI
import UIKit
import UniformTypeIdentifiers

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
    @State private var documentEntryError: String?

    var body: some View {
        TabView {
            searchTab
                .tabItem { Label("Search", systemImage: "magnifyingglass") }

            BrowseView(model: model)
                .tabItem { Label("Browse", systemImage: "folder") }

            SettingsView(model: model)
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        .task { await PushNotificationManager.shared.sync(serverURL: model.serverURL) }
        .task { await uploadQueuedPDFs() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task {
                    await PushNotificationManager.shared.sync(serverURL: model.serverURL)
                    await uploadQueuedPDFs()
                }
            }
        }
        .background(Color(uiColor: .systemGroupedBackground).ignoresSafeArea())
    }

    private var searchTab: some View {
        NavigationStack {
            VStack(spacing: 0) {
                searchBar

                if isUploadingQueuedPDFs {
                    ProgressView("Uploading queued documents…")
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
                        description: Text("Search document titles and extracted text.")
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
                                        DocumentView(
                                            document: result.document,
                                            serverURL: model.serverURL,
                                            onDocumentDeleted: { deletedUUID in
                                                let previousCount = results.count
                                                results.removeAll { $0.document.uuid == deletedUUID }
                                                if results.count < previousCount { resultCount = max(0, resultCount - 1) }
                                            }
                                        )
                                    } label: {
                                        DocumentListRow(
                                            document: result.document,
                                            serverURL: model.serverURL,
                                            snippet: result.snippet.nilIfBlank,
                                            footer: result.pageNumber.map { "Page \($0)" } ?? "Title match"
                                        )
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
                ToolbarItem(placement: .topBarTrailing) {
                    DocumentAddMenu(
                        onScan: saveScannedPDF,
                        onFiles: { files in Task { await enqueueSelectedDocuments(files) } },
                        onError: { documentEntryError = $0 }
                    )
                }
            }
            .alert("Document", isPresented: Binding(
                get: { documentEntryError != nil },
                set: { if !$0 { documentEntryError = nil } }
            )) {
                Button("OK", role: .cancel) { documentEntryError = nil }
            } message: {
                Text(documentEntryError ?? "")
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
        isUploadingQueuedPDFs = true
        queuedUploadMessage = nil
        canRetryQueuedPDFs = false
        defer { isUploadingQueuedPDFs = false }
        let report = await DocumentUploadQueue.uploadPending(serverURL: model.serverURL)
        queuedUploadMessage = report.remainingCount > 0 || report.uploadedCount > 0 ? report.summary : nil
        canRetryQueuedPDFs = report.remainingCount > 0
    }

    @MainActor
    private func saveScannedPDF(_ pages: [UIImage]) {
        do {
            _ = try ScannedDocumentQueue.enqueue(pages: pages)
            queuedUploadMessage = "Scan saved. Uploading PDF…"
            canRetryQueuedPDFs = false
            Task { await uploadQueuedPDFs() }
        } catch {
            documentEntryError = error.localizedDescription
        }
    }

    @MainActor
    private func enqueueSelectedDocuments(_ files: [URL]) async {
        guard !files.isEmpty else { return }

        var queuedCount = 0
        do {
            for file in files {
                try enqueueSelectedDocument(file)
                queuedCount += 1
            }
        } catch {
            if queuedCount == 0 {
                documentEntryError = error.localizedDescription
                return
            }
            queuedUploadMessage = "Added \(queuedCount) of \(files.count) documents. Uploading the queued files…"
            canRetryQueuedPDFs = true
            await uploadQueuedPDFs()
            documentEntryError = error.localizedDescription
            return
        }

        queuedUploadMessage = "Added \(queuedCount) document(s). Uploading…"
        canRetryQueuedPDFs = false
        await uploadQueuedPDFs()
    }

    private func enqueueSelectedDocument(_ file: URL) throws {
        let hasSecurityScopedAccess = file.startAccessingSecurityScopedResource()
        defer {
            if hasSecurityScopedAccess {
                file.stopAccessingSecurityScopedResource()
            }
        }
        _ = try SharedPDFQueue.enqueue(from: file, filename: file.lastPathComponent)
    }

}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
