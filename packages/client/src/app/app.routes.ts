import { Routes } from '@angular/router';

export const appRoutes: Routes = [
  {
    path: 'inbox',
    loadComponent: () =>
      import('./features/inbox/components/inbox/inbox.component').then(
        ({ InboxComponent }) => InboxComponent,
      ),
  },
  {
    path: 'logs',
    loadComponent: () =>
      import('./features/logs/components/logs/logs.component').then(
        ({ LogsComponent }) => LogsComponent,
      ),
  },
  {
    path: 'maintenance',
    loadComponent: () =>
      import('./features/maintenance/components/maintenance/maintenance.component').then(
        ({ MaintenanceComponent }) => MaintenanceComponent,
      ),
  },
  {
    path: 'documents',
    loadComponent: () =>
      import('./features/documents/components/documents/documents.component').then(
        ({ DocumentsComponent }) => DocumentsComponent,
      ),
  },
  {
    path: 'documents/:folderid',
    loadComponent: () =>
      import('./features/documents/components/documents/documents.component').then(
        ({ DocumentsComponent }) => DocumentsComponent,
      ),
  },
  {
    path: 'metadata',
    loadComponent: () =>
      import('./features/metadata/components/metadata/metadata.component').then(
        ({ MetadataComponent }) => MetadataComponent,
      ),
  },
  {
    path: 'settings',
    pathMatch: 'full',
    redirectTo: 'settings/common',
  },
  {
    path: 'settings/:section',
    loadComponent: () =>
      import('./features/settings/components/settings/settings.component').then(
        ({ SettingsComponent }) => SettingsComponent,
      ),
  },
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./features/home/components/home/home.component').then(
        ({ HomeComponent }) => HomeComponent,
      ),
  },
  {
    path: '**',
    redirectTo: 'settings/common',
  },
];
