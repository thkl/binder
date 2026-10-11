# Document exports

Document export is implemented for individual documents, selected documents,
filtered document lists, and virtual folders.

## User behavior

- Opening or downloading one document returns its PDF.
- Exporting multiple selected documents creates a ZIP archive.
- The document list can export all documents matching its validated filters as
  a ZIP archive.
- A folder export includes documents in that folder and its descendant
  folders. The archive preserves the folder subtree layout.

ZIP exports stream from the API. Archive filenames are sanitized and made
collision-safe. An export fails if any source file is missing or is not yet
available because processing or malware scanning has not completed.

## Access and audit

Export requests resolve document ownership before reading source files. Folder
exports require ownership of the requested folder and include only documents
owned by the requesting user. The API records document export activity in the
owner-visible audit history without recording document contents.

Exports copy source files into the response archive. They do not move or alter
the managed originals. Shared documents are not included in owner-only export
operations.
