import Foundation

struct BinderDocumentFormat: Codable, Identifiable {
    let id: String
    let displayName: String
    let extensions: [String]
    let mimeTypes: [String]
    let capabilities: [String]

    var supportsUpload: Bool { capabilities.contains("upload") }
    func supports(_ capability: String) -> Bool { capabilities.contains(capability) }

    static let pdfFallback = BinderDocumentFormat(
        id: "pdf",
        displayName: "PDF",
        extensions: [".pdf"],
        mimeTypes: ["application/pdf"],
        capabilities: ["upload", "download", "preview", "text-extraction", "ocr", "page-count", "page-rotation", "split", "compose", "pdfa"]
    )
}

private struct DocumentFormatsResponse: Decodable {
    let formats: [BinderDocumentFormat]
}

struct BinderUser: Decodable {
    let uuid: String?
    let username: String?
    let isAdmin: Bool?
}

struct BinderShareRecipient: Decodable, Identifiable, Hashable {
    let uuid: String
    let username: String

    var id: String { uuid }
}

struct BinderShareGrant: Decodable, Identifiable {
    let uuid: String
    let recipientUuid: String
    let recipientUsername: String
    let createdAt: String

    var id: String { uuid }
}

private struct PushDevicePayload: Encodable {
    let token: String
    let environment: String?
    let deviceName: String?
}

private struct PushStatusEnvelope: Decodable {
    let data: PushStatus
    struct PushStatus: Decodable { let enabled: Bool }
}

private struct PushDeviceRegistrationEnvelope: Decodable {
    let data: PushDeviceRegistration
    struct PushDeviceRegistration: Decodable {
        let enabled: Bool
        let environment: String?
    }
}

struct BinderSearchResponse: Decodable {
    let query: String
    let total: Int
    let items: [BinderSearchResult]
}

struct BinderSearchResult: Decodable, Identifiable {
    let document: BinderSearchDocument
    let pageNumber: Int?
    let snippet: String
    let matchType: String
    let semanticScore: Double?

    var id: String { document.uuid }
}

struct BinderDocumentSummary: Decodable, Identifiable {
    let uuid: String
    let title: String?
    let originalFilename: String
    let mimeType: String?
    let pageCount: Int?
    let metadataSummary: BinderDocumentMetadataSummary?
    let status: String?
    let isNew: Bool?
    let versionNumber: Int?
    let versionParentUuid: String?
    let createdAt: String?

    var id: String { uuid }
}

struct BinderSplitDocumentResult: Decodable {
    let remainingDocument: BinderDocumentSummary
    let extractedDocument: BinderDocumentSummary
}

struct BinderComposedDocumentResult: Decodable {
    let document: BinderDocumentSummary
}

struct BinderAISuggestedIssuer: Decodable {
    let name: String
    let address: String?
    let zipCode: String?
    let city: String?
    let country: String?
    let custom: [String: BinderMetadataValue]?
}

struct BinderAISuggestion: Decodable {
    let suggestedTitle: String
    let confidence: Double
    let issuerUuid: String?
    let suggestedIssuer: BinderAISuggestedIssuer?
    let documentTypeUuid: String?
    let categoryUuid: String?
    let tagUuids: [String]
    let custom: [String: BinderMetadataValue]
    let classificationSource: String?
    let feedbackFields: [String]?
}

typealias BinderSearchDocument = BinderDocumentSummary

struct BinderFolder: Decodable, Identifiable {
    let uuid: String
    let parentUuid: String?
    let name: String
    let childCount: Int
    let documentCount: Int
    let hasChildren: Bool

    var id: String { uuid }
}

struct BinderIssuer: Decodable, Identifiable {
    let uuid: String
    let ownerUuid: String?
    var name: String
    var address: String?
    var zipCode: String?
    var city: String?
    var country: String?
    var custom: [String: BinderMetadataValue]
    var folderUuid: String?
    let createdAt: String?
    let updatedAt: String?

    var id: String { uuid }
}

extension BinderFolder {
    func path(in folders: [BinderFolder]) -> String {
        let byUUID = Dictionary(uniqueKeysWithValues: folders.map { ($0.uuid, $0) })
        var parts = [name]
        var visited: Set<String> = [uuid]
        var parent = parentUuid
        while let parentUUID = parent,
              let folder = byUUID[parentUUID],
              visited.insert(folder.uuid).inserted {
            parts.insert(folder.name, at: 0)
            parent = folder.parentUuid
        }
        return parts.joined(separator: " / ")
    }
}

struct BinderFolderDocumentPage: Decodable {
    let items: [BinderDocumentSummary]
    let page: Int
    let total: Int
    let hasNext: Bool
}

struct BinderDocumentMetadataSummary: Decodable {
    let documentType: BinderVocabularyValue?
    let category: BinderVocabularyValue?
    let issuer: BinderIssuerValue?
    let tags: [BinderVocabularyValue]?
    let custom: [BinderCustomMetadataSummary]?
}

struct BinderCustomMetadataSummary: Decodable, Identifiable {
    let key: String
    let label: String
    let value: BinderMetadataValue

    var id: String { key }
}

enum BinderMetadataValue: Codable {
    case string(String)
    case number(Double)
    case boolean(Bool)
    case object([String: BinderMetadataValue])
    case array([BinderMetadataValue])
    case null

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() {
            self = .null
        } else if let boolean = try? value.decode(Bool.self) {
            self = .boolean(boolean)
        } else if let string = try? value.decode(String.self) {
            self = .string(string)
        } else if let number = try? value.decode(Double.self) {
            self = .number(number)
        } else if let object = try? value.decode([String: BinderMetadataValue].self) {
            self = .object(object)
        } else if let array = try? value.decode([BinderMetadataValue].self) {
            self = .array(array)
        } else {
            throw DecodingError.dataCorruptedError(in: value, debugDescription: "Unsupported metadata value")
        }
    }

    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .string(let string): try value.encode(string)
        case .number(let number): try value.encode(number)
        case .boolean(let boolean): try value.encode(boolean)
        case .object(let object): try value.encode(object)
        case .array(let array): try value.encode(array)
        case .null: try value.encodeNil()
        }
    }

    var displayText: String {
        switch self {
        case .string(let value): value
        case .number(let value): value.formatted()
        case .boolean(let value): value ? "Yes" : "No"
        case .object(let values):
            values.keys.sorted().map { "\($0): \(values[$0]?.displayText ?? "")" }.joined(separator: ", ")
        case .array(let values): values.map(\.displayText).joined(separator: ", ")
        case .null: "—"
        }
    }
}

struct BinderMetadataVocabulary: Decodable {
    let documentTypes: [BinderMetadataOption]
    let categories: [BinderMetadataOption]
    let tags: [BinderMetadataOption]
}

struct BinderMetadataOption: Decodable, Identifiable {
    let uuid: String
    let name: String
    let description: String?
    let translations: [String: String]?
    let folderUuid: String?
    let active: Bool?
    let scope: String?

    var id: String { uuid }
}

struct BinderMetadataDefinition: Decodable, Identifiable {
    let uuid: String
    let key: String
    let label: String
    let type: String
    let options: [String]?
    let mandatory: Bool?
    let active: Bool?
    let scope: String?

    var id: String { key }
}

struct BinderMetadataEditorOptions: Decodable {
    let vocabulary: BinderMetadataVocabulary
    let issuers: [BinderIssuer]
    let definitions: [BinderMetadataDefinition]
}

struct BinderVocabularyValue: Decodable {
    let uuid: String?
    let name: String
}

struct BinderIssuerValue: Decodable {
    let uuid: String?
    let name: String
}

enum BinderSortDirection: String, CaseIterable, Identifiable, Codable {
    case asc
    case desc

    var id: String { rawValue }
    var label: String { self == .asc ? "Ascending" : "Descending" }
}

enum BinderGroupMode: String, CaseIterable, Identifiable, Codable {
    case none
    case documentType
    case category
    case issuer
    case tag
    case status
    case isNew

    var id: String { rawValue }
    var label: String {
        switch self {
        case .none: "None"
        case .documentType: "Document type"
        case .category: "Category"
        case .issuer: "Issuer"
        case .tag: "Tag"
        case .status: "Status"
        case .isNew: "Review state"
        }
    }
}

enum ShareResource: String, Identifiable {
    case documents
    case folders

    var id: String { rawValue }
    var path: String { rawValue }
    var title: String { self == .documents ? "Document" : "Folder" }
}

struct BinderFolderSortOptions: Codable, Equatable {
    var direction: BinderSortDirection = .desc
    var groupBy: BinderGroupMode = .none
    var groupDirection: BinderSortDirection = .asc
}

private struct SearchEnvelope: Decodable {
    let data: BinderSearchResponse
}

private struct FolderListEnvelope: Decodable {
    let data: FolderList

    struct FolderList: Decodable {
        let items: [BinderFolder]
    }
}

private struct FolderMutationEnvelope: Decodable {
    let data: BinderFolder
}

private struct DocumentListEnvelope: Decodable {
    let data: BinderFolderDocumentPage
}

private struct DocumentSummaryEnvelope: Decodable {
    let data: BinderDocumentSummary
}

private struct DocumentVersionListEnvelope: Decodable {
    let data: Items

    struct Items: Decodable {
        let items: [BinderDocumentSummary]
    }
}

private struct DocumentSplitEnvelope: Decodable {
    let data: BinderSplitDocumentResult
}

private struct DocumentSplitPayload: Encodable {
    let splitAfterPage: Int
    let autoApplySuggestions: Bool
}

private struct DocumentComposeEnvelope: Decodable {
    let data: BinderComposedDocumentResult
}

private struct DocumentComposeSourcePayload: Encodable {
    let documentUuid: String
    let startPage: Int
    let endPage: Int
}

private struct DocumentComposePayload: Encodable {
    let sources: [DocumentComposeSourcePayload]
    let insertAfterPage: Int
    let copyMetadata: Bool
    let autoApplySuggestions: Bool
}

private struct DocumentRotateEnvelope: Decodable {
    let data: RotatedDocument
    struct RotatedDocument: Decodable {
        let document: BinderDocumentSummary
    }
}

private struct DocumentVersionDeleteEnvelope: Decodable {
    let data: Result

    struct Result: Decodable {
        let currentDocument: BinderDocumentSummary
    }
}

private struct DocumentRotatePayload: Encodable {
    let pageNumber: Int
    let rotationDegrees: Int
}

private struct DocumentRequeueEnvelope: Decodable {
    let data: RequeuedDocument

    struct RequeuedDocument: Decodable {
        let document: BinderDocumentSummary
    }
}

private struct DocumentSuggestionEnvelope: Decodable {
    let data: SuggestionData

    struct SuggestionData: Decodable {
        let suggestion: BinderAISuggestion?
    }
}

private struct GeneratedSuggestionEnvelope: Decodable {
    let data: BinderAISuggestion
}

private struct ClearSuggestionEnvelope: Decodable {
    let data: ClearSuggestionResult

    struct ClearSuggestionResult: Decodable {
        let cleared: Bool
    }
}

private struct ShareRecipientsEnvelope: Decodable {
    let data: Items
    struct Items: Decodable { let items: [BinderShareRecipient] }
}

private struct ShareGrantsEnvelope: Decodable {
    let data: Items
    struct Items: Decodable { let items: [BinderShareGrant] }
}

private struct CreateSharePayload: Encodable {
    let recipientUuid: String
}

private struct MetadataVocabularyEnvelope: Decodable {
    let data: BinderMetadataVocabulary
}

private struct IssuerListEnvelope: Decodable {
    let data: Items
    struct Items: Decodable { let items: [BinderIssuer] }
}

private struct IssuerMutationEnvelope: Decodable {
    let data: BinderIssuer
}

private struct FolderCreatePayload: Encodable {
    let name: String
    let parentUuid: String?
}

private struct FolderUpdatePayload: Encodable {
    let name: String
}

private struct FolderMovePayload: Encodable {
    let parentUuid: String?

    private enum CodingKeys: String, CodingKey {
        case parentUuid
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        if let parentUuid {
            try container.encode(parentUuid, forKey: .parentUuid)
        } else {
            try container.encodeNil(forKey: .parentUuid)
        }
    }
}

struct IssuerMutationPayload: Encodable {
    let name: String
    let address: String?
    let zipCode: String?
    let city: String?
    let country: String?
    let custom: [String: BinderMetadataValue]
    let folderUuid: String?

    private enum CodingKeys: String, CodingKey {
        case name
        case address
        case zipCode
        case city
        case country
        case custom
        case folderUuid
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)
        try container.encode(address, forKey: .address)
        try container.encode(zipCode, forKey: .zipCode)
        try container.encode(city, forKey: .city)
        try container.encode(country, forKey: .country)
        try container.encode(custom, forKey: .custom)
        try container.encode(folderUuid, forKey: .folderUuid)
    }
}

private struct EmptyMutationPayload: Encodable {}

private struct MetadataDefinitionsEnvelope: Decodable {
    let data: Items
    struct Items: Decodable { let items: [BinderMetadataDefinition] }
}

enum BinderVocabularyKind: String, CaseIterable, Identifiable {
    case documentTypes = "document-types"
    case categories
    case tags

    var id: String { rawValue }
    var title: String {
        switch self {
        case .documentTypes: "Document types"
        case .categories: "Categories"
        case .tags: "Tags"
        }
    }
    var singularTitle: String {
        switch self {
        case .documentTypes: "document type"
        case .categories: "category"
        case .tags: "tag"
        }
    }
    var systemImage: String {
        switch self {
        case .documentTypes: "doc.text"
        case .categories: "square.grid.2x2"
        case .tags: "tag"
        }
    }
}

struct BinderVocabularyCreatePayload: Encodable {
    let name: String
    let description: String?
    let translations: [String: String]
    let scope: String
    let folderUuid: String?
}

struct BinderVocabularyUpdatePayload: Encodable {
    let name: String
    let description: String?
    let translations: [String: String]
    let folderUuid: String?

    private enum CodingKeys: String, CodingKey {
        case name
        case description
        case translations
        case folderUuid
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)
        try container.encode(description, forKey: .description)
        try container.encode(translations, forKey: .translations)
        try container.encode(folderUuid, forKey: .folderUuid)
    }
}

struct BinderMetadataDefinitionCreatePayload: Encodable {
    let key: String
    let label: String
    let type: String
    let options: [String]?
    let unique: Bool
    let mandatory: Bool
    let scope: String
}

struct BinderMetadataDefinitionUpdatePayload: Encodable {
    let label: String
}

private struct SetDocumentMetadataPayload: Encodable {
    let issuerUuid: String?
    let documentTypeUuid: String?
    let categoryUuid: String?
    let tagUuids: [String]
    let custom: [String: BinderMetadataValue]
}

private struct SetDocumentTitlePayload: Encodable {
    let title: String
}

private struct FolderDocumentLinkPayload: Encodable {
    let documentUuids: [String]
}

private struct LoginEnvelope: Decodable {
    let data: BinderUser
    let csrfToken: String
}

private struct SessionEnvelope: Decodable {
    let data: BinderUser?
    let csrfToken: String
}

private struct SSOStatusEnvelope: Decodable {
    let data: SSOStatus
    struct SSOStatus: Decodable { let isActive: Bool }
}

private struct APIErrorEnvelope: Decodable {
    let message: String?
}

final class BinderAPI {
    static let shared = BinderAPI()

    private(set) var csrfToken: String?
    private let urlSession: URLSession

    init(urlSession: URLSession? = nil) {
        if let urlSession {
            self.urlSession = urlSession
        } else {
            let configuration = URLSessionConfiguration.default
            configuration.httpCookieStorage = nil
            configuration.httpShouldSetCookies = false
            self.urlSession = URLSession(configuration: configuration)
        }
    }

    func isSSOActive(serverURL: String) async throws -> Bool {
        let (data, _) = try await request(path: "ssoauth/active", serverURL: serverURL)
        return try JSONDecoder().decode(SSOStatusEnvelope.self, from: data).data.isActive
    }

    func folders(serverURL: String, parentUUID: String? = nil) async throws -> [BinderFolder] {
        var request = try makeRequest(path: "folders", serverURL: serverURL, method: "GET")
        if let parentUUID {
            guard let url = request.url,
                  var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
                throw BinderAPIError.invalidServerURL
            }
            components.queryItems = [URLQueryItem(name: "parentUuid", value: parentUUID)]
            guard let foldersURL = components.url else { throw BinderAPIError.invalidServerURL }
            request.url = foldersURL
        }

        let (data, response) = try await urlSession.data(for: request)
        try absorbSessionCookie(from: response, for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(FolderListEnvelope.self, from: data).data.items
    }

    func allFolders(serverURL: String) async throws -> [BinderFolder] {
        let (data, _) = try await request(path: "folders/all", serverURL: serverURL)
        return try JSONDecoder().decode(FolderListEnvelope.self, from: data).data.items
    }

    func shareRecipients(serverURL: String) async throws -> [BinderShareRecipient] {
        let (data, _) = try await request(path: "shares/recipients", serverURL: serverURL)
        return try JSONDecoder().decode(ShareRecipientsEnvelope.self, from: data).data.items
    }

    func shares(serverURL: String, resource: ShareResource, uuid: String) async throws -> [BinderShareGrant] {
        let (data, _) = try await request(path: "shares/\(resource.path)/\(uuid)", serverURL: serverURL)
        return try JSONDecoder().decode(ShareGrantsEnvelope.self, from: data).data.items
    }

    func addShare(serverURL: String, resource: ShareResource, uuid: String, recipientUUID: String) async throws -> [BinderShareGrant] {
        let data = try await mutate(
            path: "shares/\(resource.path)/\(uuid)",
            serverURL: serverURL,
            method: "POST",
            payload: CreateSharePayload(recipientUuid: recipientUUID)
        )
        return try JSONDecoder().decode(ShareGrantsEnvelope.self, from: data).data.items
    }

    func removeShare(serverURL: String, resource: ShareResource, uuid: String, recipientUUID: String) async throws -> [BinderShareGrant] {
        let data = try await mutate(
            path: "shares/\(resource.path)/\(uuid)/\(recipientUUID)",
            serverURL: serverURL,
            method: "DELETE",
            payload: EmptyMutationPayload()
        )
        return try JSONDecoder().decode(ShareGrantsEnvelope.self, from: data).data.items
    }

    func createFolder(serverURL: String, name: String, parentUUID: String?) async throws -> BinderFolder {
        let payload = FolderCreatePayload(name: name, parentUuid: parentUUID)
        let data = try await mutate(path: "folders", serverURL: serverURL, method: "POST", payload: payload)
        return try JSONDecoder().decode(FolderMutationEnvelope.self, from: data).data
    }

    func updateFolder(serverURL: String, uuid: String, name: String) async throws -> BinderFolder {
        let payload = FolderUpdatePayload(name: name)
        let data = try await mutate(path: "folders/\(uuid)", serverURL: serverURL, method: "PATCH", payload: payload)
        return try JSONDecoder().decode(FolderMutationEnvelope.self, from: data).data
    }

    func moveFolder(serverURL: String, uuid: String, parentUUID: String?) async throws -> BinderFolder {
        let payload = FolderMovePayload(parentUuid: parentUUID)
        let data = try await mutate(path: "folders/\(uuid)/move", serverURL: serverURL, method: "POST", payload: payload)
        return try JSONDecoder().decode(FolderMutationEnvelope.self, from: data).data
    }

    func deleteFolder(serverURL: String, uuid: String) async throws {
        _ = try await mutate(path: "folders/\(uuid)", serverURL: serverURL, method: "DELETE", payload: EmptyMutationPayload())
    }

    func foldersForDocument(serverURL: String, documentUUID: String) async throws -> [BinderFolder] {
        let (data, _) = try await request(
            path: "folders/for-document/\(documentUUID)",
            serverURL: serverURL
        )
        return try JSONDecoder().decode(FolderListEnvelope.self, from: data).data.items
    }

    func updateDocumentFolders(
        serverURL: String,
        documentUUID: String,
        selectedFolderUUIDs: Set<String>,
        originalFolderUUIDs: Set<String>
    ) async throws {
        let additions = selectedFolderUUIDs.subtracting(originalFolderUUIDs).sorted()
        let removals = originalFolderUUIDs.subtracting(selectedFolderUUIDs).sorted()
        for folderUUID in additions {
            try await changeDocumentFolderLink(
                serverURL: serverURL,
                folderUUID: folderUUID,
                documentUUID: documentUUID,
                remove: false
            )
        }
        for folderUUID in removals {
            try await changeDocumentFolderLink(
                serverURL: serverURL,
                folderUUID: folderUUID,
                documentUUID: documentUUID,
                remove: true
            )
        }
    }

    private func changeDocumentFolderLink(
        serverURL: String,
        folderUUID: String,
        documentUUID: String,
        remove: Bool
    ) async throws {
        guard let csrfToken = csrfToken ?? KeychainStore.csrfToken(origin: origin(for: serverURL)) else {
            throw BinderAPIError.loginRequired
        }
        var request = try makeRequest(
            path: "folders/\(folderUUID)/documents",
            serverURL: serverURL,
            method: remove ? "DELETE" : "POST"
        )
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(csrfToken, forHTTPHeaderField: "X-CSRF-Token")
        request.httpBody = try JSONEncoder().encode(FolderDocumentLinkPayload(documentUuids: [documentUUID]))
        let (data, response) = try await urlSession.data(for: request)
        try absorbSessionCookie(from: response, for: request)
        try validate(response, data: data)
    }

    func documentsInFolder(
        serverURL: String,
        folderUUID: String,
        page: Int = 1,
        pageSize: Int = 25,
        sortDirection: BinderSortDirection = .desc,
        groupBy: BinderGroupMode = .none,
        groupDirection: BinderSortDirection = .asc
    ) async throws -> BinderFolderDocumentPage {
        var request = try makeRequest(path: "documents", serverURL: serverURL, method: "GET")
        guard let url = request.url,
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            throw BinderAPIError.invalidServerURL
        }
        components.queryItems = [
            URLQueryItem(name: "folderUuid", value: folderUUID),
            URLQueryItem(name: "page", value: String(page)),
            URLQueryItem(name: "pageSize", value: String(pageSize)),
            URLQueryItem(name: "sort", value: "createdAt"),
            URLQueryItem(name: "direction", value: sortDirection.rawValue),
            URLQueryItem(name: "groupBy", value: groupBy.rawValue),
            URLQueryItem(name: "groupDirection", value: groupDirection.rawValue),
        ]
        guard let documentsURL = components.url else { throw BinderAPIError.invalidServerURL }
        request.url = documentsURL

        let (data, response) = try await urlSession.data(for: request)
        try absorbSessionCookie(from: response, for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(DocumentListEnvelope.self, from: data).data
    }

    func browseDocuments(
        serverURL: String,
        folderUUID: String? = nil,
        unassigned: Bool = false,
        newOnly: Bool = false,
        page: Int = 1,
        pageSize: Int = 25
    ) async throws -> BinderFolderDocumentPage {
        var request = try makeRequest(path: "documents", serverURL: serverURL, method: "GET")
        guard let url = request.url,
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            throw BinderAPIError.invalidServerURL
        }

        var queryItems = [
            URLQueryItem(name: "page", value: String(page)),
            URLQueryItem(name: "pageSize", value: String(pageSize)),
            URLQueryItem(name: "sort", value: "createdAt"),
            URLQueryItem(name: "direction", value: "desc"),
        ]
        if let folderUUID {
            queryItems.append(URLQueryItem(name: "folderUuid", value: folderUUID))
        }
        if unassigned {
            queryItems.append(URLQueryItem(name: "unassigned", value: "true"))
        }
        if newOnly {
            queryItems.append(URLQueryItem(name: "reviewStates", value: "new"))
        }
        components.queryItems = queryItems
        guard let documentsURL = components.url else { throw BinderAPIError.invalidServerURL }
        request.url = documentsURL

        let (data, response) = try await urlSession.data(for: request)
        try absorbSessionCookie(from: response, for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(DocumentListEnvelope.self, from: data).data
    }

    func ownedDocuments(
        serverURL: String,
        query: String,
        page: Int = 1,
        pageSize: Int = 50
    ) async throws -> BinderFolderDocumentPage {
        var request = try makeRequest(path: "documents", serverURL: serverURL, method: "GET")
        guard let url = request.url,
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            throw BinderAPIError.invalidServerURL
        }
        components.queryItems = [
            URLQueryItem(name: "page", value: String(page)),
            URLQueryItem(name: "pageSize", value: String(pageSize)),
            URLQueryItem(name: "sort", value: "title"),
            URLQueryItem(name: "direction", value: "asc"),
            URLQueryItem(name: "q", value: query.isEmpty ? nil : query),
        ]
        guard let documentsURL = components.url else { throw BinderAPIError.invalidServerURL }
        request.url = documentsURL

        let (data, response) = try await urlSession.data(for: request)
        try absorbSessionCookie(from: response, for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(DocumentListEnvelope.self, from: data).data
    }

    func metadataEditorOptions(serverURL: String) async throws -> BinderMetadataEditorOptions {
        let (vocabularyData, _) = try await request(path: "metadata/vocabulary", serverURL: serverURL)
        let (issuerData, _) = try await request(path: "issuers", serverURL: serverURL)
        let (definitionsData, _) = try await request(path: "metadata/definitions", serverURL: serverURL)
        return BinderMetadataEditorOptions(
            vocabulary: try JSONDecoder().decode(MetadataVocabularyEnvelope.self, from: vocabularyData).data,
            issuers: try JSONDecoder().decode(IssuerListEnvelope.self, from: issuerData).data.items,
            definitions: try JSONDecoder().decode(MetadataDefinitionsEnvelope.self, from: definitionsData).data.items.filter { $0.active != false }
        )
    }

    func createVocabulary(
        serverURL: String,
        kind: BinderVocabularyKind,
        payload: BinderVocabularyCreatePayload
    ) async throws {
        _ = try await mutate(
            path: "metadata/vocabulary/\(kind.rawValue)",
            serverURL: serverURL,
            method: "POST",
            payload: payload
        )
    }

    func updateVocabulary(
        serverURL: String,
        kind: BinderVocabularyKind,
        uuid: String,
        payload: BinderVocabularyUpdatePayload
    ) async throws {
        _ = try await mutate(
            path: "metadata/vocabulary/\(kind.rawValue)/\(uuid)",
            serverURL: serverURL,
            method: "PATCH",
            payload: payload
        )
    }

    func cloneVocabulary(serverURL: String, kind: BinderVocabularyKind, uuid: String) async throws {
        _ = try await mutate(
            path: "metadata/vocabulary/\(kind.rawValue)/\(uuid)/clone",
            serverURL: serverURL,
            method: "POST",
            payload: EmptyMutationPayload()
        )
    }

    func deleteVocabulary(serverURL: String, kind: BinderVocabularyKind, uuid: String) async throws {
        _ = try await mutate(
            path: "metadata/vocabulary/\(kind.rawValue)/\(uuid)",
            serverURL: serverURL,
            method: "DELETE",
            payload: EmptyMutationPayload()
        )
    }

    func createMetadataDefinition(
        serverURL: String,
        payload: BinderMetadataDefinitionCreatePayload
    ) async throws {
        _ = try await mutate(path: "metadata/definitions", serverURL: serverURL, method: "POST", payload: payload)
    }

    func updateMetadataDefinition(
        serverURL: String,
        uuid: String,
        payload: BinderMetadataDefinitionUpdatePayload
    ) async throws {
        _ = try await mutate(path: "metadata/definitions/\(uuid)", serverURL: serverURL, method: "PATCH", payload: payload)
    }

    func deleteMetadataDefinition(serverURL: String, uuid: String) async throws {
        _ = try await mutate(
            path: "metadata/definitions/\(uuid)",
            serverURL: serverURL,
            method: "DELETE",
            payload: EmptyMutationPayload()
        )
    }

    func issuers(serverURL: String) async throws -> [BinderIssuer] {
        let (data, _) = try await request(path: "issuers", serverURL: serverURL)
        return try JSONDecoder().decode(IssuerListEnvelope.self, from: data).data.items
    }

    func createIssuer(serverURL: String, payload: IssuerMutationPayload) async throws -> BinderIssuer {
        let data = try await mutate(path: "issuers", serverURL: serverURL, method: "POST", payload: payload)
        return try JSONDecoder().decode(IssuerMutationEnvelope.self, from: data).data
    }

    func updateIssuer(serverURL: String, uuid: String, payload: IssuerMutationPayload) async throws -> BinderIssuer {
        let data = try await mutate(path: "issuers/\(uuid)", serverURL: serverURL, method: "PATCH", payload: payload)
        return try JSONDecoder().decode(IssuerMutationEnvelope.self, from: data).data
    }

    func updateDocumentMetadata(
        serverURL: String,
        documentUUID: String,
        issuerUUID: String?,
        documentTypeUUID: String?,
        categoryUUID: String?,
        tagUUIDs: [String],
        custom: [String: BinderMetadataValue]
    ) async throws {
        guard let csrfToken = csrfToken ?? KeychainStore.csrfToken(origin: origin(for: serverURL)) else {
            throw BinderAPIError.loginRequired
        }
        let payload = SetDocumentMetadataPayload(
            issuerUuid: issuerUUID,
            documentTypeUuid: documentTypeUUID,
            categoryUuid: categoryUUID,
            tagUuids: tagUUIDs,
            custom: custom
        )
        var request = try makeRequest(path: "documents/\(documentUUID)/metadata", serverURL: serverURL, method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(csrfToken, forHTTPHeaderField: "X-CSRF-Token")
        request.httpBody = try JSONEncoder().encode(payload)
        let (data, response) = try await urlSession.data(for: request)
        try absorbSessionCookie(from: response, for: request)
        try validate(response, data: data)
    }

    func updateDocumentTitle(serverURL: String, documentUUID: String, title: String) async throws {
        guard let csrfToken = csrfToken ?? KeychainStore.csrfToken(origin: origin(for: serverURL)) else {
            throw BinderAPIError.loginRequired
        }
        var request = try makeRequest(path: "documents/\(documentUUID)/title", serverURL: serverURL, method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(csrfToken, forHTTPHeaderField: "X-CSRF-Token")
        request.httpBody = try JSONEncoder().encode(SetDocumentTitlePayload(title: title))
        let (data, response) = try await urlSession.data(for: request)
        try absorbSessionCookie(from: response, for: request)
        try validate(response, data: data)
    }

    func documentSummary(serverURL: String, documentUUID: String) async throws -> BinderDocumentSummary {
        let (data, _) = try await request(path: "documents/\(documentUUID)", serverURL: serverURL)
        return try JSONDecoder().decode(DocumentSummaryEnvelope.self, from: data).data
    }

    func deleteDocument(serverURL: String, documentUUID: String) async throws {
        _ = try await mutate(
            path: "documents/\(documentUUID)",
            serverURL: serverURL,
            method: "DELETE",
            payload: EmptyMutationPayload()
        )
    }

    func deleteDocumentOrVersion(
        serverURL: String,
        documentUUID: String
    ) async throws -> BinderDocumentSummary? {
        let versions = try await documentVersions(serverURL: serverURL, documentUUID: documentUUID)
        if versions.count > 1 {
            return try await deleteDocumentVersion(serverURL: serverURL, documentUUID: documentUUID)
        }
        try await deleteDocument(serverURL: serverURL, documentUUID: documentUUID)
        return nil
    }

    func documentVersions(serverURL: String, documentUUID: String) async throws -> [BinderDocumentSummary] {
        let (data, _) = try await request(
            path: "documents/\(documentUUID)/versions",
            serverURL: serverURL
        )
        return try JSONDecoder().decode(DocumentVersionListEnvelope.self, from: data).data.items
    }

    func deleteDocumentVersion(serverURL: String, documentUUID: String) async throws -> BinderDocumentSummary {
        let data = try await mutate(
            path: "documents/\(documentUUID)/version",
            serverURL: serverURL,
            method: "DELETE",
            payload: EmptyMutationPayload()
        )
        return try JSONDecoder().decode(DocumentVersionDeleteEnvelope.self, from: data).data.currentDocument
    }

    func splitDocument(
        serverURL: String,
        documentUUID: String,
        splitAfterPage: Int,
        autoApplySuggestions: Bool
    ) async throws -> BinderSplitDocumentResult {
        let data = try await mutate(
            path: "documents/\(documentUUID)/split",
            serverURL: serverURL,
            method: "POST",
            payload: DocumentSplitPayload(
                splitAfterPage: splitAfterPage,
                autoApplySuggestions: autoApplySuggestions
            )
        )
        return try JSONDecoder().decode(DocumentSplitEnvelope.self, from: data).data
    }

    func composeDocuments(
        serverURL: String,
        targetDocumentUUID: String,
        sources: [(documentUUID: String, startPage: Int, endPage: Int)],
        insertAfterPage: Int,
        copyMetadata: Bool,
        autoApplySuggestions: Bool
    ) async throws -> BinderDocumentSummary {
        let data = try await mutate(
            path: "documents/\(targetDocumentUUID)/compose",
            serverURL: serverURL,
            method: "POST",
            payload: DocumentComposePayload(
                sources: sources.map {
                    DocumentComposeSourcePayload(
                        documentUuid: $0.documentUUID,
                        startPage: $0.startPage,
                        endPage: $0.endPage
                    )
                },
                insertAfterPage: insertAfterPage,
                copyMetadata: copyMetadata,
                autoApplySuggestions: autoApplySuggestions
            )
        )
        return try JSONDecoder().decode(DocumentComposeEnvelope.self, from: data).data.document
    }

    func rotateDocumentPage(
        serverURL: String,
        documentUUID: String,
        pageNumber: Int,
        rotationDegrees: Int
    ) async throws -> BinderDocumentSummary {
        guard pageNumber > 0, [-90, 90, 180].contains(rotationDegrees) else {
            throw BinderAPIError.invalidResponse
        }
        let data = try await mutate(
            path: "documents/\(documentUUID)/rotate",
            serverURL: serverURL,
            method: "POST",
            payload: DocumentRotatePayload(
                pageNumber: pageNumber,
                rotationDegrees: rotationDegrees
            )
        )
        return try JSONDecoder().decode(DocumentRotateEnvelope.self, from: data).data.document
    }

    func requeueDocument(serverURL: String, documentUUID: String) async throws -> BinderDocumentSummary {
        let data = try await mutate(
            path: "documents/\(documentUUID)/pipeline/requeue",
            serverURL: serverURL,
            method: "POST",
            payload: EmptyMutationPayload()
        )
        return try JSONDecoder().decode(DocumentRequeueEnvelope.self, from: data).data.document
    }

    func documentSuggestion(serverURL: String, documentUUID: String) async throws -> BinderAISuggestion? {
        let (data, _) = try await request(
            path: "documents/\(documentUUID)/metadata",
            serverURL: serverURL
        )
        return try JSONDecoder().decode(DocumentSuggestionEnvelope.self, from: data).data.suggestion
    }

    func suggestDocumentMetadata(serverURL: String, documentUUID: String) async throws -> BinderAISuggestion {
        let data = try await mutate(
            path: "documents/\(documentUUID)/title/suggest",
            serverURL: serverURL,
            method: "POST",
            payload: EmptyMutationPayload()
        )
        return try JSONDecoder().decode(GeneratedSuggestionEnvelope.self, from: data).data
    }

    func clearDocumentSuggestion(serverURL: String, documentUUID: String) async throws -> Bool {
        let data = try await mutate(
            path: "documents/\(documentUUID)/ai-suggestion",
            serverURL: serverURL,
            method: "DELETE",
            payload: EmptyMutationPayload()
        )
        return try JSONDecoder().decode(ClearSuggestionEnvelope.self, from: data).data.cleared
    }

    func search(serverURL: String, query: String, limit: Int = 20) async throws -> BinderSearchResponse {
        var request = try makeRequest(path: "documents/search", serverURL: serverURL, method: "GET")
        guard let url = request.url,
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            throw BinderAPIError.invalidServerURL
        }
        components.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "semanticThreshold", value: "0.35")
        ]
        guard let searchURL = components.url else { throw BinderAPIError.invalidServerURL }
        request.url = searchURL
        let (data, response) = try await urlSession.data(for: request)
        try absorbSessionCookie(from: response, for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(SearchEnvelope.self, from: data).data
    }

    func thumbnail(serverURL: String, documentUUID: String) async throws -> Data {
        let (data, _) = try await request(path: "documents/\(documentUUID)/thumbnail", serverURL: serverURL)
        return data
    }

    func documentFile(serverURL: String, documentUUID: String) async throws -> Data {
        let (data, _) = try await request(path: "documents/\(documentUUID)/file", serverURL: serverURL)
        return data
    }

    func supportedDocumentFormats(serverURL: String) async throws -> [BinderDocumentFormat] {
        let (data, _) = try await request(path: "document-formats", serverURL: serverURL)
        let formats = try JSONDecoder().decode(DocumentFormatsResponse.self, from: data).formats
        guard !formats.isEmpty else { throw BinderAPIError.invalidResponse }
        cacheDocumentFormats(formats, serverURL: serverURL)
        return formats
    }

    func uploadDocument(serverURL: String, fileURL: URL) async throws {
        var hasSession = false
        do {
            hasSession = try await currentUser(serverURL: serverURL) != nil
        } catch let error as URLError {
            throw error
        } catch {
            // The server rejected the session; try the opted-in password below.
        }
        if !hasSession { try await signInWithSavedPassword(serverURL: serverURL) }

        let formats: [BinderDocumentFormat]
        do {
            formats = try await supportedDocumentFormats(serverURL: serverURL)
        } catch {
            // Older servers may not expose discovery. Let their upload endpoint make the final decision.
            if let cached = cachedDocumentFormats(serverURL: serverURL), cached.contains(where: {
                $0.supportsUpload
            }) {
                formats = cached
            } else {
                formats = [.pdfFallback]
            }
        }
        guard let mimeType = detectedDocumentMimeType(at: fileURL) else {
            throw BinderAPIError.unsupportedDocumentFormat
        }
        guard formats.contains(where: {
            $0.supportsUpload && $0.mimeTypes.contains(where: { $0.caseInsensitiveCompare(mimeType) == .orderedSame })
        }) else { throw BinderAPIError.unsupportedDocumentFormat }

        guard let cookie = KeychainStore.sessionCookie(origin: origin(for: serverURL)),
              let csrfToken = csrfToken ?? KeychainStore.csrfToken(origin: origin(for: serverURL)) else {
            throw BinderAPIError.loginRequired
        }

        let boundary = "Binder-\(UUID().uuidString)"
        let safeFilename = fileURL.lastPathComponent
            .replacingOccurrences(of: "\"", with: "_")
            .replacingOccurrences(of: "\r", with: "_")
            .replacingOccurrences(of: "\n", with: "_")
        let bodyURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("binder-upload-\(UUID().uuidString).multipart")
        defer { try? FileManager.default.removeItem(at: bodyURL) }

        guard FileManager.default.createFile(atPath: bodyURL.path, contents: nil) else {
            throw BinderAPIError.invalidResponse
        }
        let output = try FileHandle(forWritingTo: bodyURL)
        defer { try? output.close() }
        try output.write(contentsOf: Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(safeFilename)\"\r\nContent-Type: \(mimeType)\r\n\r\n".utf8))

        let input = try FileHandle(forReadingFrom: fileURL)
        defer { try? input.close() }
        while let chunk = try input.read(upToCount: 1024 * 1024), !chunk.isEmpty {
            try output.write(contentsOf: chunk)
        }
        try output.write(contentsOf: Data("\r\n--\(boundary)--\r\n".utf8))
        try output.synchronize()

        var request = try makeRequest(path: "documents", serverURL: serverURL, method: "POST")
        request.timeoutInterval = 120
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(csrfToken, forHTTPHeaderField: "X-CSRF-Token")
        request.setValue(cookie, forHTTPHeaderField: "Cookie")
        let (data, response) = try await urlSession.upload(for: request, fromFile: bodyURL)
        try absorbSessionCookie(from: response, for: request)
        try validate(response, data: data)
    }

    private func detectedDocumentMimeType(at fileURL: URL) -> String? {
        guard let input = try? FileHandle(forReadingFrom: fileURL) else { return nil }
        defer { try? input.close() }
        guard let header = try? input.read(upToCount: 1024), !header.isEmpty else { return nil }
        if header.range(of: Data("%PDF-".utf8)) != nil { return "application/pdf" }
        if header.starts(with: Data([137, 80, 78, 71, 13, 10, 26, 10])) { return "image/png" }
        if header.count >= 3 && header[0] == 0xff && header[1] == 0xd8 && header[2] == 0xff {
            return "image/jpeg"
        }
        return nil
    }

    func login(serverURL: String, username: String, password: String) async throws -> BinderUser {
        let body = try JSONSerialization.data(withJSONObject: ["username": username, "password": password])
        var request = try makeRequest(path: "auth/native/login", serverURL: serverURL, method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let (data, response) = try await urlSession.data(for: request)
        try absorbSessionCookie(from: response, for: request)
        try validate(response, data: data)
        let envelope = try JSONDecoder().decode(LoginEnvelope.self, from: data)
        csrfToken = envelope.csrfToken
        try saveSessionCookieAndCSRF(envelope.csrfToken, serverURL: serverURL)
        return envelope.data
    }

    func currentUser(serverURL: String) async throws -> BinderUser? {
        let (data, _) = try await request(path: "auth/session", serverURL: serverURL)
        let envelope = try JSONDecoder().decode(SessionEnvelope.self, from: data)
        csrfToken = envelope.csrfToken
        if let cookie = KeychainStore.sessionCookie(origin: origin(for: serverURL)) {
            try KeychainStore.saveSession(
                cookie: cookie,
                csrfToken: envelope.csrfToken,
                origin: origin(for: serverURL)
            )
        }
        return envelope.data
    }

    func exchangeSSOCode(serverURL: String, code: String, verifier: String) async throws -> BinderUser {
        let body = try JSONSerialization.data(withJSONObject: ["code": code, "codeVerifier": verifier])
        var request = try makeRequest(path: "auth/native/sso/exchange", serverURL: serverURL, method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let (data, response) = try await urlSession.data(for: request)
        try absorbSessionCookie(from: response, for: request)
        try validate(response, data: data)
        let envelope = try JSONDecoder().decode(LoginEnvelope.self, from: data)
        csrfToken = envelope.csrfToken
        try saveSessionCookieAndCSRF(envelope.csrfToken, serverURL: serverURL)
        return envelope.data
    }

    func logout(serverURL: String) async throws {
        var request = try makeRequest(path: "auth/logout", serverURL: serverURL, method: "POST")
        if let csrfToken = csrfToken ?? KeychainStore.csrfToken(origin: origin(for: serverURL)) {
            request.setValue(csrfToken, forHTTPHeaderField: "X-CSRF-Token")
        }
        let (data, response) = try await urlSession.data(for: request)
        try absorbSessionCookie(from: response, for: request)
        try validate(response, data: data)
        csrfToken = nil
        KeychainStore.deleteSession(origin: origin(for: serverURL))
    }

    func registerPushDevice(serverURL: String, token: String, environment: String, deviceName: String) async throws {
        _ = try await mutate(path: "notifications/devices", serverURL: serverURL, method: "POST",
                             payload: PushDevicePayload(token: token, environment: environment, deviceName: deviceName))
    }

    func pushNotificationsEnabled(serverURL: String) async throws -> Bool {
        let (data, _) = try await request(path: "notifications/status", serverURL: serverURL)
        return try JSONDecoder().decode(PushStatusEnvelope.self, from: data).data.enabled
    }

    func pushDeviceRegistration(serverURL: String, token: String) async throws -> (enabled: Bool, environment: String?) {
        let data = try await mutate(path: "notifications/devices/status", serverURL: serverURL, method: "POST",
                                    payload: PushDevicePayload(token: token, environment: nil, deviceName: nil))
        let registration = try JSONDecoder().decode(PushDeviceRegistrationEnvelope.self, from: data).data
        return (registration.enabled, registration.environment)
    }

    func unregisterPushDevice(serverURL: String, token: String) async throws {
        _ = try await mutate(path: "notifications/devices", serverURL: serverURL, method: "DELETE",
                             payload: PushDevicePayload(token: token, environment: nil, deviceName: nil))
    }

    func clearCookies(serverURL: String) {
        KeychainStore.deleteSession(origin: origin(for: serverURL))
        csrfToken = nil
    }

    private func cacheDocumentFormats(_ formats: [BinderDocumentFormat], serverURL: String) {
        guard let data = try? JSONEncoder().encode(formats) else { return }
        UserDefaults.standard.set(data, forKey: documentFormatsCacheKey(serverURL: serverURL))
    }

    private func cachedDocumentFormats(serverURL: String) -> [BinderDocumentFormat]? {
        guard let data = UserDefaults.standard.data(forKey: documentFormatsCacheKey(serverURL: serverURL)) else {
            return nil
        }
        return try? JSONDecoder().decode([BinderDocumentFormat].self, from: data)
    }

    private func documentFormatsCacheKey(serverURL: String) -> String {
        "binder.documentFormats.\(origin(for: serverURL))"
    }

    private func request(path: String, serverURL: String) async throws -> (Data, URLResponse) {
        let request = try makeRequest(path: path, serverURL: serverURL, method: "GET")
        let (data, response) = try await urlSession.data(for: request)
        try absorbSessionCookie(from: response, for: request)
        try validate(response, data: data)
        return (data, response)
    }

    private func mutate<Payload: Encodable>(
        path: String,
        serverURL: String,
        method: String,
        payload: Payload
    ) async throws -> Data {
        guard let csrfToken = csrfToken ?? KeychainStore.csrfToken(origin: origin(for: serverURL)) else {
            throw BinderAPIError.loginRequired
        }
        var request = try makeRequest(path: path, serverURL: serverURL, method: method)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(csrfToken, forHTTPHeaderField: "X-CSRF-Token")
        request.httpBody = try JSONEncoder().encode(payload)
        let (data, response) = try await urlSession.data(for: request)
        try absorbSessionCookie(from: response, for: request)
        try validate(response, data: data)
        return data
    }

    private func makeRequest(path: String, serverURL: String, method: String) throws -> URLRequest {
        guard var components = URLComponents(string: serverURL.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = components.scheme?.lowercased(), ["http", "https"].contains(scheme),
              components.host != nil, components.user == nil, components.password == nil else {
            throw BinderAPIError.invalidServerURL
        }
        components.path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.path += "/api/v1/" + path
        guard let url = components.url else { throw BinderAPIError.invalidServerURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let cookie = KeychainStore.sessionCookie(origin: origin(for: serverURL)) {
            request.setValue(cookie, forHTTPHeaderField: "Cookie")
        }
        return request
    }

    private func absorbSessionCookie(from response: URLResponse, for request: URLRequest) throws {
        guard let response = response as? HTTPURLResponse, let url = request.url else { return }
        var headers: [String: String] = [:]
        for (key, value) in response.allHeaderFields {
            guard let key = key as? String else { continue }
            headers[key] = String(describing: value)
        }
        guard let cookie = HTTPCookie.cookies(withResponseHeaderFields: headers, for: url)
            .first(where: { $0.name == "connect.sid" }) else { return }
        let responseOrigin = origin(for: url.absoluteString)
        guard cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))
            .caseInsensitiveCompare(url.host ?? "") == .orderedSame else {
            throw BinderAPIError.invalidResponse
        }
        guard !cookie.isSecure || url.scheme?.lowercased() == "https" else { return }
        if cookie.expiresDate.map({ $0 <= Date() }) == true {
            KeychainStore.deleteSession(origin: responseOrigin)
        } else {
            try KeychainStore.saveSession(cookie: "\(cookie.name)=\(cookie.value)", csrfToken: nil, origin: responseOrigin)
        }
    }

    private func saveSessionCookieAndCSRF(_ token: String, serverURL: String) throws {
        guard let cookie = KeychainStore.sessionCookie(origin: origin(for: serverURL)) else {
            throw BinderAPIError.sessionCookieMissing
        }
        try KeychainStore.saveSession(cookie: cookie, csrfToken: token, origin: origin(for: serverURL))
    }

    private func signInWithSavedPassword(serverURL: String) async throws {
        guard AppSettings.remembersPassword,
              let password = KeychainStore.password(),
              !AppSettings.savedUsername.isEmpty else {
            throw BinderAPIError.loginRequired
        }
        _ = try await login(serverURL: serverURL, username: AppSettings.savedUsername, password: password)
    }

    private func origin(for serverURL: String) -> String {
        guard let components = URLComponents(string: serverURL),
              let scheme = components.scheme, let host = components.host else { return serverURL }
        let port = components.port.map { ":\($0)" } ?? ""
        return "\(scheme.lowercased())://\(host.lowercased())\(port)"
    }

    private func validate(_ response: URLResponse, data: Data) throws {
        guard let response = response as? HTTPURLResponse else { throw BinderAPIError.invalidResponse }
        guard (200..<300).contains(response.statusCode) else {
            let apiMessage = try? JSONDecoder().decode(APIErrorEnvelope.self, from: data).message
            throw BinderAPIError.server(apiMessage ?? HTTPURLResponse.localizedString(forStatusCode: response.statusCode))
        }
    }
}

enum BinderAPIError: LocalizedError {
    case invalidServerURL
    case invalidResponse
    case server(String)
    case invalidSSOCallback
    case ssoCouldNotStart
    case ssoNotConfigured
    case sessionCookieMissing
    case loginRequired
    case unsupportedDocumentFormat

    var errorDescription: String? {
        switch self {
        case .invalidServerURL: "Enter a complete server URL, including http:// or https://."
        case .invalidResponse: "The server returned an invalid response."
        case .server(let message): message
        case .invalidSSOCallback: "The SSO sign-in response could not be verified. Please try again."
        case .ssoCouldNotStart: "The system sign-in window could not be opened."
        case .ssoNotConfigured: "Single sign-on is not configured on this server."
        case .sessionCookieMissing: "The server did not establish a session. Check the server URL and cookie configuration."
        case .loginRequired: "Open Binder and sign in before uploading this document."
        case .unsupportedDocumentFormat: "This server does not currently support this document format. The document remains queued on this device."
        }

    }
}
