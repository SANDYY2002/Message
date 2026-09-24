#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p backups
backup_dir="backups/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir "$backup_dir"
# Pause app writes so the SQL dump and media archive describe the same state.
docker compose stop app
trap 'docker compose start app >/dev/null' EXIT
docker compose exec -T db sh -c 'MYSQL_PWD="$(cat /run/secrets/db_root_password)" exec mysqldump -u root --single-transaction --no-tablespaces --set-gtid-purged=OFF message' > "$backup_dir/database.sql"
docker compose run --rm --no-deps -T --entrypoint tar app -C /app/backend/uploads -czf - . > "$backup_dir/uploads.tar.gz"
(cd "$backup_dir" && sha256sum database.sql uploads.tar.gz > SHA256SUMS)
printf 'Backup saved to %s. Copy it to encrypted off-server storage.\n' "$backup_dir"
