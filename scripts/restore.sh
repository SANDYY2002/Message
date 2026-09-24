#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# != 2 || "$2" != --replace-data ]]; then
  echo 'Usage: bash scripts/restore.sh backups/TIMESTAMP --replace-data (overwrites the current database)' >&2
  exit 1
fi
backup_dir="$(realpath "$1")"
(cd "$backup_dir" && sha256sum -c SHA256SUMS)
docker compose stop app
# Leave the app stopped on failure so a partial restore is not served.
docker compose exec -T db sh -c 'MYSQL_PWD="$(cat /run/secrets/db_root_password)" exec mysql -u root message' < "$backup_dir/database.sql"
docker compose run --rm --no-deps -T --entrypoint tar app -C /app/backend/uploads -xzf - < "$backup_dir/uploads.tar.gz"
docker compose run --rm --no-deps migrate
docker compose up -d app proxy
echo 'Restore completed. Verify health, sign-in, message history and media before reopening access.'
