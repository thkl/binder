import SwiftUI

struct DocumentRotateView: View {
    let document: BinderDocumentSummary
    let serverURL: String

    @Environment(\.dismiss) private var dismiss
    @State private var pageNumber = 1
    @State private var isRotating = false
    @State private var errorMessage: String?
    @State private var rotatedDocument: BinderDocumentSummary?

    private var pageCount: Int { max(1, document.pageCount ?? 1) }

    var body: some View {
        NavigationStack {
            Group {
                if let rotatedDocument {
                    rotationResult(rotatedDocument)
                } else {
                    rotationForm
                }
            }
            .navigationTitle(rotatedDocument == nil ? "Rotate page" : "Rotation complete")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(rotatedDocument == nil ? "Cancel" : "Done") { dismiss() }
                        .disabled(isRotating)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(isRotating)
    }

    private var rotationForm: some View {
        Form {
            Section("Page") {
                Stepper(value: $pageNumber, in: 1...pageCount) {
                    LabeledContent("Page number", value: "\(pageNumber) of \(pageCount)")
                }
            }

            Section("Rotation") {
                Button {
                    Task { await rotate(by: -90) }
                } label: {
                    Label("Rotate left", systemImage: "rotate.left")
                }
                .disabled(isRotating)

                Button {
                    Task { await rotate(by: 90) }
                } label: {
                    Label("Rotate right", systemImage: "rotate.right")
                }
                .disabled(isRotating)

                Button {
                    Task { await rotate(by: 180) }
                } label: {
                    Label("Rotate 180°", systemImage: "rotate.right")
                }
                .disabled(isRotating)

                if isRotating {
                    HStack {
                        ProgressView()
                        Text("Creating rotated version…")
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Section {
                Text("The original PDF stays in version history. Rotating a page creates a new version and queues it for processing.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let errorMessage {
                Section {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func rotationResult(_ result: BinderDocumentSummary) -> some View {
        List {
            Section {
                Label("Rotated version queued for processing", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text(result.title?.isEmpty == false ? result.title! : result.originalFilename)
                    .font(.body.weight(.medium))
                Text("Version \(result.versionNumber ?? 1) · \(result.status ?? "processing")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if !["uploaded", "scanning", "quarantined"].contains(result.status ?? "") {
                    NavigationLink("Open rotated version") {
                        DocumentPDFView(document: result, serverURL: serverURL)
                    }
                }
            } footer: {
                Text("The previous PDF remains available in version history.")
            }
        }
        .listStyle(.insetGrouped)
    }

    @MainActor
    private func rotate(by degrees: Int) async {
        guard !isRotating else { return }
        isRotating = true
        errorMessage = nil
        defer { isRotating = false }

        do {
            rotatedDocument = try await BinderAPI.shared.rotateDocumentPage(
                serverURL: serverURL,
                documentUUID: document.uuid,
                pageNumber: pageNumber,
                rotationDegrees: degrees
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
