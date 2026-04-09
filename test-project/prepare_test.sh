#!/usr/bin/env bash

set -e

# trash is faster than rm, but you need to have it in your system
if ! command -v trash >/dev/null 2>&1; then
    echo "⚠️ 'trash' command not found!"
    echo ""
    echo "Install with Homebrew:"
    echo "  brew install trash"
    exit 1
fi

echo "Trash old node_modules..."
if [ -d "node_modules" ]; then
  trash node_modules
fi

# It's much faster to re-install than to `cp` or `rsync`
echo "Install with pnpm..."
pnpm --reporter=silent i --prod
