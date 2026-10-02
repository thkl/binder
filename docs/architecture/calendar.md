# Calendar integration

Binder's first calendar integration is a built-in, reviewed plugin. It creates
an owner-scoped iCalendar event from a document's due-date metadata without
requiring Binder to connect to Google Calendar, CalDAV, or another external
calendar service.

## Configuration

The integration is controlled by database-backed settings:

- `calendar.enabled` — enables automatic synchronization;
- `calendar.dueDateField` — the custom metadata key containing the due date,
  defaulting to `dueDate`.

The settings UI selects the field from active workspace metadata definitions
with type `date` or `datetime` and shows the configured label, key, and type.
It does not accept an arbitrary key, which prevents a typo from silently
disabling calendar synchronization for every user.

The due date must be an ISO calendar date in `YYYY-MM-DD` form. Invalid or
empty values remove the existing event for that document.

## Synchronization

When enabled, the calendar plugin listens to owner-scoped document events for
metadata changes, title changes, and accepted AI suggestions. It creates or
updates one event per document. A later title or due-date change updates the
same event instead of creating a duplicate. Removing the due date removes the
event.

The document list, search result, and document detail response expose a
`calendarEventUrl` when an event exists. The document drawer can also request a
manual synchronization for an existing document, which is useful after the
setting was enabled or when a document was already processed earlier.

## API

All endpoints require the authenticated user's session and enforce document
ownership:

- `GET /api/v1/calendar` lists the current user's events;
- `GET /api/v1/calendar/documents/:uuid` returns one event or `null`;
- `POST /api/v1/calendar/documents/:uuid/sync` synchronizes one document;
- `GET /api/v1/calendar/documents/:uuid/ics` downloads the event as an
  iCalendar file.

The `.ics` download is deliberately session-protected. It is not an
unauthenticated subscription URL and does not expose a document to a calendar
provider without an explicit user download.

## Boundaries

The event record stores only the document reference, owner, due date, title,
description, and deterministic iCalendar UID. It does not copy document text
or filesystem paths. External calendar provider credentials and two-way sync
are future integration work; the current provider-neutral iCalendar export is
the safe first vertical slice.
