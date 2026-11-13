#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  PACHECO SOLUTIONS — gera o pacote Debian (.deb) x86_64
#
#  Resultado:
#    dist/pacheco-solutions_<versão>_amd64.deb
#    dist/pacheco-solutions_<versão>_amd64.deb.sha256
#
#  O pacote instala em /usr (precisa de root apenas para instalar):
#    /usr/lib/pacheco-solutions/   binário + interface + desinstalador
#    /usr/bin/pacheco              comando de controle
#    /usr/share/applications/      atalho no menu
#    /usr/share/icons/             ícone
#
#  Os DADOS de cada usuário ficam na pasta dele (XDG):
#    ~/.local/share/pacheco-solutions/pacheco.db
#    ~/.config/pacheco-solutions/.env
#
#  Usa dpkg-deb quando disponível; caso contrário monta o .deb
#  manualmente com ar + tar + gzip (mesmo formato).
#
#  Uso:
#    ./scripts/build-deb.sh
#    deno task package:deb
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -n1)"
[ -n "$VERSION" ] || { echo "❌ Versão não encontrada em package.json"; exit 1; }

NAME="pacheco-solutions"
ARCH="amd64"
PKG="${NAME}_${VERSION}_${ARCH}"

DIST="$ROOT/dist"
BUILD="$DIST/deb/$PKG"
STAGE="$BUILD/root"
CONTROL="$BUILD/DEBIAN"
LIB_DIR="$STAGE/usr/lib/pacheco-solutions"
DEB="$DIST/$PKG.deb"

echo "═══════════════════════════════════════════════════"
echo " PACHECO SOLUTIONS — pacote .deb $VERSION ($ARCH)"
echo "═══════════════════════════════════════════════════"

rm -rf "$BUILD" "$DEB" "$DEB.sha256"
mkdir -p "$LIB_DIR" "$CONTROL" \
  "$STAGE/usr/bin" \
  "$STAGE/usr/share/applications" \
  "$STAGE/usr/share/icons/hicolor/256x256/apps" \
  "$STAGE/usr/share/doc/$NAME"

# ── Binário único (Deno compile) ──────────────────────────────
echo "🔨 Compilando binário único (Deno)..."
deno compile -A --no-check \
  --output "$LIB_DIR/pacheco-server" "$ROOT/src/index.ts"

# ── Interface web ─────────────────────────────────────────────
echo "📁 Copiando interface web..."
cp -R "$ROOT/public" "$LIB_DIR/public"

# ── Launcher / desinstalador ──────────────────────────────────
install -m 755 "$ROOT/packaging/pacheco" "$STAGE/usr/bin/pacheco"

cat > "$LIB_DIR/desinstalar.sh" <<'EOF'
#!/usr/bin/env bash
# PACHECO SOLUTIONS — instalado pelo sistema (pacote .deb)
cat <<'INFO'
Para remover o PACHECO SOLUTIONS instalado pelo sistema, use:

  sudo apt remove pacheco-solutions
  (ou: sudo dpkg -r pacheco-solutions)

Seus dados NÃO são removidos. Para apagá-los também:

  rm -rf ~/.local/share/pacheco-solutions
  rm -rf ~/.config/pacheco-solutions
  rm -rf ~/.local/state/pacheco-solutions
INFO
EOF
chmod 755 "$LIB_DIR/desinstalar.sh"

# ── Ícone ─────────────────────────────────────────────────────
echo "🎨 Gerando ícone..."
ICON_REF="pacheco-solutions"
if command -v rsvg-convert >/dev/null 2>&1; then
  BASE64_LOGO="$(base64 -w0 "$ROOT/public/logo.jpg")"
  SVG="$BUILD/icon.svg"
  cat > "$SVG" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <image width="256" height="256" href="data:image/jpeg;base64,$BASE64_LOGO"/>
</svg>
EOF
  rsvg-convert -w 256 -h 256 "$SVG" \
    -o "$STAGE/usr/share/icons/hicolor/256x256/apps/pacheco-solutions.png"
  rm -f "$SVG"
else
  echo "   ⚠️  rsvg-convert ausente; usando logo.jpg como ícone."
  install -m 644 "$ROOT/public/logo.jpg" \
    "$STAGE/usr/share/icons/hicolor/256x256/apps/pacheco-solutions.jpg"
  ICON_REF="/usr/share/icons/hicolor/256x256/apps/pacheco-solutions.jpg"
fi

# ── Atalho no menu ────────────────────────────────────────────
sed -e 's|@EXEC@|pacheco|g' \
    -e "s|@ICON@|$ICON_REF|g" \
    "$ROOT/packaging/pacheco.desktop" \
    > "$STAGE/usr/share/applications/pacheco-solutions.desktop"
chmod 644 "$STAGE/usr/share/applications/pacheco-solutions.desktop"

install -m 644 "$ROOT/packaging/LEIA-ME.txt" "$STAGE/usr/share/doc/$NAME/LEIA-ME.txt"

# ── Metadados Debian ──────────────────────────────────────────
INSTALLED_SIZE="$(du -sk "$STAGE" | awk '{print $1}')"

cat > "$CONTROL/control" <<EOF
Package: $NAME
Version: $VERSION
Section: office
Priority: optional
Architecture: $ARCH
Installed-Size: $INSTALLED_SIZE
Maintainer: PACHECO SOLUTIONS <contato@pacheco.local>
Depends: bash (>= 4.0)
Recommends: xdg-utils, curl
Homepage: https://github.com/ricb86/pacheco-solutions
Description: gestao financeira P2P e financeiro empresarial
 Aplicativo web local (interface + API) para gestao financeira:
 contas a pagar e a receber, plano de contas, centros de custo,
 fornecedores, DRE, fluxo de caixa, transferencias entre contas
 bancarias, painel gerencial e carteira P2P entre usuarios.
 .
 Roda 100% offline na sua maquina (Deno compilado + SQLite
 embutido), sem Node.js, banco de dados ou servicos externos.
 Os dados de cada usuario ficam em ~/.local/share/pacheco-solutions.
EOF

cat > "$CONTROL/postinst" <<'EOF'
#!/bin/sh
set -e
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q /usr/share/icons/hicolor >/dev/null 2>&1 || true
fi
exit 0
EOF
chmod 755 "$CONTROL/postinst"

cat > "$CONTROL/postrm" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
  fi
  if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -q /usr/share/icons/hicolor >/dev/null 2>&1 || true
  fi
fi
exit 0
EOF
chmod 755 "$CONTROL/postrm"

# ── md5sums ───────────────────────────────────────────────────
( cd "$STAGE" && find . -type f ! -path './DEBIAN/*' -printf '%P\0' \
  | sort -z | xargs -0 md5sum > "$CONTROL/md5sums" )

# ── Montagem do .deb ──────────────────────────────────────────
echo "📦 Montando pacote .deb..."

if command -v dpkg-deb >/dev/null 2>&1; then
  dpkg-deb --build --root-owner-group "$BUILD" "$DEB" >/dev/null
else
  echo "   dpkg-deb ausente — montando manualmente (ar + tar + gzip)."
  WORK="$BUILD/members"
  mkdir -p "$WORK"

  printf '2.0\n' > "$WORK/debian-binary"

  tar -C "$CONTROL" --owner=0 --group=0 --numeric-owner \
      --sort=name -czf "$WORK/control.tar.gz" .
  tar -C "$STAGE" --owner=0 --group=0 --numeric-owner \
      --sort=name -czf "$WORK/data.tar.gz" .

  (
    cd "$WORK"
    ar rcs "$DEB" debian-binary control.tar.gz data.tar.gz
  )
  rm -rf "$WORK"
fi

( cd "$DIST" && sha256sum "$PKG.deb" > "$PKG.deb.sha256" )

echo
echo "✅ Pacote gerado:"
du -h "$DEB" | sed 's/^/   /'
echo "   $DEB"
echo "   $DEB.sha256"
echo
echo "Para instalar:  sudo apt install ./$(basename "$DEB")"
echo "            ou: sudo dpkg -i $(basename "$DEB")"
