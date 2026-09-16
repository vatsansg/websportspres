-- Users table: the Super Admin's local credential (bcrypt hash), plus an upserted-on-login
-- record for each Azure AD user (Administrator / Normal User), so the LED Asset Change Log
-- (Web BRD Section 24) always has a stable "username" to attribute an action to.
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  role ENUM('SuperAdmin', 'Administrator', 'NormalUser') NOT NULL,
  auth_provider ENUM('local', 'azuread') NOT NULL,
  password_hash VARCHAR(255) NULL,
  azure_ad_object_id VARCHAR(64) NULL,
  display_name VARCHAR(255) NULL,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_azure_ad_object_id (azure_ad_object_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- BRD Section 2.1: default first-time Super Admin account. Password below is a placeholder
-- bcrypt hash for 'Admin@123', replaced by the server's first-boot seed script if this table
-- is empty - kept here only so the migration is self-describing.
INSERT INTO users (username, role, auth_provider, password_hash)
SELECT 'first_time_admin', 'SuperAdmin', 'local', '__SEEDED_BY_APPLICATION__'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'first_time_admin');
