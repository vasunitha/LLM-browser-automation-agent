#!/bin/bash
# Elastic Beanstalk postdeploy hook — the instance filesystem is ephemeral
# (a fresh/replaced/scaled-out instance has no SQLite file at all), and
# this app's data is deterministic, non-PII demo data by design (see
# PROJECT_PLAN.md -> "SQLite seed data policy"). The seed script is
# idempotent and safe to re-run, so reseeding after every deploy keeps
# every instance in the same known-good demo state without needing RDS,
# EFS, or any persistent-storage infrastructure.
set -eu
cd /var/app/current
node dist/app/db/seed.js
