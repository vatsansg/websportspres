import { HttpInterceptorFn } from '@angular/common/http';

// Our session is an httpOnly cookie (see server/src/auth/session.js) - every request needs
// to carry it, including cross-origin ones during local dev (Angular on :4200, API on :8080).
export const credentialsInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req.clone({ withCredentials: true }));
};
