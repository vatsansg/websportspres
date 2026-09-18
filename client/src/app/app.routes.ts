import { Routes } from '@angular/router';
import { authGuard, adminGuard } from './core/auth.guard';

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
  // Step 5: every other authenticated route now renders inside the real app shell
  // (header + left nav + <router-outlet>) instead of being a bare standalone page - see
  // app-shell.component.
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/app-shell/app-shell.component').then((m) => m.AppShellComponent),
    children: [
      {
        path: '',
        loadComponent: () => import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'create-event',
        loadComponent: () =>
          import('./features/create-event/create-event.component').then((m) => m.CreateEventComponent),
      },
      {
        path: 'events/:eventId/edit',
        loadComponent: () =>
          import('./features/edit-event/edit-event.component').then((m) => m.EditEventComponent),
      },
      {
        path: 'asset-upload',
        loadComponent: () =>
          import('./features/asset-upload/asset-upload.component').then((m) => m.AssetUploadComponent),
      },
      {
        path: 'asset-rules',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/asset-rules-edit/asset-rules-edit.component').then(
            (m) => m.AssetRulesEditComponent
          ),
      },
      {
        path: 'users',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/user-management/user-management.component').then(
            (m) => m.UserManagementComponent
          ),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
