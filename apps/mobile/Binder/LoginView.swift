import SwiftUI

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

    var body: some View {
        NavigationStack {
            ContentUnavailableView {
                Label("Signed in", systemImage: "checkmark.circle.fill")
            } description: {
                Text("Search and document views will be added next.")
            } actions: {
                Button("Sign out", role: .destructive) { Task { await model.signOut() } }
                    .buttonStyle(.bordered)
            }
            .navigationTitle("Binder")
        }
    }
}
