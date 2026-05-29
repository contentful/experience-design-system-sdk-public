#!/bin/bash

# This script runs pre-commit checks on affected projects
# It ignores any file arguments passed by lint-staged

set -e

# Run lint:fix, typecheck, and test for all uncommitted changes.
# --skip-nx-cache prevents stale lint cache hits from letting formatting errors
# slip through to CI. typecheck and test remain cached for speed.
nx affected --target=lint:fix --uncommitted --parallel=3 --skip-nx-cache
nx affected --target=typecheck,test --uncommitted --parallel=3
