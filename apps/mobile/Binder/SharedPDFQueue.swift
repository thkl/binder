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

struct DocumentBatchArchive {
    let url: URL
    let sourceFiles: [URL]

    static func create(from files: [URL]) throws -> DocumentBatchArchive {
        guard !files.isEmpty, files.count <= 20 else { throw BinderAPIError.invalidResponse }

        let archiveURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("binder-batch-\(UUID().uuidString).zip")
        let output = try FileHandle(forWritingTo: createEmptyFile(at: archiveURL))
        defer { try? output.close() }
        var completed = false
        defer {
            if !completed { try? FileManager.default.removeItem(at: archiveURL) }
        }

        var entries: [Entry] = []
        var centralDirectory = Data()
        var totalFileBytes: UInt64 = 0
        var localOffset: UInt32 = 0

        for file in files {
            let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
            guard let fileSize = attributes[.size] as? NSNumber,
                  fileSize.uint64Value > 0,
                  fileSize.uint64Value <= 50 * 1024 * 1024,
                  fileSize.uint64Value <= UInt32.max else {
                throw BinderAPIError.invalidResponse
            }
            totalFileBytes += fileSize.uint64Value
            guard totalFileBytes <= 200 * 1024 * 1024 else { throw BinderAPIError.invalidResponse }
            let name = entryName(for: file)
            guard let nameData = name.data(using: .utf8), nameData.count <= UInt16.max else {
                throw BinderAPIError.invalidResponse
            }
            let size = UInt32(fileSize.uint64Value)
            let checksum = try crc32(of: file)
            let entry = Entry(nameData: nameData, checksum: checksum, size: size, localOffset: localOffset)

            var localHeader = Data()
            localHeader.appendUInt32(0x04034b50)
            localHeader.appendUInt16(20)
            localHeader.appendUInt16(0x0800) // UTF-8 filenames, no data descriptor.
            localHeader.appendUInt16(0) // Store entries without compression.
            localHeader.appendUInt16(0)
            localHeader.appendUInt16(0x0021) // DOS date: 1980-01-01.
            localHeader.appendUInt32(checksum)
            localHeader.appendUInt32(size)
            localHeader.appendUInt32(size)
            localHeader.appendUInt16(UInt16(nameData.count))
            localHeader.appendUInt16(0)
            localHeader.append(nameData)
            try output.write(contentsOf: localHeader)

            let headerLength = UInt32(localHeader.count)
            localOffset += headerLength
            try copyFileContents(file, to: output, byteCount: size, advancing: &localOffset)
            entries.append(entry)
        }

        let centralOffset = localOffset
        for entry in entries {
            var header = Data()
            header.appendUInt32(0x02014b50)
            header.appendUInt16(20)
            header.appendUInt16(20)
            header.appendUInt16(0x0800)
            header.appendUInt16(0)
            header.appendUInt16(0)
            header.appendUInt16(0x0021)
            header.appendUInt32(entry.checksum)
            header.appendUInt32(entry.size)
            header.appendUInt32(entry.size)
            header.appendUInt16(UInt16(entry.nameData.count))
            header.appendUInt16(0)
            header.appendUInt16(0)
            header.appendUInt16(0)
            header.appendUInt16(0)
            header.appendUInt32(0)
            header.appendUInt32(entry.localOffset)
            header.append(entry.nameData)
            try output.write(contentsOf: header)
            centralDirectory.append(header)
        }

        var end = Data()
        end.appendUInt32(0x06054b50)
        end.appendUInt16(0)
        end.appendUInt16(0)
        end.appendUInt16(UInt16(entries.count))
        end.appendUInt16(UInt16(entries.count))
        end.appendUInt32(UInt32(centralDirectory.count))
        end.appendUInt32(centralOffset)
        end.appendUInt16(0)
        try output.write(contentsOf: end)
        try output.synchronize()

        completed = true
        return DocumentBatchArchive(url: archiveURL, sourceFiles: files)
    }

    private struct Entry {
        let nameData: Data
        let checksum: UInt32
        let size: UInt32
        let localOffset: UInt32
    }

    private static func createEmptyFile(at url: URL) throws -> URL {
        guard FileManager.default.createFile(atPath: url.path, contents: nil) else {
            throw BinderAPIError.invalidResponse
        }
        return url
    }

    private static func entryName(for file: URL) -> String {
        file.lastPathComponent
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "\\", with: "_")
    }

    private static func crc32(of file: URL) throws -> UInt32 {
        let input = try FileHandle(forReadingFrom: file)
        defer { try? input.close() }
        var checksum: UInt32 = 0xffffffff
        while let chunk = try input.read(upToCount: 1024 * 1024), !chunk.isEmpty {
            for byte in chunk {
                checksum = (checksum >> 8) ^ Self.crcTable[Int((checksum ^ UInt32(byte)) & 0xff)]
            }
        }
        return checksum ^ 0xffffffff
    }

    private static let crcTable: [UInt32] = (0..<256).map { value in
        var entry = UInt32(value)
        for _ in 0..<8 {
            entry = (entry & 1) == 1 ? (entry >> 1) ^ 0xedb88320 : entry >> 1
        }
        return entry
    }

    private static func copyFileContents(
        _ sourceURL: URL,
        to output: FileHandle,
        byteCount: UInt32,
        advancing offset: inout UInt32
    ) throws {
        let input = try FileHandle(forReadingFrom: sourceURL)
        defer { try? input.close() }
        var remaining = Int(byteCount)
        while remaining > 0 {
            let chunk = try input.read(upToCount: min(1024 * 1024, remaining)) ?? Data()
            guard !chunk.isEmpty else { throw BinderAPIError.invalidResponse }
            try output.write(contentsOf: chunk)
            remaining -= chunk.count
            offset += UInt32(chunk.count)
        }
    }
}

private extension Data {
    mutating func appendUInt16(_ value: UInt16) {
        var littleEndian = value.littleEndian
        Swift.withUnsafeBytes(of: &littleEndian) { append(contentsOf: $0) }
    }

    mutating func appendUInt32(_ value: UInt32) {
        var littleEndian = value.littleEndian
        Swift.withUnsafeBytes(of: &littleEndian) { append(contentsOf: $0) }
    }
}
