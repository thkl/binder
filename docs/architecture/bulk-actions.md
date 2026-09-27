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
