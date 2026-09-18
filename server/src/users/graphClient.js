import { DefaultAzureCredential } from "@azure/identity";

// Same Managed Identity pattern as db/pool.js and storage/blobClient.js - no client
// secret, no stored credential. The App Service's Managed Identity (both prod and dev
// slots) was granted the Microsoft Graph "User.Read.All" *application* permission
// directly via a Graph app role assignment (Global Admin action, done once, out of band -
// see workflow.md Step 5 User Management) - there is no delegated/user-signed-in path
// here, this is a server-to-server directory lookup.
const credential = new DefaultAzureCredential();
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

// Directory search is scoped to this domain only - the app has no reason to resolve or
// expose identities outside WTT's own tenant domain, even though the Managed Identity's
// Graph permission is technically tenant-wide.
const ALLOWED_DOMAIN = "worldtabletennis.com";

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
 * Searches Microsoft Graph for users in the worldtabletennis.com domain whose display
 * name or email starts with `query`. Used by the User Management screen's "search/type
 * users in the domain" picker (Web BRD-adjacent feature, Step 5 follow-up) so an admin
 * picks a real directory entry instead of hand-typing an email that might not exist.
 */
export async function searchDirectoryUsers(searchQuery) {
  const q = escapeODataLiteral(searchQuery.trim());
  const token = await getGraphToken();

  const filter = [
    `endswith(mail,'@${ALLOWED_DOMAIN}')`,
    `(startswith(displayName,'${q}') or startswith(mail,'${q}') or startswith(userPrincipalName,'${q}'))`,
  ].join(" and ");

  const url = new URL("https://graph.microsoft.com/v1.0/users");
  url.searchParams.set("$filter", filter);
  url.searchParams.set("$select", "id,displayName,mail,userPrincipalName");
  url.searchParams.set("$top", "15");
  url.searchParams.set("$count", "true");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      // Required by Graph for $count and some $filter functions (endswith/startswith
      // combined) on the /users endpoint - "advanced query" support.
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
    }));
}

export const DIRECTORY_DOMAIN = ALLOWED_DOMAIN;
