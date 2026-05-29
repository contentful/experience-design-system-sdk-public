#!/usr/bin/env bash
# Update lockfile when package.json changes
# Ignores all arguments passed by lint-staged
pnpm install --lockfile-only
git add pnpm-lock.yaml 2>/dev/null || true
