#!/bin/sh
set -eu

export DATABASE_URL="${DATABASE_URL:-file:/app/data/fleebee.db}"

mkdir -p /app/data

npx prisma db push

exec node server.js
