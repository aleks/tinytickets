#!/bin/sh
# Format first-party Go files, including tests and newly added source files.
set -eu

case "${1:-check}" in
  check) flag=-l ;;
  write) flag=-w ;;
  *) printf 'Usage: %s [check|write]\n' "$0" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."
output=$(find . -type d \( -name .git -o -name node_modules -o -name vendor -o -name dist \) -prune -o \
  -type f -name '*.go' -exec sh -eu -c '
    flag=$1
    shift
    for file do
      # The standard generated-code marker excludes generated source, not user code.
      if ! grep -q "^// Code generated .* DO NOT EDIT\\.$" "$file"; then
        gofmt "$flag" "$file"
      fi
    done
  ' sh "$flag" {} +)

if [ "$flag" = -l ] && [ -n "$output" ]; then
  printf '%s\nRun make fmt-go to format these files.\n' "$output" >&2
  exit 1
fi
