CREATE TABLE IF NOT EXISTS works (
  cid VARCHAR(128) NOT NULL,
  title VARCHAR(512) NOT NULL DEFAULT '',
  affiliate_url TEXT NOT NULL,
  sample_images_json LONGTEXT NOT NULL,
  sample_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  full_page_count INT UNSIGNED NULL,
  volume VARCHAR(128) NOT NULL DEFAULT '',
  review_count INT UNSIGNED NOT NULL DEFAULT 0,
  rating DECIMAL(3,2) NOT NULL DEFAULT 0.00,
  price VARCHAR(64) NOT NULL DEFAULT '',
  asset_bucket VARCHAR(64) NOT NULL DEFAULT 'unknown',
  asset_type VARCHAR(16) NOT NULL DEFAULT 'other',
  release_date DATETIME NULL,
  maker VARCHAR(255) NOT NULL DEFAULT '',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (cid),
  KEY idx_works_feed (is_active, sample_count, review_count, rating),
  KEY idx_works_asset (asset_type, is_active),
  KEY idx_works_release (release_date)
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

CREATE TABLE IF NOT EXISTS work_genres (
  work_cid VARCHAR(128) NOT NULL,
  genre_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (work_cid, genre_id),
  KEY idx_work_genres_genre (genre_id, work_cid),
  CONSTRAINT fk_work_genres_work FOREIGN KEY (work_cid) REFERENCES works(cid) ON DELETE CASCADE,
  CONSTRAINT fk_work_genres_genre FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS anonymous_users (
  id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_anonymous_users_last_seen (last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  anonymous_user_id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  work_cid VARCHAR(128) NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  page_index SMALLINT UNSIGNED NULL,
  max_page SMALLINT UNSIGNED NULL,
  read_ratio DECIMAL(5,4) NULL,
  dwell_ms INT UNSIGNED NULL,
  metadata_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_events_user_time (anonymous_user_id, created_at),
  KEY idx_events_user_type_time (anonymous_user_id, event_type, created_at),
  KEY idx_events_user_work_type (anonymous_user_id, work_cid, event_type),
  KEY idx_events_work_time (work_cid, created_at),
  KEY idx_events_type_time (event_type, created_at),
  CONSTRAINT fk_events_user FOREIGN KEY (anonymous_user_id) REFERENCES anonymous_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_work_states (
  anonymous_user_id CHAR(36) NOT NULL,
  work_cid VARCHAR(128) NOT NULL,
  liked TINYINT(1) NOT NULL DEFAULT 0,
  saved TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (anonymous_user_id, work_cid),
  KEY idx_user_work_states_updated (updated_at),
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
