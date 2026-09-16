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
