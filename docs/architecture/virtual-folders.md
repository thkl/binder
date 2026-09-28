# Virtual folders

## Decision

Folders are a per-user organizational layer. They do not change the original
filesystem path, storage key, malware-scanner location, or document identity.
A document may be linked to more than one folder, which keeps folders useful
for projects, topics, and temporary working sets at the same time.

Example:

```text
Projects/
├── Project 1/
└── Project 2/
Ideas/
└── Foo/
    └── Bar/
```

## Data model

The first implementation should use two owner-scoped relations:

- `folders`: `uuid`, `owner_uuid`, `parent_uuid`, `name`, timestamps, and an
  optional sort position;
- `document_folders`: `document_uuid`, `folder_uuid`, timestamps, and a unique
  pair constraint.

Folder names are unique among siblings for the same owner. `parent_uuid` must
refer to a folder owned by the same user, and cycles must be rejected before a
move is persisted. Documents remain protected by their existing owner checks;
folder membership must never grant access to another user's document.

Deleting a folder should initially remove only the links and keep its
documents. A later version may offer recursive delete-link behavior, but it
must never delete the original document implicitly.

## API and client

The API should expose a typed tree endpoint with lazy child loading and
document membership commands. Folder filters should also be accepted by the
document list, search, bulk-action, and export contracts.

The client should use `agrid` as a presentation component for the tree. A
feature adapter translates tree selection, create, rename, move, and delete
events into whitelisted Zod inputs. The tree must not know storage paths or
construct unrestricted database filters.

## First implementation

The first implementation uses the same owner-scoped API boundary for every
operation:

- `GET /api/v1/folders?parentUuid=...` loads one level of the tree lazily;
- `POST /api/v1/folders` creates a root or child folder;
- `PATCH /api/v1/folders/:uuid` renames or reorders a folder;
- `POST /api/v1/folders/:uuid/move` moves a folder after cycle validation;
- `DELETE /api/v1/folders/:uuid` removes the folder links and promotes its
  children to the parent level without deleting documents;
- `POST` and `DELETE /api/v1/folders/:uuid/documents` link or unlink selected
  documents.

The document list accepts `folderUuid` and resolves membership through the
folder link table. A folder never grants access to a document: both the folder
and every linked document are checked against the authenticated owner.

The current client renders a keyboard-operable lazy tree in the document
sidebar. `agrid` remains a suitable future adapter if it is added as a
workspace dependency; the API contract deliberately does not depend on a
particular tree widget.

The document drawer remains the document detail surface. A folder can be
selected beside the document list, and linking/unlinking documents should be
available through the same bulk-selection flow used elsewhere in the list.

Personal document types, categories, and issuers may optionally define an
automatic folder. When metadata is saved, including metadata accepted from an
AI classification, Binder adds the document to each configured target folder.
System/workspace vocabulary values cannot point to personal folders. Automatic
routing is additive: it never removes a folder link that a user assigned
manually or that was previously created by another routing rule.

The metadata editor also exposes the document's personal folder memberships,
so documents opened from the list or from search can be assigned to multiple
folders without returning to the folder view.

## Future considerations

- Drag-and-drop moves need an explicit keyboard alternative.
- Folder membership should be included in saved searches and export manifests.
- Shared folders belong to the later multi-user organization model, not the
  first per-user implementation.
