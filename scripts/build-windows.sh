#!/usr/bin/env bash
# ===============================================================
#  PACHECO SOLUTIONS — gera o instalador para Windows 10/11 x64
#
#  Resultado:
#    dist/pacheco-solutions-<versao>-windows-x64-instalador.exe
#    dist/pacheco-solutions-<versao>-windows-x64.zip
#    dist/PACHECO-SOLUTIONS-Instalador-Windows.exe  (copia curta)
#    dist/pacheco-solutions-<versao>-windows-x64.sha256
#
#  Requisitos:
#    - Deno 2.x (compila o alvo x86_64-pc-windows-msvc)
#    - NSIS 3.x (makensis) para gerar o instalador
#    - rsvg-convert (librsvg2-bin) e python3 para o icone .ico
#    - zip (ou python3) para o pacote portatil
#
#  Uso:
#    ./scripts/build-windows.sh
#    deno task package:windows
#    MAKENSIS=/caminho/makensis ./scripts/build-windows.sh
# ===============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -n1)"
[ -n "$VERSION" ] || { echo "❌ Versão não encontrada em package.json"; exit 1; }

NAME="pacheco-solutions-$VERSION-windows-x64"
DIST="$ROOT/dist"
BUILD="$DIST/$NAME"
APP="$BUILD/app"
INSTALLER="$DIST/$NAME-instalador.exe"
PORTABLE="$DIST/$NAME.zip"
SHORT="$DIST/PACHECO-SOLUTIONS-Instalador-Windows.exe"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "❌ Comando obrigatório não encontrado: $1"
    exit 1
  }
}

need deno
need python3
need base64
need rsvg-convert

# ── Localiza o makensis ────────────────────────────────────────
MAKENSIS_BIN="${MAKENSIS:-}"
if [ -z "$MAKENSIS_BIN" ]; then
  if command -v makensis >/dev/null 2>&1; then
    MAKENSIS_BIN="$(command -v makensis)"
  elif [ -x "$HOME/.cache/nsis-portable/usr/bin/makensis" ]; then
    MAKENSIS_BIN="$HOME/.cache/nsis-portable/usr/bin/makensis"
    export NSISDIR="${NSISDIR:-$HOME/.cache/nsis-portable/usr/share/nsis}"
  else
    echo "❌ makensis (NSIS) não encontrado."
    echo "   Instale com: sudo apt install nsis"
    echo "   Ou aponte o binário: MAKENSIS=/caminho/makensis ./scripts/build-windows.sh"
    exit 1
  fi
fi

echo "═══════════════════════════════════════════════════"
echo " PACHECO SOLUTIONS — pacote Windows $VERSION"
echo "═══════════════════════════════════════════════════"
echo "   NSIS: $MAKENSIS_BIN"

rm -rf "$BUILD"
mkdir -p "$APP"

# ── Ícone .ico (múltiplos tamanhos, PNG embutido) ──────────────
echo "🎨 Gerando ícone .ico..."
BASE64_LOGO="$(base64 -w0 "$ROOT/public/logo.jpg")"
ICON_SRC="$BUILD/icon"
mkdir -p "$ICON_SRC"

for size in 256 128 64 48 32 16; do
  SVG="$ICON_SRC/icon-$size.svg"
  cat > "$SVG" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" width="$size" height="$size" viewBox="0 0 $size $size">
  <rect width="$size" height="$size" fill="#ffffff"/>
  <image x="4%" y="26%" width="92%" height="48%" preserveAspectRatio="xMidYMid meet" href="data:image/jpeg;base64,$BASE64_LOGO"/>
</svg>
EOF
  rsvg-convert -w "$size" -h "$size" "$SVG" -o "$ICON_SRC/icon-$size.png"
done

python3 - "$ICON_SRC" "$APP/pacheco.ico" <<'PY'
import os
import struct
import sys

src, dst = sys.argv[1], sys.argv[2]
sizes = [256, 128, 64, 48, 32, 16]
images = []
for size in sizes:
    with open(os.path.join(src, f"icon-{size}.png"), "rb") as fh:
        images.append((size, fh.read()))

header = struct.pack("<HHH", 0, 1, len(images))
offset = 6 + 16 * len(images)
entries = bytearray()
blobs = bytearray()
for size, data in images:
    dim = 0 if size >= 256 else size
    entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
    blobs += data
    offset += len(data)

with open(dst, "wb") as fh:
    fh.write(header + entries + blobs)
PY

# ── Binário Windows ────────────────────────────────────────────
echo "🔨 Compilando pacheco-server.exe (Deno → Windows x64)..."
deno compile -A --no-check \
  --config "$ROOT/deno.json" \
  --target x86_64-pc-windows-msvc \
  --output "$APP/pacheco-server.exe" \
  "$ROOT/src/index.ts"

# ── Interface e arquivos de apoio ──────────────────────────────
echo "📁 Montando pasta do aplicativo..."
cp -R "$ROOT/public" "$APP/public"
cp "$ROOT/packaging/windows/LEIA-ME.txt" "$APP/LEIA-ME.txt"
cp "$ROOT/packaging/windows/pacheco-launcher.vbs" "$APP/pacheco-launcher.vbs"
cp "$ROOT/packaging/windows/pacheco.cmd" "$APP/pacheco.cmd"

# Codificações amigáveis ao Windows:
#   .vbs → UTF-16 LE com BOM (WSH exibe acentos corretamente)
#   .txt → UTF-8 com BOM + CRLF (Notepad)
#   .cmd → CRLF (ASCII)
python3 - "$APP" <<'PY'
import sys
from pathlib import Path

app = Path(sys.argv[1])

def write_utf16(path: Path, data: str) -> None:
    path.write_bytes(b"\xff\xfe" + data.replace("\n", "\r\n").encode("utf-16-le"))

def write_utf8_bom(path: Path, data: str) -> None:
    path.write_bytes(b"\xef\xbb\xbf" + data.replace("\n", "\r\n").encode("utf-8"))

def write_crlf(path: Path, data: str) -> None:
    path.write_bytes(data.replace("\n", "\r\n").encode("ascii"))

vbs = app / "pacheco-launcher.vbs"
write_utf16(vbs, vbs.read_text(encoding="utf-8"))

readme = app / "LEIA-ME.txt"
write_utf8_bom(readme, readme.read_text(encoding="utf-8"))

cmd = app / "pacheco.cmd"
write_crlf(cmd, cmd.read_text(encoding="utf-8"))
PY

# ── Instalador NSIS ────────────────────────────────────────────
echo "📦 Compilando instalador NSIS..."
VERSION4="$VERSION"
case "$VERSION4" in
  *[!0-9.]*|*.*.*.*) VERSION4="$(printf '%s' "$VERSION" | sed 's/[^0-9.].*//')" ;;
esac
case "$VERSION4" in
  *.*.*.*) : ;;
  *.*.*) VERSION4="$VERSION4.0" ;;
  *.*) VERSION4="$VERSION4.0.0" ;;
  *) VERSION4="$VERSION4.0.0.0" ;;
esac

"$MAKENSIS_BIN" -V2 \
  -DOUTFILE="$INSTALLER" \
  -DAPPVERSION="$VERSION" \
  -DAPPVERSION4="$VERSION4" \
  -DAPPICON="$APP/pacheco.ico" \
  -DAPPDIR="$APP" \
  "$ROOT/packaging/windows/installer.nsi"

# ── Pacote portátil (ZIP) ─────────────────────────────────────
echo "🗜️  Gerando pacote portátil (.zip)..."
if command -v zip >/dev/null 2>&1; then
  ( cd "$APP" && zip -q -r "$PORTABLE" . )
else
  python3 - "$APP" "$PORTABLE" <<'PY'
import os
import sys
import zipfile

src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for root, dirs, files in os.walk(src):
        for name in files:
            full = os.path.join(root, name)
            arc = os.path.relpath(full, src)
            zf.write(full, arc)
PY
fi

# ── Cópia com nome curto + hashes ─────────────────────────────
cp -f "$INSTALLER" "$SHORT"
( cd "$DIST" && sha256sum \
    "$(basename "$INSTALLER")" \
    "$(basename "$SHORT")" \
    "$(basename "$PORTABLE")" > "$NAME.sha256" )

echo
echo "✅ Artefatos Windows gerados:"
ls -lh "$INSTALLER" "$SHORT" "$PORTABLE" "$DIST/$NAME.sha256" | sed 's/^/   /'
echo
echo "   Instalador: $INSTALLER"
echo "   Nome curto: $SHORT"
echo "   Portátil:   $PORTABLE"
echo "   Hashes:     $DIST/$NAME.sha256"
