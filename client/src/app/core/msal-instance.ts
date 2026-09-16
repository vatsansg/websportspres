import { PublicClientApplication } from '@azure/msal-browser';
import type { RuntimeConfig } from './config.service';

// Public client only - PKCE auth code flow, no client secret anywhere in this SPA.
// Cannot be exercised end-to-end until AZURE_AD_TENANT_ID/CLIENT_ID are set on the App
// Service (see workflow.md); config.azureAd.configured is false until then.
export function createMsalInstance(runtimeConfig: RuntimeConfig): PublicClientApplication {
  return new PublicClientApplication({
    auth: {
      clientId: runtimeConfig.azureAd.clientId ?? '',
      authority: `https://login.microsoftonline.com/${runtimeConfig.azureAd.tenantId ?? 'common'}`,
      redirectUri: `${window.location.origin}/auth/callback`,
    },
    cache: {
      cacheLocation: 'sessionStorage',
    },
  });
}
