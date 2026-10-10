import SwiftUI

struct MetadataManagementView: View {
    @ObservedObject var model: AuthViewModel

    var body: some View {
        List {
            Section("Vocabulary") {
                ForEach([BinderVocabularyKind.documentTypes, .categories]) { kind in
                    NavigationLink {
                        MetadataVocabularyView(model: model, kind: kind)
                    } label: {
                        Label(kind.title, systemImage: kind.systemImage)
                    }
                }
            }

            Section {
                NavigationLink {
                    MetadataDefinitionManagementView(model: model)
                } label: {
                    Label("Custom fields", systemImage: "slider.horizontal.3")
                }
            } footer: {
                Text("Create fields such as issue date, project, or account number for document metadata.")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Metadata")
    }
}
