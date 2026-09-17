import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'auth/callback',
    loadComponent: () =>
      import('./features/auth-callback/auth-callback.component').then((m) => m.AuthCallbackComponent),
  },
  {
    path: 'change-password',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/change-password/change-password.component').then(
        (m) => m.ChangePasswordComponent
      ),
  },
  {
    path: 'create-event',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/create-event/create-event.component').then(
        (m) => m.CreateEventComponent
      ),
  },
  {
    path: 'asset-upload',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/asset-upload/asset-upload.component').then(
        (m) => m.AssetUploadComponent
      ),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/dashboard-shell/dashboard-shell.component').then(
        (m) => m.DashboardShellComponent
      ),
  },
  { path: '**', redirectTo: '' },
];
