import { Injectable, Pipe, PipeTransform, signal } from '@angular/core';
import type { AppLanguage, LocalizedText, VocabularyItem } from '@binder/common';

type TranslationMap = Record<string, string>;

const EN: TranslationMap = {
  'app.loading': 'Loading your workspace…', 'app.privateCloud': 'BINDER / DOCUMENTS', 'app.vault': 'Document workspace',
  'nav.inbox': 'Inbox', 'nav.documents': 'Documents', 'nav.metadata': 'Metadata', 'nav.settings': 'Settings', 'nav.signOut': 'Sign out',
  'language.english': 'English', 'language.german': 'German',
  'login.privateIntelligence': 'DOCUMENT MANAGEMENT', 'login.headline': 'Your documents.\nOrganized.',
  'login.copy': 'Store, organize, and search your documents in one place. Files remain in your configured storage.',
  'login.privacy': 'Local storage', 'login.privacyCopy': 'Your files remain in the storage you configure.', 'login.secureAccess': 'SIGN IN',
  'login.welcome': 'Welcome back', 'login.copyShort': 'Sign in to open your document workspace.', 'login.username': 'Username', 'login.password': 'Password',
  'login.signingIn': 'Signing in…', 'login.signIn': 'Sign in', 'login.or': 'or', 'login.sso': 'Continue with SSO',
  'password.security': 'SECURITY', 'password.changeTitle': 'Change your password', 'password.changeMessage': 'Choose a new password for your account.', 'password.firstTitle': 'Choose a new password', 'password.firstMessage': 'Your temporary password must be changed before continuing.', 'password.old': 'Old password', 'password.new': 'New password', 'password.confirm': 'Confirm new password',
  'password.saving': 'Saving…', 'password.save': 'Save password', 'password.mismatch': 'The new password and confirmation do not match.',
  'documents.kicker': 'DOCUMENTS', 'documents.title': 'Documents', 'documents.copy': 'Manage uploaded files and their processing status.',
  'documents.add': 'Add PDF', 'documents.uploading': 'Uploading…', 'documents.all': 'All documents', 'documents.list': 'List view',
  'documents.details': 'Details view', 'documents.smallIcons': 'Small icons', 'documents.largeIcons': 'Large icons', 'documents.loading': 'Loading documents…',
  'documents.ready': 'No documents yet', 'documents.empty': 'Upload a PDF to get started.', 'documents.metadata': 'Metadata',
  'documents.open': 'Open', 'documents.previous': 'Previous', 'documents.next': 'Next', 'documents.suggestion': 'Suggested:', 'documents.review': 'Review', 'documents.dismiss': 'Dismiss',
  'home.kicker': 'DOCUMENT SEARCH', 'home.title': 'Search your documents.', 'home.copy': 'Search titles, filenames, and extracted text. Semantic matches are included when enabled.',
  'home.placeholder': 'Find the document about my car inspection last summer', 'home.search': 'Search', 'home.searching': 'Searching…', 'home.type': 'Type', 'home.category': 'Category', 'home.tag': 'Tag',
  'home.anyType': 'Any type', 'home.anyCategory': 'Any category', 'home.anyTag': 'Any tag', 'home.hint': 'Search by title, filename, or text from a document.',
  'home.results': 'SEARCH RESULTS', 'home.document': 'document', 'home.documents': 'documents', 'home.found': 'found', 'home.noMatches': 'No matching documents', 'home.tryFewer': 'Try fewer words or a more specific phrase.',
  'home.titleMatch': 'Title match', 'home.noSnippet': 'No text snippet available.', 'home.history': 'Search your document history', 'home.semantic': 'Results combine keyword matches with semantic matches when hosted embeddings are enabled.',
  'metadata.kicker': 'METADATA', 'metadata.title': 'Metadata library', 'metadata.copy': 'Manage document types, categories, tags, and custom fields.',
  'metadata.add': 'Add', 'metadata.vocabulary': 'VOCABULARY', 'metadata.types': 'Document types', 'metadata.categories': 'Categories', 'metadata.tags': 'Tags',
  'metadata.workspaceNote': 'System entries are shared across the workspace.', 'metadata.available': 'VALUES', 'metadata.entries': 'entries', 'metadata.create': 'Create a value',
  'metadata.createCopy': 'The value can be used for document classification.', 'metadata.name': 'Name', 'metadata.description': 'Description', 'metadata.optional': 'Optional',
  'metadata.workspaceValue': 'Workspace-wide value', 'metadata.workspaceValueCopy': 'Make this available to every user.', 'metadata.cancel': 'Cancel', 'metadata.creating': 'Creating…', 'metadata.createValue': 'Create value',
  'metadata.loading': 'Loading values…', 'metadata.noValues': 'No values yet', 'metadata.createFirst': 'Add a value to use it when classifying documents.', 'metadata.createOne': 'Add a value',
  'metadata.workspace': 'Workspace', 'metadata.personal': 'Personal', 'metadata.noDescription': 'No description added', 'metadata.flexible': 'FLEXIBLE FIELDS', 'metadata.custom': 'Custom metadata',
  'metadata.customCopy': 'Add fields such as project, issue date, or due date. They will appear in every document’s metadata editor.', 'metadata.key': 'Key', 'metadata.label': 'Label', 'metadata.fieldType': 'Type',
  'metadata.required': 'Required on documents', 'metadata.adding': 'Adding…', 'metadata.addField': 'Add field', 'metadata.date': 'Date', 'metadata.dateTime': 'Date and time', 'metadata.yesNo': 'Yes / no', 'metadata.select': 'Select', 'metadata.multiSelect': 'Multiple select',
  'settings.kicker': 'ADMINISTRATION / CONFIGURATION', 'settings.title': 'Settings', 'settings.copy': 'Shape how Binder works for your document workspace.', 'settings.sections': 'SECTIONS', 'settings.group': 'CONFIGURATION GROUP', 'settings.fields': 'fields', 'settings.none': 'No settings are available in this section yet.', 'settings.saving': 'Saving…', 'settings.save': 'Save changes', 'settings.saved': 'Settings saved', 'settings.encrypted': 'Encrypted at rest', 'settings.common': 'Common Settings', 'settings.mailer': 'Mailer Settings', 'settings.oidc': 'SSO/OIDC Login', 'settings.documents': 'Document storage', 'settings.pipeline': 'Processing pipeline', 'settings.ai': 'AI assistance', 'setting.documents.storageRoot': 'Storage root', 'setting.documents.maxUploadBytes': 'Maximum upload size (bytes)', 'setting.pipeline.pollIntervalMs': 'Worker polling interval (ms)', 'setting.pipeline.lockTimeoutMs': 'Worker lock timeout (ms)', 'setting.pipeline.reconcileIntervalMs': 'Reconciliation interval (ms)', 'setting.pipeline.ocrLanguages': 'OCR languages', 'setting.embeddings.enabled': 'Enable hosted semantic embeddings', 'setting.embeddings.endpoint': 'Embedding endpoint', 'setting.embeddings.model': 'Embedding model', 'setting.embeddings.chunkSize': 'Embedding chunk size (characters)', 'setting.embeddings.chunkOverlap': 'Embedding chunk overlap (characters)', 'setting.ai.titleSuggestions.enabled': 'Enable AI title suggestions', 'setting.ai.provider': 'AI provider (shared)', 'setting.ai.endpoint': 'Assistant endpoint', 'setting.ai.model': 'Assistant model', 'setting.ai.apiKey': 'AI API key (shared)', 'setting.ai.documentAnalysis.prompt': 'Document analysis prompt', 'setting.oidc.ISSUER_URL': 'Issuer', 'setting.oidc.CLIENT_ID': 'Client ID', 'setting.oidc.CLIENT_SECRET': 'Client Secret', 'setting.oidc.email_verified': 'Only accept verified eMails', 'setting.oidc.ACR_VALUES': 'Pass ACR Values if needed',
  'editor.loading': 'Loading classification options…', 'editor.kicker': 'DOCUMENT CLASSIFICATION', 'editor.title': 'Metadata', 'editor.aiReview': 'AI REVIEW', 'editor.suggested': 'Suggested metadata', 'editor.titleField': 'Title', 'editor.type': 'Type', 'editor.category': 'Category', 'editor.tags': 'Tags', 'editor.customFields': 'Custom fields', 'editor.acceptAll': 'Accept all suggestions', 'editor.notClassified': 'Not classified', 'editor.noCategory': 'No category', 'editor.selected': 'selected', 'editor.searchTags': 'Search known tags…', 'editor.noTags': 'No matching tags yet.', 'editor.newTag': 'Add a new personal tag…', 'editor.addTag': 'Add tag', 'editor.additional': 'Additional information', 'editor.choose': 'Choose…', 'editor.comma': 'Comma separated values', 'editor.saved': 'Saved', 'editor.saving': 'Saving…', 'editor.save': 'Save metadata',
  'editor.dismissSuggestion': 'Dismiss suggestions',
  'viewer.kicker': 'DOCUMENT VIEW', 'viewer.close': 'Close document viewer', 'viewer.preview': 'Document preview',
  'inbox.kicker': 'INBOX', 'inbox.title': 'Inbox queue', 'inbox.copy': 'Files arriving in the inbox are imported, processed, and kept here until their status is clear.', 'inbox.refresh': 'Refresh', 'inbox.processAll': 'Process all with AI', 'inbox.processingAll': 'Processing with AI…', 'inbox.queueKicker': 'INCOMING FILES', 'inbox.queueTitle': 'Import history', 'inbox.loading': 'Loading inbox…', 'inbox.emptyTitle': 'No inbox files yet', 'inbox.emptyCopy': 'Files placed in the configured inbox folder will appear here.', 'inbox.summary.new': 'New', 'inbox.summary.processing': 'Processing', 'inbox.summary.imported': 'Imported', 'inbox.summary.waiting': 'waiting for the worker', 'inbox.summary.worker': 'being handled by the worker', 'inbox.summary.aiReady': 'ready for AI review', 'inbox.suggestion': 'Suggested title:', 'inbox.openDocuments': 'Open document', 'inbox.status.new': 'New', 'inbox.status.processing': 'Processing', 'inbox.status.imported': 'Imported', 'inbox.status.duplicate': 'Duplicate', 'inbox.status.rejected': 'Rejected', 'inbox.status.failed': 'Failed', 'inbox.aiStatus.pending': 'AI pending', 'inbox.aiStatus.processing': 'AI processing', 'inbox.aiStatus.ready': 'AI ready', 'inbox.aiStatus.failed': 'AI failed'
};

const DE: TranslationMap = {
  'app.loading': 'Arbeitsbereich wird gesichert…', 'app.privateCloud': 'BINDER / PRIVATE CLOUD', 'app.vault': 'Ihr Dokumentenarchiv',
  'nav.inbox': 'Inbox', 'nav.documents': 'Dokumente', 'nav.metadata': 'Metadaten', 'nav.settings': 'Einstellungen', 'nav.signOut': 'Abmelden',
  'language.english': 'Englisch', 'language.german': 'Deutsch',
  'login.privateIntelligence': 'PRIVATE DOKUMENTENINTELLIGENZ', 'login.headline': 'Ihre Dokumente.\nUnter Kontrolle.',
  'login.copy': 'Ein ruhiger, sicherer Ort für wichtige Dokumente. Natürlich suchen, Eigentümerschaft klar halten und für alles Kommende bereit sein.',
  'login.privacy': 'Für Privatsphäre entwickelt', 'login.privacyCopy': 'Ihre Dateien bleiben in Ihrem kontrollierten Speicher.', 'login.secureAccess': 'SICHERER ZUGANG',
  'login.welcome': 'Willkommen zurück', 'login.copyShort': 'Melden Sie sich an, um Ihr Dokumentenarchiv zu öffnen.', 'login.username': 'Benutzername', 'login.password': 'Passwort',
  'login.signingIn': 'Anmeldung…', 'login.signIn': 'Anmelden', 'login.or': 'oder', 'login.sso': 'Mit SSO fortfahren',
  'password.security': 'SICHERHEIT', 'password.changeTitle': 'Passwort ändern', 'password.changeMessage': 'Wählen Sie ein neues Passwort für Ihr Konto.', 'password.firstTitle': 'Neues Passwort wählen', 'password.firstMessage': 'Ihr temporäres Passwort muss vor dem Fortfahren geändert werden.', 'password.old': 'Altes Passwort', 'password.new': 'Neues Passwort', 'password.confirm': 'Neues Passwort bestätigen', 'password.saving': 'Speichern…', 'password.save': 'Passwort speichern', 'password.mismatch': 'Neues Passwort und Bestätigung stimmen nicht überein.',
  'documents.kicker': 'PRIVATES DOKUMENTENARCHIV', 'documents.title': 'Dokumente', 'documents.copy': 'Ihre Originale bleiben in Ihrem kontrollierten Speicher und sind für die Verarbeitung bereit.', 'documents.add': 'PDF hinzufügen', 'documents.uploading': 'Wird hochgeladen…', 'documents.all': 'Alle Dokumente', 'documents.list': 'Listenansicht', 'documents.details': 'Detailansicht', 'documents.smallIcons': 'Kleine Symbole', 'documents.largeIcons': 'Große Symbole', 'documents.loading': 'Dokumente werden geladen…', 'documents.ready': 'Ihr Archiv ist bereit', 'documents.empty': 'Laden Sie Ihr erstes PDF hoch, um Ihre Dokumenthistorie aufzubauen.', 'documents.metadata': 'Metadaten', 'documents.open': 'Öffnen', 'documents.previous': 'Zurück', 'documents.next': 'Weiter', 'documents.suggestion': 'Vorschlag:', 'documents.review': 'Prüfen', 'documents.dismiss': 'Verwerfen',
  'home.kicker': 'PRIVATES DOKUMENTENARCHIV', 'home.title': 'Alles in Ihrem Archiv finden.', 'home.copy': 'Durchsuchen Sie Titel, Dateinamen und extrahierten Dokumenttext. Fragen Sie natürlich — semantische Treffer werden bei aktivierten Embeddings einbezogen.', 'home.placeholder': 'Finden Sie das Dokument über die Hauptuntersuchung meines Autos letzten Sommer', 'home.search': 'Suchen', 'home.searching': 'Suche läuft…', 'home.type': 'Typ', 'home.category': 'Kategorie', 'home.tag': 'Tag', 'home.anyType': 'Jeder Typ', 'home.anyCategory': 'Jede Kategorie', 'home.anyTag': 'Jeder Tag', 'home.hint': 'Versuchen Sie einen Titel, Dateinamen oder eine Textpassage aus dem Dokument.', 'home.results': 'SUCHERGEBNISSE', 'home.document': 'Dokument', 'home.documents': 'Dokumente', 'home.found': 'gefunden', 'home.noMatches': 'Keine passenden Dokumente', 'home.tryFewer': 'Versuchen Sie weniger Wörter oder eine markante Textpassage.', 'home.titleMatch': 'Titelübereinstimmung', 'home.noSnippet': 'Kein Textausschnitt verfügbar.', 'home.history': 'Dokumenthistorie durchsuchen', 'home.semantic': 'Die Ergebnisse kombinieren Schlüsselwort- und semantische Treffer, wenn gehostete Embeddings aktiviert sind.',
  'metadata.kicker': 'KLASSIFIZIERUNG / KONTROLLIERTES VOKABULAR', 'metadata.title': 'Metadatenbibliothek', 'metadata.copy': 'Halten Sie Klassifizierungen konsistent, damit Suche und künftige KI-Vorschläge präzise bleiben.', 'metadata.add': 'Hinzufügen', 'metadata.vocabulary': 'VOKABULAR', 'metadata.types': 'Dokumenttypen', 'metadata.categories': 'Kategorien', 'metadata.tags': 'Tags', 'metadata.workspaceNote': 'Systemeinträge werden im gesamten Arbeitsbereich geteilt.', 'metadata.available': 'VERFÜGBARE WERTE', 'metadata.entries': 'Einträge', 'metadata.create': 'Kontrollierten Wert erstellen', 'metadata.createCopy': 'Er steht sofort für die Dokumentklassifizierung zur Verfügung.', 'metadata.name': 'Name', 'metadata.description': 'Beschreibung', 'metadata.optional': 'Optional', 'metadata.workspaceValue': 'Arbeitsbereichweiter Wert', 'metadata.workspaceValueCopy': 'Für alle Benutzer verfügbar machen.', 'metadata.cancel': 'Abbrechen', 'metadata.creating': 'Wird erstellt…', 'metadata.createValue': 'Wert erstellen', 'metadata.loading': 'Vokabular wird geladen…', 'metadata.noValues': 'Noch keine Werte', 'metadata.createFirst': 'Erstellen Sie Ihren ersten kontrollierten Wert für eine präzisere Klassifizierung.', 'metadata.createOne': 'Ersten erstellen', 'metadata.workspace': 'Arbeitsbereich', 'metadata.personal': 'Persönlich', 'metadata.noDescription': 'Keine Beschreibung', 'metadata.flexible': 'FLEXIBLE FELDER', 'metadata.custom': 'Benutzerdefinierte Metadaten', 'metadata.customCopy': 'Fügen Sie Felder wie Projekt, Ausstellungsdatum oder Fälligkeitsdatum hinzu. Sie erscheinen im Metadateneditor jedes Dokuments.', 'metadata.key': 'Schlüssel', 'metadata.label': 'Bezeichnung', 'metadata.fieldType': 'Typ', 'metadata.required': 'Für Dokumente erforderlich', 'metadata.adding': 'Wird hinzugefügt…', 'metadata.addField': 'Feld hinzufügen', 'metadata.date': 'Datum', 'metadata.dateTime': 'Datum und Uhrzeit', 'metadata.yesNo': 'Ja / Nein', 'metadata.select': 'Auswahl', 'metadata.multiSelect': 'Mehrfachauswahl',
  'settings.kicker': 'ADMINISTRATION / KONFIGURATION', 'settings.title': 'Einstellungen', 'settings.copy': 'Legen Sie fest, wie Binder in Ihrem Dokumentenarbeitsbereich arbeitet.', 'settings.sections': 'BEREICHE', 'settings.group': 'KONFIGURATIONSGRUPPE', 'settings.fields': 'Felder', 'settings.none': 'In diesem Bereich sind noch keine Einstellungen verfügbar.', 'settings.saving': 'Wird gespeichert…', 'settings.save': 'Änderungen speichern', 'settings.saved': 'Einstellungen gespeichert', 'settings.encrypted': 'Verschlüsselt gespeichert', 'settings.common': 'Allgemeine Einstellungen', 'settings.mailer': 'Mail-Einstellungen', 'settings.oidc': 'SSO/OIDC-Anmeldung', 'settings.documents': 'Dokumentenspeicher', 'settings.pipeline': 'Verarbeitungspipeline', 'settings.ai': 'KI-Unterstützung', 'setting.documents.storageRoot': 'Speicherpfad', 'setting.documents.maxUploadBytes': 'Maximale Uploadgröße (Bytes)', 'setting.pipeline.pollIntervalMs': 'Abfrageintervall des Workers (ms)', 'setting.pipeline.lockTimeoutMs': 'Worker-Sperrzeit (ms)', 'setting.pipeline.reconcileIntervalMs': 'Abgleichsintervall (ms)', 'setting.pipeline.ocrLanguages': 'OCR-Sprachen', 'setting.embeddings.enabled': 'Gehostete semantische Embeddings aktivieren', 'setting.embeddings.endpoint': 'Embedding-Endpunkt', 'setting.embeddings.model': 'Embedding-Modell', 'setting.embeddings.chunkSize': 'Größe der Embedding-Abschnitte (Zeichen)', 'setting.embeddings.chunkOverlap': 'Überlappung der Embedding-Abschnitte (Zeichen)', 'setting.ai.titleSuggestions.enabled': 'KI-Titelvorschläge aktivieren', 'setting.ai.provider': 'KI-Anbieter (gemeinsam)', 'setting.ai.endpoint': 'Assistant-Endpunkt', 'setting.ai.model': 'Assistant-Modell', 'setting.ai.apiKey': 'KI-API-Schlüssel (gemeinsam)', 'setting.ai.documentAnalysis.prompt': 'Dokumentanalyse-Prompt', 'setting.oidc.ISSUER_URL': 'Aussteller', 'setting.oidc.CLIENT_ID': 'Client-ID', 'setting.oidc.CLIENT_SECRET': 'Client-Secret', 'setting.oidc.email_verified': 'Nur bestätigte E-Mails akzeptieren', 'setting.oidc.ACR_VALUES': 'ACR-Werte bei Bedarf übergeben',
  'editor.dismissSuggestion': 'Vorschläge verwerfen',
  'editor.loading': 'Klassifizierungsoptionen werden geladen…', 'editor.kicker': 'DOKUMENTKLASSIFIZIERUNG', 'editor.title': 'Metadaten', 'editor.aiReview': 'KI-PRÜFUNG', 'editor.suggested': 'Vorgeschlagene Metadaten', 'editor.titleField': 'Titel', 'editor.type': 'Typ', 'editor.category': 'Kategorie', 'editor.tags': 'Tags', 'editor.customFields': 'Benutzerdefinierte Felder', 'editor.acceptAll': 'Alle Vorschläge übernehmen', 'editor.notClassified': 'Nicht klassifiziert', 'editor.noCategory': 'Keine Kategorie', 'editor.selected': 'ausgewählt', 'editor.searchTags': 'Bekannte Tags suchen…', 'editor.noTags': 'Keine passenden Tags.', 'editor.newTag': 'Neuen persönlichen Tag hinzufügen…', 'editor.addTag': 'Tag hinzufügen', 'editor.additional': 'Zusätzliche Informationen', 'editor.choose': 'Auswählen…', 'editor.comma': 'Kommagetrennte Werte', 'editor.saved': 'Gespeichert', 'editor.saving': 'Wird gespeichert…', 'editor.save': 'Metadaten speichern', 'viewer.kicker': 'DOKUMENTANSICHT', 'viewer.close': 'Dokumentansicht schließen', 'viewer.preview': 'Dokumentvorschau',
  'inbox.kicker': 'INBOX', 'inbox.title': 'Inbox-Warteschlange', 'inbox.copy': 'Dateien aus der Inbox werden importiert, verarbeitet und mit ihrem Status hier angezeigt.', 'inbox.refresh': 'Aktualisieren', 'inbox.processAll': 'Alle mit KI verarbeiten', 'inbox.processingAll': 'KI-Verarbeitung läuft…', 'inbox.queueKicker': 'EINGEHENDE DATEIEN', 'inbox.queueTitle': 'Importverlauf', 'inbox.loading': 'Inbox wird geladen…', 'inbox.emptyTitle': 'Noch keine Inbox-Dateien', 'inbox.emptyCopy': 'Dateien im konfigurierten Inbox-Ordner erscheinen hier.', 'inbox.summary.new': 'Neu', 'inbox.summary.processing': 'In Verarbeitung', 'inbox.summary.imported': 'Importiert', 'inbox.summary.waiting': 'warten auf den Worker', 'inbox.summary.worker': 'werden vom Worker verarbeitet', 'inbox.summary.aiReady': 'für KI-Prüfung bereit', 'inbox.suggestion': 'Vorgeschlagener Titel:', 'inbox.openDocuments': 'Dokument öffnen', 'inbox.status.new': 'Neu', 'inbox.status.processing': 'In Verarbeitung', 'inbox.status.imported': 'Importiert', 'inbox.status.duplicate': 'Duplikat', 'inbox.status.rejected': 'Abgelehnt', 'inbox.status.failed': 'Fehlgeschlagen', 'inbox.aiStatus.pending': 'KI ausstehend', 'inbox.aiStatus.processing': 'KI verarbeitet', 'inbox.aiStatus.ready': 'KI bereit', 'inbox.aiStatus.failed': 'KI fehlgeschlagen'
};

const CALMER_COPY: Record<string, TranslationMap> = {
  en: {
    'app.loading': 'Loading your workspace…',
    'app.privateCloud': 'BINDER / DOCUMENTS',
    'app.vault': 'Document workspace',
    'settings.kicker': 'CONFIGURATION',
    'settings.copy': 'Manage the configuration for this workspace.',
    'nav.inbox': 'Inbox',
    'settings.noOwner': 'Select an import owner',
    'settings.admin': 'Admin',
    'login.privateIntelligence': 'DOCUMENT MANAGEMENT',
    'login.headline': 'Your documents.\nOrganized.',
    'login.copy': 'Store, organize, and search your documents in one place. Files remain in your configured storage.',
    'login.privacy': 'Local storage',
    'login.privacyCopy': 'Your files remain in the storage you configure.',
    'login.secureAccess': 'SIGN IN',
    'documents.kicker': 'DOCUMENTS',
    'documents.copy': 'Manage uploaded files and their processing status.',
    'documents.ready': 'No documents yet',
    'documents.empty': 'Upload a PDF to get started.',
    'home.kicker': 'DOCUMENT SEARCH',
    'home.title': 'Search your documents.',
    'home.copy': 'Search titles, filenames, and extracted text. Semantic matches are included when enabled.',
    'home.hint': 'Search by title, filename, or text from a document.',
    'metadata.kicker': 'METADATA',
    'metadata.copy': 'Manage document types, categories, tags, and custom fields.',
    'metadata.workspaceNote': 'System entries are shared across the workspace.',
    'metadata.available': 'VALUES',
    'metadata.create': 'Create a value',
    'metadata.createCopy': 'The value can be used for document classification.',
    'metadata.customCopy': 'Add fields such as project, issue date, or due date. They appear in each document’s metadata editor.',
    'metadata.loading': 'Loading values…',
    'metadata.createFirst': 'Add a value to use it when classifying documents.',
    'metadata.createOne': 'Add a value',
    'setting.inbox.enabled': 'Enable inbox import',
    'setting.inbox.path': 'Inbox path (relative to storage root)',
    'setting.inbox.importOwnerUuid': 'Inbox import owner UUID',
    'setting.inbox.pollIntervalMs': 'Inbox polling interval (ms)',
    'setting.inbox.stabilityMs': 'Inbox file stability delay (ms)'
  },
  de: {
    'app.loading': 'Arbeitsbereich wird geladen…',
    'app.privateCloud': 'BINDER / DOKUMENTE',
    'app.vault': 'Dokumentenarbeitsbereich',
    'settings.kicker': 'KONFIGURATION',
    'settings.copy': 'Konfiguration für diesen Arbeitsbereich verwalten.',
    'nav.inbox': 'Inbox',
    'settings.noOwner': 'Importbesitzer auswählen',
    'settings.admin': 'Admin',
    'login.privateIntelligence': 'DOKUMENTENVERWALTUNG',
    'login.headline': 'Ihre Dokumente.\nÜbersichtlich.',
    'login.copy': 'Dokumente an einem Ort speichern, ordnen und durchsuchen. Die Dateien bleiben in Ihrem konfigurierten Speicher.',
    'login.privacy': 'Lokaler Speicher',
    'login.privacyCopy': 'Ihre Dateien bleiben in dem von Ihnen festgelegten Speicher.',
    'login.secureAccess': 'ANMELDEN',
    'documents.kicker': 'DOKUMENTE',
    'documents.copy': 'Hochgeladene Dateien und ihren Verarbeitungsstatus verwalten.',
    'documents.ready': 'Noch keine Dokumente',
    'documents.empty': 'Laden Sie ein PDF hoch, um zu beginnen.',
    'home.kicker': 'DOKUMENTSUCHE',
    'home.title': 'Dokumente durchsuchen.',
    'home.copy': 'Titel, Dateinamen und extrahierten Text durchsuchen. Bei Aktivierung werden auch semantische Treffer berücksichtigt.',
    'home.hint': 'Nach Titel, Dateiname oder Text aus einem Dokument suchen.',
    'metadata.kicker': 'METADATEN',
    'metadata.copy': 'Dokumenttypen, Kategorien, Tags und benutzerdefinierte Felder verwalten.',
    'metadata.workspaceNote': 'Systemeinträge werden im Arbeitsbereich geteilt.',
    'metadata.available': 'WERTE',
    'metadata.create': 'Wert erstellen',
    'metadata.createCopy': 'Der Wert kann für die Dokumentklassifizierung verwendet werden.',
    'metadata.customCopy': 'Felder wie Projekt, Ausstellungsdatum oder Fälligkeitsdatum hinzufügen. Sie erscheinen im Metadateneditor jedes Dokuments.',
    'metadata.loading': 'Werte werden geladen…',
    'metadata.createFirst': 'Fügen Sie einen Wert hinzu, um ihn bei der Klassifizierung zu verwenden.',
    'metadata.createOne': 'Wert hinzufügen',
    'setting.inbox.enabled': 'Inbox-Import aktivieren',
    'setting.inbox.path': 'Inbox-Pfad (relativ zum Speicherpfad)',
    'setting.inbox.importOwnerUuid': 'UUID des Besitzers für Inbox-Importe',
    'setting.inbox.pollIntervalMs': 'Abfrageintervall der Inbox (ms)',
    'setting.inbox.stabilityMs': 'Wartezeit für stabile Inbox-Dateien (ms)'
  }
};

const EXTENDED_COPY: Record<string, TranslationMap> = {
  en: {
    'setting.ai.automaticClassification.enabled': 'Automatically apply high-confidence AI classification',
    'setting.ai.automaticClassification.confidence': 'Automatic classification confidence threshold (0–1)',
    'setting.ai.automaticClassification.confidence.hint': 'Use a value from 0 to 1. Example: 0.8 means 80%.',
    'inbox.autoApplied': 'Applied automatically',
    'editor.issuer': 'Issuer',
    'editor.issuerHint': 'Reusable sender record',
    'editor.noIssuer': 'No issuer',
    'editor.addIssuer': 'Add issuer',
    'editor.editIssuer': 'Edit issuer',
    'editor.issuerName': 'Name',
    'editor.address': 'Address',
    'editor.zipCode': 'ZIP code',
    'editor.city': 'City',
    'editor.country': 'Country',
    'editor.customIssuerFields': 'Custom issuer fields',
    'editor.issuerJsonHint': 'Optional JSON object for additional issuer data.',
    'editor.saveIssuer': 'Save issuer',
    'editor.cancelIssuer': 'Cancel',
    'home.issuer': 'Issuer',
    'home.anyIssuer': 'Any issuer',
    'setting.inbox.completionStage': 'Remove inbox item after',
    'setting.inbox.completionStage.import': 'Import',
    'setting.inbox.completionStage.ai-analysis': 'AI analysis',
    'inbox.remove': 'Remove'
  },
  de: {
    'setting.ai.automaticClassification.enabled': 'KI-Klassifizierung bei hoher Sicherheit automatisch übernehmen',
    'setting.ai.automaticClassification.confidence': 'Schwellwert für automatische KI-Klassifizierung (0–1)',
    'setting.ai.automaticClassification.confidence.hint': 'Wert zwischen 0 und 1. Beispiel: 0.8 bedeutet 80%.',
    'inbox.autoApplied': 'Automatisch übernommen',
    'editor.issuer': 'Aussteller',
    'editor.issuerHint': 'Wiederverwendbarer Absender',
    'editor.noIssuer': 'Kein Aussteller',
    'editor.addIssuer': 'Aussteller hinzufügen',
    'editor.editIssuer': 'Aussteller bearbeiten',
    'editor.issuerName': 'Name',
    'editor.address': 'Adresse',
    'editor.zipCode': 'PLZ',
    'editor.city': 'Ort',
    'editor.country': 'Land',
    'editor.customIssuerFields': 'Benutzerdefinierte Ausstellerdaten',
    'editor.issuerJsonHint': 'Optionales JSON-Objekt für zusätzliche Ausstellerdaten.',
    'editor.saveIssuer': 'Aussteller speichern',
    'editor.cancelIssuer': 'Abbrechen',
    'home.issuer': 'Aussteller',
    'home.anyIssuer': 'Jeder Aussteller',
    'setting.inbox.completionStage': 'Inbox-Eintrag entfernen nach',
    'setting.inbox.completionStage.import': 'Import',
    'setting.inbox.completionStage.ai-analysis': 'KI-Analyse',
    'inbox.remove': 'Entfernen'
  }
};

@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly language = signal<AppLanguage>(this.initialLanguage());

  setLanguage(language: AppLanguage): void {
    this.language.set(language);
    localStorage.setItem('binder.language', language);
  }

  t(key: string): string {
    const language = this.language().toLowerCase().startsWith('de') ? 'de' : 'en';
    return CALMER_COPY[language][key] ?? EXTENDED_COPY[language]?.[key] ?? (language === 'de' ? DE[key] : EN[key]) ?? EN[key] ?? key;
  }

  name(item: Pick<VocabularyItem, 'name' | 'translations'>): string {
    const translations = item.translations as LocalizedText;
    const language = this.language();
    return translations[language] || translations[language.split('-')[0]] || translations['en'] || translations['de'] || item.name;
  }

  private initialLanguage(): AppLanguage {
    const stored = localStorage.getItem('binder.language');
    if (stored && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(stored)) return stored;
    const browserLanguage = navigator.language;
    return /^[a-z]{2}(?:-[A-Z]{2})?$/.test(browserLanguage) ? browserLanguage : 'en';
  }
}

@Pipe({ name: 't', standalone: true })
export class TranslatePipe implements PipeTransform {
  constructor(private readonly i18n: I18nService) {}
  transform(key: string): string { return this.i18n.t(key); }
}
