import { Routes } from '@angular/router';

export const appRoutes: Routes = [
  {
    path: 'settings',
    pathMatch: 'full',
    redirectTo: 'settings/common'
  },
  {
    path: 'settings/:section',
    loadComponent: () => import('./features/settings/components/settings/settings.component')
      .then(({ SettingsComponent }) => SettingsComponent)
  },
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./features/home/components/home/home.component')
      .then(({ HomeComponent }) => HomeComponent)
  },
  {
    path: '**',
    redirectTo: 'settings/common'
  }
];

