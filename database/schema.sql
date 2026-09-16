-- Schema migration 1. InnoDB and utf8mb4 preserve transactions and emoji.
CREATE TABLE IF NOT EXISTS users (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 username VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 display_name VARCHAR(60) NOT NULL,
 password_hash VARCHAR(255) NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS sessions (
 token_hash CHAR(64) CHARACTER SET ascii PRIMARY KEY,
 user_id INT UNSIGNED NOT NULL,
 expires_at DATETIME(3) NOT NULL,
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
 INDEX (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS conversations (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_low INT UNSIGNED NOT NULL,
 user_high INT UNSIGNED NOT NULL,
 low_read_id INT UNSIGNED NOT NULL DEFAULT 0,
 high_read_id INT UNSIGNED NOT NULL DEFAULT 0,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY pair (user_low, user_high),
 FOREIGN KEY (user_low) REFERENCES users(id),
 FOREIGN KEY (user_high) REFERENCES users(id),
 CHECK (user_low < user_high)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS messages (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 conversation_id INT UNSIGNED NOT NULL,
 sender_id INT UNSIGNED NOT NULL,
 client_id CHAR(36) CHARACTER SET ascii NOT NULL,
 text TEXT NOT NULL,
 media_path VARCHAR(80) NULL,
 media_name VARCHAR(255) NULL,
 media_mime VARCHAR(80) NULL,
 media_size INT UNSIGNED NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY sender_retry (sender_id, client_id),
 INDEX conversation_page (conversation_id, id),
 FOREIGN KEY (conversation_id) REFERENCES conversations(id),
 FOREIGN KEY (sender_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
