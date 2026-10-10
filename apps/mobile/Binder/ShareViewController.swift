import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let titleLabel = UILabel()
    private let statusLabel = UILabel()
    private let activityIndicator = UIActivityIndicatorView(style: .medium)
    private let doneButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        configureView()
        loadSharedPDF()
    }

    private func configureView() {
        view.backgroundColor = .systemGroupedBackground
        titleLabel.text = "Add to Binder"
        titleLabel.font = .preferredFont(forTextStyle: .headline)
        titleLabel.textAlignment = .center

        statusLabel.text = "Preparing PDF…"
        statusLabel.font = .preferredFont(forTextStyle: .subheadline)
        statusLabel.textColor = .secondaryLabel
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 0

        doneButton.setTitle("Done", for: .normal)
        doneButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        doneButton.isEnabled = false
        doneButton.addTarget(self, action: #selector(finish), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [titleLabel, activityIndicator, statusLabel, doneButton])
        stack.axis = .vertical
        stack.alignment = .fill
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            stack.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
            doneButton.heightAnchor.constraint(equalToConstant: 44),
        ])
        activityIndicator.startAnimating()
    }

    private func loadSharedPDF() {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
            .flatMap { $0.attachments ?? [] }
        guard let provider = providers.first(where: {
            $0.hasItemConformingToTypeIdentifier(UTType.pdf.identifier)
        }) else {
            showFinished("Select a PDF to add it to Binder.")
            return
        }

        provider.loadFileRepresentation(forTypeIdentifier: UTType.pdf.identifier) { [weak self] sourceURL, error in
            guard let self else { return }
            guard let sourceURL else {
                Task { @MainActor in
                    self.showFinished(error?.localizedDescription ?? "The PDF could not be opened.")
                }
                return
            }

            do {
                let filename = provider.suggestedName ?? sourceURL.lastPathComponent
                let queuedURL = try SharedPDFQueue.enqueue(from: sourceURL, filename: filename)
                Task { @MainActor in await self.uploadOrQueue(queuedURL) }
            } catch {
                Task { @MainActor in
                    self.showFinished("Couldn’t save the PDF for Binder: \(error.localizedDescription)")
                }
            }
        }
    }

    @MainActor
    private func uploadOrQueue(_ queuedURL: URL) async {
        let serverURL = AppSettings.serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !serverURL.isEmpty else {
            showFinished("PDF queued. Open Binder, set the server URL, and sign in to upload it.")
            return
        }

        do {
            try await BinderAPI.shared.uploadDocument(serverURL: serverURL, fileURL: queuedURL)
            try SharedPDFQueue.remove(fileAt: queuedURL)
            showFinished("PDF added to Binder.")
        } catch {
            showFinished("PDF queued. Open Binder to retry when the server is available or sign in.")
        }
    }

    @MainActor
    private func showFinished(_ message: String) {
        activityIndicator.stopAnimating()
        statusLabel.text = message
        doneButton.isEnabled = true
    }

    @objc private func finish() {
        extensionContext?.completeRequest(returningItems: nil)
    }
}
