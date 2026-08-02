#!/usr/bin/env bash
#
# MIERUNE/point-tiler の ptiler バイナリを ~/.local/bin に導入する。
# Linux (x86_64/aarch64) と macOS に対応。Windows は WSL または cargo install を使う。
#
#   usage: scripts/install-ptiler.sh [バージョン]
#          scripts/install-ptiler.sh v0.0.11
#
set -euo pipefail

REPO="MIERUNE/point-tiler"
VERSION="${1:-}"
DEST="${DEST:-$HOME/.local/bin}"

if [ -z "$VERSION" ]; then
  VERSION=$(curl -sL "https://api.github.com/repos/${REPO}/releases/latest" \
    | sed -n 's/.*"tag_name": "\([^"]*\)".*/\1/p')
fi
[ -n "$VERSION" ] || { echo "error: 最新バージョンを取得できませんでした。" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) PLATFORM="apple-darwin" ;;
  Linux)  PLATFORM="unknown-linux-gnu" ;;
  *)      echo "error: 未対応のプラットフォーム $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  arm64|aarch64|armv8*) ARCH="aarch64" ;;
  x86_64|i686*)         ARCH="x86_64" ;;
  *) echo "error: 未対応のアーキテクチャ $(uname -m)" >&2; exit 1 ;;
esac

URL="https://github.com/${REPO}/releases/download/${VERSION}/ptiler-${VERSION}-${ARCH}-${PLATFORM}"

echo "downloading ptiler ${VERSION} (${ARCH}-${PLATFORM})"
mkdir -p "$DEST"
curl -fL --progress-bar -o "$DEST/ptiler" "$URL"
chmod +x "$DEST/ptiler"

echo "installed: $DEST/ptiler"
"$DEST/ptiler" --version

case ":$PATH:" in
  *":$DEST:"*) ;;
  *) echo; echo "note: PATH に $DEST を追加してください:"; echo "  export PATH=\"$DEST:\$PATH\"" ;;
esac
