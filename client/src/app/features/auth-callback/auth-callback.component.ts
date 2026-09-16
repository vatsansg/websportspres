import { Component } from '@angular/core';

// MSAL's popup sign-in flow completes here (redirectUri registered with Azure AD, see the
// Step 1 handoff notes for the exact instructions given to WTT IT). msal-browser resolves
// the popup's response before this page needs to do anything further; it just needs to
// exist and not error if the popup briefly renders the app shell.
@Component({
  selector: 'app-auth-callback',
  standalone: true,
  template: `<div class="wtt-callback">Completing sign-in...</div>`,
  styles: [
    `.wtt-callback { display: flex; align-items: center; justify-content: center; min-height: 100vh; }`,
  ],
})
export class AuthCallbackComponent {}
