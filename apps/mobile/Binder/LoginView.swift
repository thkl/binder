import SwiftUI
import UIKit

struct LoginView: View {
    @ObservedObject var model: AuthViewModel
    @FocusState private var focusedField: Field?

    private enum Field: Hashable { case server, username, password }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    serverSection
                    signInSection
                    if let error = model.errorMessage {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.subheadline)
                            .foregroundStyle(.red)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("login-error")
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 28)
                .padding(.bottom, 32)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("Sign in")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 34, weight: .medium))
                .foregroundStyle(Color.accentColor)
                .accessibilityHidden(true)
            Text("Binder")
                .font(.largeTitle.bold())
            Text("Sign in to search and read your documents.")
                .font(.body)
                .foregroundStyle(.secondary)
        }
        .padding(.bottom, 4)
    }

    private var serverSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("SERVER")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            TextField("https://binder.example.com", text: $model.serverURL)
                .textContentType(.URL)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .focused($focusedField, equals: .server)
                .accessibilityLabel("Binder server URL")
            Button("Check server") { Task { await model.checkServer() } }
                .disabled(model.isBusy || model.serverURL.isEmpty)
            if let message = model.serverMessage {
                Label(message, systemImage: "checkmark.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(.green)
            }
            if model.serverURL.lowercased().hasPrefix("http://") {
                Label("This connection is not encrypted.", systemImage: "lock.open.fill")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
        }
    }

    private var signInSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("ACCOUNT")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text("Username")
                .font(.subheadline.weight(.medium))
            TextField("Username", text: $model.username)
                .textContentType(.username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .focused($focusedField, equals: .username)
                .submitLabel(.next)
                .onSubmit { focusedField = .password }
            Text("Password")
                .font(.subheadline.weight(.medium))
            SecureField("Password", text: $model.password)
                .textContentType(.password)
                .textFieldStyle(.roundedBorder)
                .focused($focusedField, equals: .password)
                .submitLabel(.go)
                .onSubmit { Task { await model.signIn() } }

            Toggle("Save password for automatic sign-in", isOn: $model.rememberPassword)
                .font(.subheadline)
                .tint(Color.accentColor)

            Button {
                focusedField = nil
                Task { await model.signIn() }
            } label: {
                HStack {
                    Spacer()
                    if model.isBusy { ProgressView().tint(.white) }
                    Text(model.isBusy ? "Signing in…" : "Sign in")
                        .fontWeight(.semibold)
                    Spacer()
                }
                .frame(minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.isBusy || model.username.isEmpty || model.password.isEmpty)
            .accessibilityIdentifier("password-sign-in")

            if model.ssoIsActive {
                Button {
                    Task { await model.signInWithSSO() }
                } label: {
                    HStack {
                        Spacer()
                        Text("Continue with SSO")
                        Spacer()
                    }
                    .frame(minHeight: 48)
                }
                .buttonStyle(.bordered)
                .disabled(model.isBusy)
                .accessibilityIdentifier("sso-sign-in")
            }
        }
    }
}

struct SignedInView: View {
    @ObservedObject var model: AuthViewModel
    @State private var query = ""
    @State private var results: [BinderSearchResult] = []
    @State private var resultCount = 0
    @State private var searchedQuery = ""
    @State private var hasSearched = false
    @State private var isSearching = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                searchBar

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
                                    BinderSearchResultRow(result: result, serverURL: model.serverURL)
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
                    Button("Sign out", role: .destructive) { Task { await model.signOut() } }
                }
            }
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
