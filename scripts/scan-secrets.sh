#!/bin/sh
# Scans the whole git history for anything that looks like a credential.
# Runs before every push (see .githooks/pre-push) and in CI.
set -e

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks is not installed. Get it from https://github.com/gitleaks/gitleaks#installing" >&2
  echo "The push is blocked until the scan can run." >&2
  exit 1
fi

gitleaks git --redact --no-banner --exit-code 1 .
