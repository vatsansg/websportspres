import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// @azure/msal-browser v5's popup flow does NOT work by the opener polling this
// popup's location.href (that was an older MSAL version's mechanism, and my
// first fix here was based on that wrong assumption). This version requires
// the redirect URI page itself to parse the auth response and broadcast it
// back to the window that called loginPopup() over a BroadcastChannel - see
// @azure/msal-browser/redirect-bridge's broadcastResponseToMainFrame(), which
// also transparently handles the loginRedirect() case (navigates home
// instead of broadcasting) if we ever add that flow. Angular must not touch
// the URL before this runs, so this happens instead of bootstrapping Angular
// on this one route, not alongside it.
function hasAuthResponseInUrl(): boolean {
  return /[#&?](code|id_token|access_token|error)=/.test(
    window.location.hash + window.location.search
  );
}

async function main() {
  if (window.location.pathname === '/auth/callback' && hasAuthResponseInUrl()) {
    const { broadcastResponseToMainFrame } = await import(
      '@azure/msal-browser/redirect-bridge'
    );
    await broadcastResponseToMainFrame();
    return;
  }
  await bootstrapApplication(App, appConfig);
}

main().catch((err) => console.error('Bootstrap failed:', err));
