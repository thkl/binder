import SwiftUI
import UIKit
import VisionKit

struct DocumentScanner: UIViewControllerRepresentable {
    @Binding var isPresented: Bool
    let onScan: ([UIImage]) -> Void
    let onError: (String) -> Void

    static var isSupported: Bool {
        VNDocumentCameraViewController.isSupported
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let controller = VNDocumentCameraViewController()
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: VNDocumentCameraViewController, context: Context) {}

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        private let parent: DocumentScanner

        init(parent: DocumentScanner) {
            self.parent = parent
        }

        func documentCameraViewController(
            _ controller: VNDocumentCameraViewController,
            didFinishWith scan: VNDocumentCameraScan
        ) {
            let pages = (0..<scan.pageCount).map { scan.imageOfPage(at: $0) }
            parent.isPresented = false
            controller.dismiss(animated: true) { [parent] in
                parent.onScan(pages)
            }
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
            parent.isPresented = false
            controller.dismiss(animated: true)
        }

        func documentCameraViewController(
            _ controller: VNDocumentCameraViewController,
            didFailWithError error: Error
        ) {
            parent.isPresented = false
            controller.dismiss(animated: true) { [parent] in
                parent.onError(error.localizedDescription)
            }
        }
    }
}

enum ScannedPDFWriter {
    private static let pageBounds = CGRect(x: 0, y: 0, width: 595, height: 842)

    static func create(from images: [UIImage]) throws -> URL {
        guard !images.isEmpty else {
            throw ScanError.noPages
        }

        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent("Binder-Scan-\(UUID().uuidString).pdf")
        let renderer = UIGraphicsPDFRenderer(bounds: pageBounds)
        try renderer.writePDF(to: destination) { context in
            for image in images {
                context.beginPage()
                let imageSize = image.size
                guard imageSize.width > 0, imageSize.height > 0 else { continue }

                let scale = min(pageBounds.width / imageSize.width, pageBounds.height / imageSize.height)
                let fittedSize = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
                let imageRect = CGRect(
                    x: (pageBounds.width - fittedSize.width) / 2,
                    y: (pageBounds.height - fittedSize.height) / 2,
                    width: fittedSize.width,
                    height: fittedSize.height
                )
                image.draw(in: imageRect)
            }
        }
        return destination
    }

    private enum ScanError: LocalizedError {
        case noPages

        var errorDescription: String? {
            "The scan did not contain any pages. Try scanning the document again."
        }
    }
}

enum ScannedDocumentQueue {
    static func enqueue(pages: [UIImage]) throws -> URL {
        let temporaryPDF = try ScannedPDFWriter.create(from: pages)
        defer { try? FileManager.default.removeItem(at: temporaryPDF) }

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd-HH-mm-ss"
        let filename = "Scan-\(formatter.string(from: Date())).pdf"
        return try SharedPDFQueue.enqueue(from: temporaryPDF, filename: filename)
    }
}
