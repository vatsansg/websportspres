import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// MSAL's loginPopup() works by having the OPENER window poll this popup's own
// location.href once Azure AD redirects it back to our origin, reading the
// auth response straight out of the URL fragment. If Angular bootstraps and
// its Router runs its own initial navigation/URL normalization in that popup
// first, it can strip or rewrite that fragment before the opener ever reads
// it - which is exactly what was happening (the popup sat on the static
// "Completing sign-in..." placeholder forever, and the opener's loginPopup()
// call timed out). Detect that exact situation and skip bootstrapping Angular
// entirely, leaving the URL/fragment completely untouched for the opener.
function isPopupCompletingAuthResponse(): boolean {
  const inPopup = !!window.opener && window.opener !== window;
  const hasAuthResponseInHash = /[#&](code|id_token|access_token|error)=/.test(
    window.location.hash
  );
  return inPopup && hasAuthResponseInHash;
}

if (!isPopupCompletingAuthResponse()) {
  bootstrapApplication(App, appConfig).catch((err) => console.error(err));
}
