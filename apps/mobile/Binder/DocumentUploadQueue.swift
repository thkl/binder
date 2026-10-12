import Foundation
import Combine

struct DocumentUploadReport {
    let uploadedCount: Int
    let remainingCount: Int
    let failureMessage: String?

    var summary: String {
        if remainingCount == 0 {
            return uploadedCount == 0 ? "Upload queue is empty." : "Uploaded \(uploadedCount) document(s)."
        }
        if uploadedCount > 0 {
            return "Uploaded \(uploadedCount). \(remainingCount) document(s) remain queued. \(failureMessage ?? "Retry when the server is available.")"
        }
        return "\(remainingCount) document(s) remain queued. \(failureMessage ?? "Retry when the server is available.")"
    }
}

@MainActor
enum DocumentUploadQueue {
    private static let zipThreshold = 3
    private static let maxFilesPerArchive = 20
    static let state = DocumentUploadQueueState()

    static func uploadPending(serverURL: String) async -> DocumentUploadReport {
        guard !state.isUploading else {
            return DocumentUploadReport(uploadedCount: 0, remainingCount: (try? SharedPDFQueue.pendingFiles().count) ?? 0, failureMessage: "An upload is already in progress.")
        }
        state.isUploading = true
        defer { state.isUploading = false }

        let files: [URL]
        do {
            files = try SharedPDFQueue.pendingFiles()
        } catch {
            return DocumentUploadReport(uploadedCount: 0, remainingCount: 0, failureMessage: error.localizedDescription)
        }
        guard !files.isEmpty else {
            return DocumentUploadReport(uploadedCount: 0, remainingCount: 0, failureMessage: nil)
        }

        if files.count < zipThreshold {
            return await uploadIndividually(files, serverURL: serverURL)
        }
        return await uploadAsArchive(files, serverURL: serverURL)
    }

    private static func uploadIndividually(_ files: [URL], serverURL: String) async -> DocumentUploadReport {
        var uploadedCount = 0
        for file in files {
            do {
                try await BinderAPI.shared.uploadDocument(serverURL: serverURL, fileURL: file)
                try SharedPDFQueue.remove(fileAt: file)
                uploadedCount += 1
            } catch {
                return DocumentUploadReport(
                    uploadedCount: uploadedCount,
                    remainingCount: (try? SharedPDFQueue.pendingFiles().count) ?? files.count - uploadedCount,
                    failureMessage: error.localizedDescription
                )
            }
        }
        return DocumentUploadReport(uploadedCount: uploadedCount, remainingCount: 0, failureMessage: nil)
    }

    private static func uploadAsArchive(_ files: [URL], serverURL: String) async -> DocumentUploadReport {
        var uploadedCount = 0
        var failureMessage: String?
        for start in stride(from: 0, to: files.count, by: maxFilesPerArchive) {
            let end = min(start + maxFilesPerArchive, files.count)
            let report = await uploadArchiveChunk(Array(files[start..<end]), serverURL: serverURL)
            uploadedCount += report.uploadedCount
            if failureMessage == nil { failureMessage = report.failureMessage }
        }
        let remainingCount = (try? SharedPDFQueue.pendingFiles().count) ?? max(files.count - uploadedCount, 0)
        return DocumentUploadReport(
            uploadedCount: uploadedCount,
            remainingCount: remainingCount,
            failureMessage: failureMessage
        )
    }

    private static func uploadArchiveChunk(_ files: [URL], serverURL: String) async -> DocumentUploadReport {
        let archive: DocumentBatchArchive
        do {
            archive = try DocumentBatchArchive.create(from: files)
        } catch {
            return DocumentUploadReport(
                uploadedCount: 0,
                remainingCount: files.count,
                failureMessage: error.localizedDescription
            )
        }
        defer { try? FileManager.default.removeItem(at: archive.url) }

        let outcomes: [BinderBatchUploadItem]
        do {
            outcomes = try await BinderAPI.shared.uploadDocumentArchive(
                serverURL: serverURL,
                archiveURL: archive.url
            )
        } catch {
            return DocumentUploadReport(
                uploadedCount: 0,
                remainingCount: (try? SharedPDFQueue.pendingFiles().count) ?? files.count,
                failureMessage: error.localizedDescription
            )
        }

        guard outcomes.count == archive.sourceFiles.count,
              Set(outcomes.map(\.index)).count == outcomes.count,
              outcomes.allSatisfy({ archive.sourceFiles.indices.contains($0.index) }) else {
            return DocumentUploadReport(
                uploadedCount: 0,
                remainingCount: (try? SharedPDFQueue.pendingFiles().count) ?? files.count,
                failureMessage: "The server returned an incomplete batch upload response."
            )
        }

        var uploadedCount = 0
        var removalFailure: String?
        let failures = outcomes.filter { !$0.success }
        for outcome in outcomes where outcome.success {
            let sourceURL = archive.sourceFiles[outcome.index]
            do {
                try SharedPDFQueue.remove(fileAt: sourceURL)
                uploadedCount += 1
            } catch {
                removalFailure = "The server accepted a file, but Binder could not remove its local queue copy."
            }
        }

        let remainingCount = (try? SharedPDFQueue.pendingFiles().count) ?? failures.count
        let firstFailure = failures.first?.message
        return DocumentUploadReport(
            uploadedCount: uploadedCount,
            remainingCount: remainingCount,
            failureMessage: removalFailure ?? firstFailure
        )
    }
}

@MainActor
final class DocumentUploadQueueState: ObservableObject {
    @Published fileprivate(set) var isUploading = false
}
