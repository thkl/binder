import SwiftUI

struct UploadQueueView: View {
    let serverURL: String

    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var uploadState = DocumentUploadQueue.state
    @State private var files: [QueuedUploadItem] = []
    @State private var isLoading = true
    @State private var isUploading = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            if let errorMessage {
                Section {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.secondary)
                }
            }

            if isLoading && files.isEmpty {
                Section { ProgressView("Loading upload queue…") }
            } else if files.isEmpty {
                ContentUnavailableView(
                    "No queued documents",
                    systemImage: "tray",
                    description: Text("Documents waiting for upload will appear here.")
                )
                .listRowBackground(Color.clear)
            } else {
                Section("\(files.count) queued") {
                    ForEach(files) { item in
                        QueuedUploadRow(item: item)
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) { remove(item) } label: {
                                    Label("Remove", systemImage: "trash")
                                }
                                .disabled(isUploading || uploadState.isUploading)
                            }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Upload queue")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                EditButton().disabled(files.isEmpty || isUploading || uploadState.isUploading)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await uploadPending() }
                } label: {
                    if isUploading {
                        ProgressView()
                    } else {
                        Text("Upload")
                    }
                }
                .disabled(files.isEmpty || isUploading || uploadState.isUploading)
            }
        }
        .task { refresh() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { refresh() }
        }
    }

    private func refresh() {
        isLoading = true
        defer { isLoading = false }
        do {
            files = try SharedPDFQueue.pendingFiles().map(QueuedUploadItem.init)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func remove(_ item: QueuedUploadItem) {
        do {
            try SharedPDFQueue.remove(fileAt: item.url)
            files.removeAll { $0.id == item.id }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func uploadPending() async {
        guard !isUploading else { return }
        isUploading = true
        defer { isUploading = false }
        let report = await DocumentUploadQueue.uploadPending(serverURL: serverURL)
        refresh()
        errorMessage = report.remainingCount > 0 ? report.summary : nil
    }
}

private struct QueuedUploadItem: Identifiable {
    let url: URL
    let byteCount: Int64
    let dateAdded: Date?

    var id: String { url.path }
    var filename: String { url.lastPathComponent }

    init(url: URL) {
        self.url = url
        let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
        byteCount = Int64(values?.fileSize ?? 0)
        dateAdded = values?.contentModificationDate
    }
}

private struct QueuedUploadRow: View {
    let item: QueuedUploadItem

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(.secondary)
                .frame(width: 32)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.filename)
                    .lineLimit(2)
                    .font(.body)
                Text(details)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Text("Queued")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    private var symbol: String {
        item.url.pathExtension.lowercased() == "pdf" ? "doc.richtext" : "photo"
    }

    private var details: String {
        let size = ByteCountFormatter.string(fromByteCount: item.byteCount, countStyle: .file)
        guard let date = item.dateAdded else { return size }
        return "\(size) · Added \(date.formatted(date: .abbreviated, time: .shortened))"
    }
}
