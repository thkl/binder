# Document and folder sharing

## Scope

Allow an active Binder account to grant another active account on the same
server read-only access to documents or folders. This is an account-to-account
workspace, not a separate tenant model: Binder currently has one global user
directory and documents and folders are owned by their creator.

Recipients can read document details and PDFs. They cannot change metadata,
folders, processing state, versions, or ownership. Owners retain full control
and can revoke access at any time.

## Folder access

Sharing a folder grants read access to the folder, its descendant folders, and
documents linked to any folder in that subtree. The grant is evaluated from
the current folder hierarchy and document links, so moving a document into or
out of a shared subtree changes its effective access without copying the file.
A recipient sees shared folders under a separate “Shared with me” entry and
cannot rename, move, delete, or add documents to them.

A direct document share remains effective independently of folder membership.
Removing a folder share does not remove an independent direct share.

## Authorization rules

- The owner may create, list, and revoke shares for their own documents and
  folders.
- Share recipients must be active accounts other than the owner.
- A recipient may read a document only while a direct document share or an
  effective folder share exists.
- Existing owner-only mutation paths remain owner-only.
- Share records are removed when their owner, recipient, document, or folder is
  deleted. Inactive recipients lose access immediately.
- Shared read surfaces must not expose the owner's account settings, private
  metadata vocabulary, audit/change history, AI analysis sessions, or calendar
  integration data.

## MVP implementation

- Migration `V073` stores direct document and folder grants.
- `/api/v1/shares` provides owner-scoped grant management and active recipient
  selection.
- Shared document and folder endpoints provide recipient browsing. Shared PDFs
  are accessible while a grant remains active; shared document metadata,
  calendar links, internal storage keys, and archive keys are omitted.
- The webclient has owner-side share controls in the document drawer and folder
  tree, plus a “Shared with me” page.
- Shared items are read-only. Collaborative metadata editing, role-based
  permissions, public links, and cross-server sharing are out of scope.

Build/type checks are the first verification pass. Authorization behavior,
revocation, inactive users, nested folders, and migration execution still need
integration verification against a running API/database.
