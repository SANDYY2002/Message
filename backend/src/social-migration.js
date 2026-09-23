export async function migrateSocial(conn) {
  const [columns] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='conversations'",
  );
  const names = new Set(columns.map((c) => c.COLUMN_NAME));
  for (const [name, definition] of [
    ["request_status", "VARCHAR(12) NOT NULL DEFAULT 'accepted'"],
    ["request_sender", "INT UNSIGNED NULL"],
  ])
    if (!names.has(name))
      await conn.query(
        `ALTER TABLE conversations ADD COLUMN ${name} ${definition}`,
      );
  const statements = [
    `CREATE TABLE IF NOT EXISTS user_blocks (blocker_id INT UNSIGNED NOT NULL, blocked_id INT UNSIGNED NOT NULL, created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY(blocker_id,blocked_id), INDEX(blocked_id,blocker_id), FOREIGN KEY(blocker_id) REFERENCES users(id), FOREIGN KEY(blocked_id) REFERENCES users(id)) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS follows (follower_id INT UNSIGNED NOT NULL, followed_id INT UNSIGNED NOT NULL, PRIMARY KEY(follower_id,followed_id), INDEX(followed_id,follower_id), FOREIGN KEY(follower_id) REFERENCES users(id), FOREIGN KEY(followed_id) REFERENCES users(id)) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS posts (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, author_id INT UNSIGNED NOT NULL, text TEXT NOT NULL, repost_of INT UNSIGNED NULL, created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3), UNIQUE KEY one_repost(author_id,repost_of), INDEX(author_id,id), FOREIGN KEY(author_id) REFERENCES users(id), FOREIGN KEY(repost_of) REFERENCES posts(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS post_likes (post_id INT UNSIGNED NOT NULL,user_id INT UNSIGNED NOT NULL,PRIMARY KEY(post_id,user_id),FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id)) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS post_bookmarks (post_id INT UNSIGNED NOT NULL,user_id INT UNSIGNED NOT NULL,PRIMARY KEY(post_id,user_id),FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id)) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS post_comments (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,post_id INT UNSIGNED NOT NULL,author_id INT UNSIGNED NOT NULL,text TEXT NOT NULL,created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),INDEX(post_id,id),FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE,FOREIGN KEY(author_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS activities (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,recipient_id INT UNSIGNED NOT NULL,actor_id INT UNSIGNED NOT NULL,kind VARCHAR(16) NOT NULL,post_id INT UNSIGNED NULL,event_key VARCHAR(100) NOT NULL UNIQUE,is_read BOOLEAN NOT NULL DEFAULT FALSE,created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),INDEX(recipient_id,id),FOREIGN KEY(recipient_id) REFERENCES users(id),FOREIGN KEY(actor_id) REFERENCES users(id),FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  ];
  for (const sql of statements) await conn.query(sql);
}
