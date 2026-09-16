import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { config } from "../config/env.js";

// Validates an Azure AD access token the Angular SPA obtained itself via MSAL (public
// client, PKCE - no client secret anywhere in this application, see the Step 1 handoff
// notes). Used once, by the /api/auth/aad/session exchange endpoint, to mint our own
// session cookie (src/auth/session.js) after confirming the token is genuine.
//
// Not usable until AZURE_AD_TENANT_ID / AZURE_AD_CLIENT_ID are set (see workflow.md -
// pending WTT IT completing the app registration). Throws clearly rather than silently
// accepting an unverifiable token.

function getJwksClientOrThrow() {
  const { tenantId } = config.auth.azureAd;
  if (!tenantId) {
    throw new Error(
      "Azure AD is not configured yet (AZURE_AD_TENANT_ID missing) - see workflow.md Step 1 blockers."
    );
  }
  return jwksClient({
    jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
  });
}

function getSigningKey(client, kid) {
  return new Promise((resolve, reject) => {
    client.getSigningKey(kid, (err, key) => {
      if (err) return reject(err);
      resolve(key.getPublicKey());
    });
  });
}

export async function verifyAzureAdToken(accessToken) {
  const { tenantId, clientId } = config.auth.azureAd;
  if (!tenantId || !clientId) {
    throw new Error(
      "Azure AD is not configured yet (AZURE_AD_TENANT_ID/AZURE_AD_CLIENT_ID missing)."
    );
  }
  const client = getJwksClientOrThrow();
  const decodedHeader = jwt.decode(accessToken, { complete: true });
  if (!decodedHeader) throw new Error("Malformed token");

  const publicKey = await getSigningKey(client, decodedHeader.header.kid);
  const claims = jwt.verify(accessToken, publicKey, {
    algorithms: ["RS256"],
    audience: clientId,
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
  });

  const roles = claims.roles ?? [];
  const role = roles.includes("Administrator")
    ? "Administrator"
    : roles.includes("NormalUser")
    ? "NormalUser"
    : null;
  if (!role) {
    throw new Error("Token has no recognised app role (Administrator/NormalUser) assigned");
  }

  return {
    azureAdObjectId: claims.oid,
    username: claims.preferred_username ?? claims.upn ?? claims.email,
    displayName: claims.name,
    role: role === "NormalUser" ? "NormalUser" : "Administrator",
  };
}
