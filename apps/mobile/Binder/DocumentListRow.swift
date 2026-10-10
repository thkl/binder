import SwiftUI
import UIKit

struct DocumentListRow: View {
    let document: BinderDocumentSummary
    let serverURL: String
    let snippet: String?
    let footer: String?

    @State private var thumbnail: UIImage?

    init(
        document: BinderDocumentSummary,
        serverURL: String,
        snippet: String? = nil,
        footer: String? = nil
    ) {
        self.document = document
        self.serverURL = serverURL
        self.snippet = snippet
        self.footer = footer
    }

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
                Text(document.originalFilename)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                if let snippet = snippet?.nilIfBlank {
                    Text(snippet)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                let metadata = [
                    document.metadataSummary?.documentType?.name,
                    document.metadataSummary?.category?.name,
                    document.metadataSummary?.issuer?.name,
                ].compactMap { $0?.nilIfBlank }
                if !metadata.isEmpty {
                    Text(metadata.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(Color.accentColor)
                        .lineLimit(1)
                }

                if let footer = footer?.nilIfBlank {
                    Text(footer)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .task(id: "\(serverURL)-\(document.uuid)") {
            do {
                let data = try await BinderAPI.shared.thumbnail(
                    serverURL: serverURL,
                    documentUUID: document.uuid
                )
                thumbnail = UIImage(data: data)
            } catch {
                // Some documents do not have a generated thumbnail yet.
            }
        }
    }

    private var displayTitle: String {
        document.title?.nilIfBlank ?? document.originalFilename
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
