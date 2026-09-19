import { DefaultAzureCredential } from "@azure/identity";

// Same Managed Identity pattern as db/pool.js and storage/blobClient.js - no client
// secret, no stored credential. The App Service's Managed Identity (both prod and dev
// slots) was granted the Microsoft Graph "User.Read.All" *application* permission
// directly via a Graph app role assignment (Global Admin action, done once, out of band -
// see workflow.md Step 5 User Management) - there is no delegated/user-signed-in path
// here, this is a server-to-server directory lookup.
const credential = new DefaultAzureCredential();
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

async function getGraphToken() {
  const token = await credential.getToken(GRAPH_SCOPE);
  return token.token;
}

function escapeODataLiteral(value) {
  // OData string literals are single-quoted; a literal single quote is escaped by
  // doubling it. Applied to anything interpolated into a $filter query string below.
  return value.replace(/'/g, "''");
}

/**
 * Searches Microsoft Graph for users in the WTT Azure AD tenant whose display name,
 * email, or UPN starts with `query`. Used by the User Management screen's directory
 * picker so an admin picks a real directory entry instead of hand-typing an email that
 * might not exist.
 *
 * Deliberately not filtered to any particular email domain (an earlier version of this
 * restricted results to @worldtabletennis.com addresses) - per the user's explicit
 * correction (2026-09-18), real WTT staff and partners are frequently Azure AD B2B
 * *guest* accounts in this tenant with an external email (e.g. an ittf.com address
 * invited into worldtabletennis.com), and `GET /users` already only ever returns
 * identities that are actually members or guests of this one tenant - that membership
 * is the real security boundary, not a string match on the email domain.
 */
export async function searchDirectoryUsers(searchQuery) {
  const q = escapeODataLiteral(searchQuery.trim());
  const token = await getGraphToken();

  const filter = `startswith(displayName,'${q}') or startswith(mail,'${q}') or startswith(userPrincipalName,'${q}')`;

  const url = new URL("https://graph.microsoft.com/v1.0/users");
  url.searchParams.set("$filter", filter);
  url.searchParams.set("$select", "id,displayName,mail,userPrincipalName,userType");
  url.searchParams.set("$top", "15");
  url.searchParams.set("$count", "true");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      // Required by Graph for $count and some $filter functions (startswith across
      // multiple properties) on the /users endpoint - "advanced query" support.
      ConsistencyLevel: "eventual",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Directory search failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  return (data.value ?? [])
    .filter((u) => !!u.mail)
    .map((u) => ({
      azureAdObjectId: u.id,
      displayName: u.displayName,
      email: u.mail,
      userPrincipalName: u.userPrincipalName,
      isGuest: u.userType === "Guest",
    }));
}
