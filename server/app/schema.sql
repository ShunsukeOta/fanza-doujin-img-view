CREATE TABLE IF NOT EXISTS works (
  cid VARCHAR(128) NOT NULL,
  title VARCHAR(512) NOT NULL DEFAULT '',
  product_url TEXT NULL,
  affiliate_url TEXT NOT NULL,
  description LONGTEXT NULL,
  sample_images_json LONGTEXT NOT NULL,
  sample_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  full_page_count INT UNSIGNED NULL,
  volume VARCHAR(128) NOT NULL DEFAULT '',
  review_count INT UNSIGNED NOT NULL DEFAULT 0,
  rating DECIMAL(3,2) NOT NULL DEFAULT 0.00,
  price VARCHAR(64) NOT NULL DEFAULT '',
  price_value INT UNSIGNED NULL,
  asset_bucket VARCHAR(64) NOT NULL DEFAULT 'unknown',
  asset_type VARCHAR(16) NOT NULL DEFAULT 'other',
  release_date DATETIME NULL,
  maker VARCHAR(255) NOT NULL DEFAULT '',
  maker_id VARCHAR(64) NOT NULL DEFAULT '',
  random_key INT UNSIGNED NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  availability_status VARCHAR(16) NOT NULL DEFAULT 'active',
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata_checked_at DATETIME NULL,
  price_checked_at DATETIME NULL,
  availability_checked_at DATETIME NULL,
  details_checked_at DATETIME NULL,
  details_status VARCHAR(16) NOT NULL DEFAULT 'unknown',
  next_refresh_at DATETIME NULL,
  refresh_fail_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (cid),
  KEY idx_works_feed (is_active, sample_count, review_count, rating),
  KEY idx_works_asset (asset_type, is_active),
  KEY idx_works_price (is_active, price_value),
  KEY idx_works_release (release_date),
  KEY idx_works_random (is_active, random_key, cid),
  KEY idx_works_refresh (is_active, next_refresh_at, cid),
  KEY idx_works_maker (maker_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS genres (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  ruby VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_genres_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS series (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  ruby VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_series_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS work_genres (
  work_cid VARCHAR(128) NOT NULL,
  genre_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (work_cid, genre_id),
  KEY idx_work_genres_genre (genre_id, work_cid),
  CONSTRAINT fk_work_genres_work FOREIGN KEY (work_cid) REFERENCES works(cid) ON DELETE CASCADE,
  CONSTRAINT fk_work_genres_genre FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS work_series (
  work_cid VARCHAR(128) NOT NULL,
  series_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (work_cid, series_id),
  KEY idx_work_series_series (series_id, work_cid),
  CONSTRAINT fk_work_series_work FOREIGN KEY (work_cid) REFERENCES works(cid) ON DELETE CASCADE,
  CONSTRAINT fk_work_series_series FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS work_price_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  work_cid VARCHAR(128) NOT NULL,
  price VARCHAR(64) NOT NULL DEFAULT '',
  price_value INT UNSIGNED NULL,
  observed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_work_price_history_work_time (work_cid, observed_at),
  KEY idx_work_price_history_time (observed_at),
  CONSTRAINT fk_work_price_history_work FOREIGN KEY (work_cid) REFERENCES works(cid) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS anonymous_users (
  id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_anonymous_users_last_seen (last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS feed_sessions (
  id CHAR(36) NOT NULL,
  anonymous_user_id CHAR(36) NOT NULL,
  filter_hash CHAR(64) NOT NULL,
  filter_json TEXT NOT NULL,
  total_count INT UNSIGNED NOT NULL DEFAULT 0,
  generated_count INT UNSIGNED NOT NULL DEFAULT 0,
  recommender_version VARCHAR(32) NOT NULL DEFAULT 'rules-v3',
  random_pivot INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_feed_sessions_user_expiry (anonymous_user_id, expires_at),
  KEY idx_feed_sessions_expiry (expires_at),
  CONSTRAINT fk_feed_sessions_user FOREIGN KEY (anonymous_user_id) REFERENCES anonymous_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS feed_items (
  feed_id CHAR(36) NOT NULL,
  position INT UNSIGNED NOT NULL,
  work_cid VARCHAR(128) NOT NULL,
  source VARCHAR(16) NOT NULL DEFAULT 'explore',
  score DECIMAL(12,6) NOT NULL DEFAULT 0.000000,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (feed_id, position),
  UNIQUE KEY uq_feed_items_work (feed_id, work_cid),
  KEY idx_feed_items_work (work_cid),
  CONSTRAINT fk_feed_items_feed FOREIGN KEY (feed_id) REFERENCES feed_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_feed_items_work FOREIGN KEY (work_cid) REFERENCES works(cid) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id CHAR(36) NULL,
  view_id CHAR(36) NULL,
  event_version SMALLINT UNSIGNED NOT NULL DEFAULT 3,
  anonymous_user_id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  work_cid VARCHAR(128) NOT NULL DEFAULT '',
  event_type VARCHAR(32) NOT NULL,
  feed_id CHAR(36) NULL,
  rank_position INT UNSIGNED NULL,
  page_index SMALLINT UNSIGNED NULL,
  max_page SMALLINT UNSIGNED NULL,
  read_ratio DECIMAL(5,4) NULL,
  dwell_ms INT UNSIGNED NULL,
  placement VARCHAR(32) NULL,
  landing_path VARCHAR(512) NULL,
  source_domain VARCHAR(255) NULL,
  campaign VARCHAR(128) NULL,
  metadata_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_events_event_id (event_id),
  KEY idx_events_user_time (anonymous_user_id, created_at),
  KEY idx_events_user_type_time (anonymous_user_id, event_type, created_at),
  KEY idx_events_user_work_type (anonymous_user_id, work_cid, event_type),
  KEY idx_events_work_time (work_cid, created_at),
  KEY idx_events_type_time (event_type, created_at),
  KEY idx_events_created (created_at),
  KEY idx_events_feed_rank (feed_id, rank_position),
  CONSTRAINT fk_events_user FOREIGN KEY (anonymous_user_id) REFERENCES anonymous_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_work_states (
  anonymous_user_id CHAR(36) NOT NULL,
  work_cid VARCHAR(128) NOT NULL,
  liked TINYINT(1) NOT NULL DEFAULT 0,
  saved TINYINT(1) NOT NULL DEFAULT 0,
  liked_at DATETIME NULL,
  saved_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (anonymous_user_id, work_cid),
  KEY idx_user_work_states_updated (updated_at),
  KEY idx_user_work_states_saved (anonymous_user_id, saved, saved_at, work_cid),
  KEY idx_user_work_states_work_reactions (work_cid, liked, saved),
  CONSTRAINT fk_user_work_states_user FOREIGN KEY (anonymous_user_id) REFERENCES anonymous_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_genre_scores (
  anonymous_user_id CHAR(36) NOT NULL,
  genre_id VARCHAR(64) NOT NULL,
  score DECIMAL(8,4) NOT NULL DEFAULT 0.0000,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (anonymous_user_id, genre_id),
  KEY idx_user_genre_score (anonymous_user_id, score),
  CONSTRAINT fk_user_genre_scores_user FOREIGN KEY (anonymous_user_id) REFERENCES anonymous_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_genre_scores_genre FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_migrations (
  id VARCHAR(128) NOT NULL,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sync_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_type VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  processed_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_message VARCHAR(512) NULL,
  PRIMARY KEY (id),
  KEY idx_sync_runs_type_time (job_type, started_at),
  KEY idx_sync_runs_status_time (status, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
