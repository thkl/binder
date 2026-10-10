import SwiftUI
import UIKit

struct LoginView: View {
    @ObservedObject var model: AuthViewModel
    @FocusState private var focusedField: Field?
    @State private var isShowingScanner = false
    @State private var scannerError: String?
    @State private var scanQueueMessage: String?

    private enum Field: Hashable { case server, username, password }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    offlineScanSection
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
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle("Sign in")
            .navigationBarTitleDisplayMode(.inline)
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
            .overlay {
                if model.isBusy {
                    ZStack {
                        Color.black.opacity(0.12)
                            .ignoresSafeArea()
                        ProgressView("Connecting to Binder…")
                            .padding(.horizontal, 24)
                            .padding(.vertical, 20)
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                    }
                }
            }
            .animation(.easeInOut(duration: 0.2), value: model.isBusy)
            .background(Color(uiColor: .systemGroupedBackground).ignoresSafeArea())
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
            Text(model.hasCompletedInitialAuthCheck
                 ? "Sign in to search and read your documents."
                 : "Restoring your session. You can scan documents while Binder reconnects.")
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
                .disabled(model.isBusy || !model.hasCompletedInitialAuthCheck || model.serverURL.isEmpty)
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

    private var offlineScanSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                guard DocumentScanner.isSupported else {
                    scannerError = "Document scanning is not available on this device."
                    return
                }
                isShowingScanner = true
            } label: {
                Label("Scan and queue a document", systemImage: "doc.viewfinder")
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.bordered)
            if let scanQueueMessage {
                Label(scanQueueMessage, systemImage: "checkmark.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(.green)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text("Scans are saved on this device and upload after you sign in.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    @MainActor
    private func saveScannedPDF(_ pages: [UIImage]) {
        do {
            _ = try ScannedDocumentQueue.enqueue(pages: pages)
            scanQueueMessage = "Scan queued. It will upload after you sign in."
        } catch {
            scannerError = error.localizedDescription
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
            .disabled(model.isBusy || !model.hasCompletedInitialAuthCheck || model.username.isEmpty || model.password.isEmpty)
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
                .disabled(model.isBusy || !model.hasCompletedInitialAuthCheck)
                .accessibilityIdentifier("sso-sign-in")
            }
        }
    }
}
