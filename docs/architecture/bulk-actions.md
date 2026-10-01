# Document bulk actions

Bulk actions operate on documents visible in the current documents page. The
client sends the selected UUIDs and one action to the API:

POST /api/v1/documents/bulk

Request body:

    {
      "documentUuids": ["..."],
      "action": "analyze"
    }

The shared Zod contract limits a request to 100 unique UUIDs. Supported
actions are:

- analyze — request and persist one AI metadata/title suggestion per document
- requeue — enqueue processing again after verifying the original file exists
- mark-reviewed — clear the new-document indicator

The API processes each UUID independently and returns succeeded and failed
items. A failure for one document does not cancel the rest of the request.
Every operation resolves the document through the authenticated owner scope;
the endpoint never accepts an owner UUID from the client.

The UI provides the same selection and action controls in list and icon views.
Selection is page-scoped for now, which makes the scope explicit and avoids
silently selecting documents that are not currently visible.

## Bulk metadata editing

Bulk metadata editing must not silently replace information that is already
present. Before applying an edit, the API should provide a preview containing:

- the selected document count;
- the number of empty values that can be filled;
- the number of existing values that would be replaced;
- the fields and folders affected by the operation; and
- documents that cannot be changed because they are outside the owner scope or
  fail validation.

The API provides this preview at `POST /api/v1/documents/bulk-metadata/preview`
and applies an accepted request at `POST /api/v1/documents/bulk-metadata`. The
client requires a review step and an additional confirmation when
`replace-selected` would overwrite existing values. The available policies are
`fill-empty`, `skip-existing`, and `replace-selected`.

Every successful bulk edit creates one immutable change set in
`document_metadata_change_sets` containing the actor, affected documents,
affected fields, and the before/after values needed for rollback. The change
set is linked to the per-document audit events. Rollback is available at
`POST /api/v1/documents/change-sets/:uuid/rollback`; it verifies ownership and
refuses to overwrite a newer conflicting edit.
