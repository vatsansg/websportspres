import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const user = auth.currentUser() ?? (await auth.loadSession());
  if (!user) {
    return router.createUrlTree(['/login']);
  }
  return true;
};

// UX-only gate for the Asset Management Settings edit page (Step 5) - hides the route
// from a Normal User rather than showing a 403 page. The real access control is
// server-side (requireRole on /api/asset-rules/raw), same as every other RBAC boundary
// in this app - this guard alone would never be sufficient on its own.
export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const user = auth.currentUser() ?? (await auth.loadSession());
  if (!user) {
    return router.createUrlTree(['/login']);
  }
  if (user.role !== 'SuperAdmin' && user.role !== 'Administrator') {
    return router.createUrlTree(['/']);
  }
  return true;
};
