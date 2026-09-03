#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="/srv/wljixie/website"
BACKUP_DIR="/srv/wljixie/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="${BACKUP_DIR}/wljixie-${STAMP}.tar.gz"

mkdir -p "${BACKUP_DIR}"
tar -czf "${TARGET}" -C "${SOURCE_DIR}" data private
find "${BACKUP_DIR}" -type f -name 'wljixie-*.tar.gz' -mtime +14 -delete
echo "${TARGET}"
