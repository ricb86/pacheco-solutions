#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  PACHECO SOLUTIONS — gera o pacote instalável para Linux x86_64
#
#  Resultado:
#    dist/pacheco-solutions-<versão>-linux-x64.tar.gz
#    dist/pacheco-solutions-<versão>-linux-x64.tar.gz.sha256
#
#  Uso:
#    ./scripts/build-package.sh
#    deno task package
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -n1)"
[ -n "$VERSION" ] || { echo "❌ Versão não encontrada em package.json"; exit 1; }

NAME="pacheco-solutions-$VERSION-linux-x64"
DIST="$ROOT/dist"
BUILD="$DIST/$NAME"

echo "═══════════════════════════════════════════════════"
echo " PACHECO SOLUTIONS — empacotamento $VERSION"
echo "═══════════════════════════════════════════════════"

rm -rf "$BUILD"
mkdir -p "$BUILD"

echo "🔨 Compilando binário único (Deno)..."
deno compile -A --no-check --output "$BUILD/pacheco-server" "$ROOT/src/index.ts"

echo "🎨 Gerando ícone..."
if command -v rsvg-convert >/dev/null 2>&1; then
  BASE64_LOGO="$(base64 -w0 "$ROOT/public/logo.jpg")"
  SVG="$BUILD/icon.svg"
  cat > "$SVG" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <image width="256" height="256" href="data:image/jpeg;base64,$BASE64_LOGO"/>
</svg>
EOF
  rsvg-convert -w 256 -h 256 "$SVG" -o "$BUILD/icon.png"
  rm -f "$SVG"
else
  echo "   ⚠️  rsvg-convert ausente; usando logo.jpg como ícone."
  echo "      (instale librsvg2-bin para gerar um PNG)"
  cp "$ROOT/public/logo.jpg" "$BUILD/icon.jpg"
fi

echo "📁 Montando pacote..."
cp -R "$ROOT/public" "$BUILD/public"
install -m 755 "$ROOT/packaging/instalar.sh" "$BUILD/instalar.sh"
install -m 755 "$ROOT/packaging/pacheco" "$BUILD/pacheco"
install -m 755 "$ROOT/packaging/desinstalar.sh" "$BUILD/desinstalar.sh"
install -m 644 "$ROOT/packaging/pacheco.desktop" "$BUILD/pacheco.desktop"
install -m 644 "$ROOT/packaging/LEIA-ME.txt" "$BUILD/LEIA-ME.txt"

echo "🗜️  Criando arquivo tar.gz..."
tar -C "$DIST" -czf "$DIST/$NAME.tar.gz" "$NAME"
( cd "$DIST" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256" )

echo
echo "✅ Pacote gerado:"
du -h "$DIST/$NAME.tar.gz" | sed 's/^/   /'
echo "   $DIST/$NAME.tar.gz"
echo "   $DIST/$NAME.tar.gz.sha256"
