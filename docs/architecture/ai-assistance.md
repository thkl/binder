# AI assistance

AI title suggestions are optional and explicitly user-triggered. The API sends the original filename and a bounded amount of extracted text to the configured OpenAI-compatible chat endpoint. The existing document title is never changed automatically.

The client displays the proposed title with accept and dismiss actions. Accepting uses the normal ownership-checked title update endpoint; dismissing makes no database change.

Configuration is stored in the database. Named provider profiles hold task-specific endpoints and models. Each profile API key is encrypted with `ENCRYPTION_KEY`:

- `ai.titleSuggestions.enabled`
- `ai.documentAnalysis.prompt` for the user-editable document analysis instructions
- `ai.assistantProviderUuid` for document assistance
- `ai.embeddingProviderUuid` for semantic embeddings
- `embeddings.enabled`, `embeddings.chunkSize`, and `embeddings.chunkOverlap`

The default is disabled. Logs include document UUID, model, and text length, but never document text, prompts, API keys, or generated vectors.

The analysis prompt is editable by administrators in the AI assistance settings. The API appends the required JSON shape, UUID allow-list rules, and title length constraint after the editable text, then validates and sanitizes the response against the current vocabulary and metadata definitions. This keeps customization useful without allowing an edited prompt to bypass server-side safety and data validation.

## P3 provider profiles

Provider profiles are managed by administrators through the AI settings screen.
The first adapter is OpenAI-compatible and each profile can define an assistant
endpoint/model, an embedding endpoint/model, and an encrypted API key. The
assistant and embedding tasks select profiles independently. Existing single-
provider settings remain a compatibility fallback until a profile is selected.

## P3 file-aware PDF analysis

File-aware PDF analysis is a manual, user-confirmed workflow. The client first
opens the document in Binder's document workspace and shows the PDF in the
upper pane with the analysis conversation below it. The metadata editor remains
available as a separate tab. The normal owner-scoped document access check is
performed before the PDF can be uploaded.

The original PDF is uploaded only after the user submits the first prompt. It
is sent as an input file to the selected assistant provider; extracted text is
not a substitute for this workflow. The UI discloses that the original file
will leave Binder before the prompt is submitted. The result is a chat response
and is never applied to document metadata automatically.

The API stores the remote file ID and response-chain ID in
`document_analysis_sessions`, scoped to the authenticated owner and document.
The session also stores the bounded conversation history. When the document
workspace is opened again, the client restores the active unexpired session
from the API. Follow-up messages reuse the provider upload and response chain,
so closing the workspace does not cause another PDF upload.

Starting a new analysis resets the response chain and conversation history but
continues to reuse the same provider upload while it remains valid.

Provider uploads must use the provider's automatic expiration controls. The
default is one hour after creation, and the duration plus request timeout are
configurable through application settings. The API attempts explicit cleanup
when a first request fails, but provider-side expiration remains the safety net
if the request fails or the process stops. The provider profile therefore needs
file-upload and file-analysis endpoints plus a file-analysis model in addition
to its normal assistant and embedding settings.

## P3 feedback-based classification

AI classification improves from explicit user corrections without turning Binder
into an opaque, global model-training system. When a user changes a category,
document type, issuer, or tag, Binder records an owner-scoped classification
feedback entry. Applying an AI suggestion without a user review does not count
as feedback.

The feedback matcher compares stable document evidence rather than exact text.
For recurring letters, dates, months, amounts, invoice numbers, and other
variable tokens are normalized before calculating a template fingerprint. The
current implementation combines normalized extracted text with a normalized
original filename and stores a SHA-256 fingerprint. Feedback is only recorded
when the source document has enough extracted text to form a useful template.
Useful supporting signals include the owner, issuer, normalized sender details,
filename pattern, extracted-text fingerprint, and already assigned metadata.

The precedence is:

1. Existing metadata explicitly assigned by the user.
2. A strong owner-scoped feedback rule matching the document template.
3. Deterministic matches such as a trusted issuer rule.
4. The normal AI suggestion and confidence threshold.

A single correction creates an owner-scoped rule. It is applied automatically
only when the template match has a unique leading rule for that field; ties are
left for review. Rules reference existing vocabulary UUIDs, prefer a personal
vocabulary entry over a workspace entry, and never create new categories or
types. Existing document metadata is never overwritten. The client shows when
a suggestion came from learned user feedback and provides review and removal
controls. Feedback creation, application, and removal belong in the document
audit history.

The API exposes the learned rules through `GET /api/v1/classification-feedback`
and deactivates an owner-owned rule with
`DELETE /api/v1/classification-feedback/:uuid`. Automatic application remains
controlled by the normal automatic-classification setting; when that setting is
disabled, the feedback-enhanced suggestion is presented for user review.
