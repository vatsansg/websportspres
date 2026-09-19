// Central config, read once from process.env (App Service Application Settings in Azure,
// or a local .env file - see .env.example). No secrets live here; MySQL/Storage auth is
// Managed-Identity-based (see src/db/pool.js, src/storage/blobClient.js).
function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  nodeEnv: process.env.NODE_ENV ?? "development",

  mysql: {
    host: required("MYSQL_HOST", "mysql-sportspres-assetmgmt.mysql.database.azure.com"),
    user: required("MYSQL_AAD_USER"),
    database: required("MYSQL_DATABASE"),
  },

  storage: {
    accountUrl: required(
      "STORAGE_ACCOUNT_URL",
      "https://sasportspresentation.blob.core.windows.net"
    ),
    templatesContainer: process.env.STORAGE_TEMPLATES_CONTAINER ?? "templates",
  },

  auth: {
    sessionSecret: required("SESSION_JWT_SECRET"),
    sessionCookieName: "wtt_assetmgmt_session",
    sessionMaxAgeMs: 12 * 60 * 60 * 1000, // 12 hours
    azureAd: {
      tenantId: process.env.AZURE_AD_TENANT_ID ?? null,
      clientId: process.env.AZURE_AD_CLIENT_ID ?? null,
    },
  },

  maxVideoUploadMb: Number(process.env.MAX_VIDEO_UPLOAD_MB ?? 100),

  // Step 9 (Web BRD Section 29). `recipients` is comma-separated in the App Service
  // setting (BRD: "should be configurable through application settings rather than
  // hard-coded") - supporting more than one address is a deliberate, requested extension
  // beyond the BRD's single literal address, not a deviation from it (the real recipient
  // is still included). `connectionString` is intentionally NOT run through required() -
  // a missing value degrades to "email sending skipped, logged" rather than crashing the
  // whole app at startup, same posture as every other optional-at-boot integration here.
  email: {
    connectionString: process.env.ACS_EMAIL_CONNECTION_STRING ?? null,
    senderAddress: process.env.CHANGE_LOG_EMAIL_SENDER ?? null,
    recipients: (process.env.CHANGE_LOG_EMAIL_RECIPIENT ?? "wtt-naiteam@worldtabletennis.com")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean),
  },
};
