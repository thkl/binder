import Foundation

enum SharedPDFQueue {
    static let appGroupIdentifier = "group.com.binder.shared"

    static func enqueue(from sourceURL: URL, filename: String) throws -> URL {
        let directory = try queueDirectory()
        let itemDirectory = directory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: itemDirectory, withIntermediateDirectories: true)
        let safeFilename = safePDFName(filename)
        let destination = itemDirectory.appendingPathComponent(safeFilename)
        do {
            try FileManager.default.copyItem(at: sourceURL, to: destination)
            return destination
        } catch {
            try? FileManager.default.removeItem(at: itemDirectory)
            throw error
        }
    }

    static func pendingFiles() throws -> [URL] {
        let directory = try queueDirectory()
        let itemDirectories = try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        )
        return try itemDirectories.flatMap { itemDirectory in
            try FileManager.default.contentsOfDirectory(
                at: itemDirectory,
                includingPropertiesForKeys: [.contentModificationDateKey],
                options: [.skipsHiddenFiles]
            ).filter { ["pdf", "jpg", "jpeg", "png"].contains($0.pathExtension.lowercased()) }
        }.sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
    }

    static func remove(fileAt url: URL) throws {
        try FileManager.default.removeItem(at: url.deletingLastPathComponent())
    }

    private static func queueDirectory() throws -> URL {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupIdentifier
        ) else {
            throw QueueError.sharedContainerUnavailable
        }
        let directory = container.appendingPathComponent("QueuedPDFs", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private static func safePDFName(_ filename: String) -> String {
        let basename = URL(fileURLWithPath: filename).lastPathComponent
        let withoutControls = basename.unicodeScalars.map { CharacterSet.controlCharacters.contains($0) ? "_" : String($0) }.joined()
        let trimmed = withoutControls.trimmingCharacters(in: .whitespacesAndNewlines)
        let nonempty = trimmed.isEmpty || trimmed == "." || trimmed == ".." ? "document.pdf" : trimmed
        let ext = URL(fileURLWithPath: nonempty).pathExtension.lowercased()
        guard ["pdf", "jpg", "jpeg", "png"].contains(ext) else { return "\(nonempty).pdf" }
        return nonempty
    }
}

private enum QueueError: LocalizedError {
    case sharedContainerUnavailable

    var errorDescription: String? {
        "Binder’s shared document storage is unavailable."
    }
}
