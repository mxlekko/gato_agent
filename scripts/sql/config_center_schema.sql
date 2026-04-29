CREATE TABLE IF NOT EXISTS cfg_scene_configs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scene VARCHAR(128) NOT NULL,
  title VARCHAR(255) NOT NULL,
  enabled TINYINT(1) NOT NULL,
  execution_mode VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  document_json JSON NOT NULL,
  source_text LONGTEXT NOT NULL,
  checksum VARCHAR(64) NOT NULL,
  current_revision_id BIGINT UNSIGNED NULL,
  updated_by VARCHAR(128) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cfg_scene_configs_scene (scene),
  KEY idx_cfg_scene_configs_revision (current_revision_id),
  KEY idx_cfg_scene_configs_status_updated_at (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cfg_platform_resources (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind VARCHAR(32) NOT NULL,
  name VARCHAR(128) NOT NULL,
  version VARCHAR(64) NOT NULL,
  ref VARCHAR(255) NULL,
  scene VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  document_json JSON NOT NULL,
  source_text LONGTEXT NOT NULL,
  checksum VARCHAR(64) NOT NULL,
  current_revision_id BIGINT UNSIGNED NULL,
  updated_by VARCHAR(128) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cfg_platform_resources_kind_name_version (kind, name, version),
  UNIQUE KEY uq_cfg_platform_resources_ref (ref),
  KEY idx_cfg_platform_resources_scene (scene),
  KEY idx_cfg_platform_resources_revision (current_revision_id),
  KEY idx_cfg_platform_resources_kind_status (kind, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cfg_scene_assets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scene VARCHAR(128) NOT NULL,
  asset_type VARCHAR(32) NOT NULL,
  ref VARCHAR(255) NULL,
  content_text LONGTEXT NOT NULL,
  content_format VARCHAR(32) NOT NULL,
  checksum VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  current_revision_id BIGINT UNSIGNED NULL,
  updated_by VARCHAR(128) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cfg_scene_assets_scene_asset_type (scene, asset_type),
  KEY idx_cfg_scene_assets_ref (ref),
  KEY idx_cfg_scene_assets_revision (current_revision_id),
  KEY idx_cfg_scene_assets_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cfg_helper_scripts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scene VARCHAR(128) NOT NULL,
  script_type VARCHAR(64) NOT NULL,
  script_name VARCHAR(255) NOT NULL,
  content_text LONGTEXT NOT NULL,
  checksum VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  current_revision_id BIGINT UNSIGNED NULL,
  updated_by VARCHAR(128) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cfg_helper_scripts_scene_script_type (scene, script_type),
  KEY idx_cfg_helper_scripts_script_name (script_name),
  KEY idx_cfg_helper_scripts_revision (current_revision_id),
  KEY idx_cfg_helper_scripts_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cfg_revisions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  target_type VARCHAR(64) NOT NULL,
  target_id BIGINT UNSIGNED NOT NULL,
  revision_no INT NOT NULL,
  source_text LONGTEXT NOT NULL,
  document_json JSON NULL,
  checksum VARCHAR(64) NOT NULL,
  operator VARCHAR(128) NULL,
  change_note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cfg_revisions_target_revision_no (target_type, target_id, revision_no),
  KEY idx_cfg_revisions_target_created_at (target_type, target_id, created_at),
  KEY idx_cfg_revisions_checksum (checksum)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cfg_releases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  release_id VARCHAR(128) NOT NULL,
  environment VARCHAR(64) NOT NULL,
  scope_type VARCHAR(32) NOT NULL,
  scope_value VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL,
  manifest_json JSON NOT NULL,
  bundle_path VARCHAR(1000) NOT NULL,
  created_by VARCHAR(128) NULL,
  publish_note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cfg_releases_release_id (release_id),
  KEY idx_cfg_releases_scope_status (environment, scope_type, scope_value, status),
  KEY idx_cfg_releases_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cfg_release_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  release_id VARCHAR(128) NOT NULL,
  entry_type VARCHAR(64) NOT NULL,
  entry_key VARCHAR(255) NOT NULL,
  target_id BIGINT UNSIGNED NOT NULL,
  revision_id BIGINT UNSIGNED NOT NULL,
  snapshot_text LONGTEXT NOT NULL,
  snapshot_json JSON NULL,
  checksum VARCHAR(64) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_cfg_release_entries_release_id (release_id),
  KEY idx_cfg_release_entries_release_entry (release_id, entry_type, entry_key),
  KEY idx_cfg_release_entries_revision_id (revision_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cfg_release_pointers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  environment VARCHAR(64) NOT NULL,
  scope_type VARCHAR(32) NOT NULL,
  scope_value VARCHAR(255) NOT NULL,
  active_release_id VARCHAR(128) NOT NULL,
  previous_release_id VARCHAR(128) NULL,
  updated_by VARCHAR(128) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cfg_release_pointers_scope (environment, scope_type, scope_value),
  KEY idx_cfg_release_pointers_active_release_id (active_release_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
