#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  PACHECO SOLUTIONS — instalador para Linux (por usuário)
#
#  Instala em ~/.local sem precisar de sudo:
#    ~/.local/lib/pacheco-solutions/     programa + interface
#    ~/.local/bin/pacheco                comando de controle
#    ~/.local/share/applications/        atalho no menu
#    ~/.local/share/icons/               ícone
#
#  Uso:
#    ./instalar.sh
#    PACHECO_PREFIX=/opt/pacheco ./instalar.sh   (prefixo alternativo)
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${PACHECO_PREFIX:-$HOME/.local}"

LIB="$PREFIX/lib/pacheco-solutions"
BIN_DIR="$PREFIX/bin"
APPS_DIR="$PREFIX/share/applications"
ICONS_DIR="$PREFIX/share/icons/hicolor/256x256/apps"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/pacheco-solutions"
ENV_FILE="$CONFIG_DIR/.env"

ok()   { printf '✅ %s\n' "$*"; }
info() { printf '   %s\n' "$*"; }
fail() { printf '❌ %s\n' "$*" >&2; exit 1; }

# ── Verificações ──────────────────────────────────────────────
[ -f "$SRC/pacheco-server" ] || fail "Arquivo pacheco-server não encontrado. Extraia o pacote completo antes de instalar."
[ -f "$SRC/public/index.html" ] || fail "Pasta public/ não encontrada. Extraia o pacote completo antes de instalar."

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ;;
  *) fail "Este pacote é para Linux x86_64; arquitetura detectada: $ARCH." ;;
esac

if [ "$(id -u)" -eq 0 ]; then
  echo "⚠️  Você está executando como root."
  echo "   O recomendado é instalar como usuário comum (sem sudo)."
  printf 'Continuar mesmo assim? [s/N] '
  read -r answer
  case "$answer" in s|S|y|Y) ;; *) echo "Cancelado."; exit 0 ;; esac
fi

# ── Encerra uma instalação anterior em execução ───────────────
if [ -x "$BIN_DIR/pacheco" ]; then
  "$BIN_DIR/pacheco" stop >/dev/null 2>&1 || true
fi

# ── Programa + interface ──────────────────────────────────────
echo "📦 Instalando PACHECO SOLUTIONS em $PREFIX"
mkdir -p "$LIB" "$BIN_DIR" "$APPS_DIR" "$ICONS_DIR"

install -m 755 "$SRC/pacheco-server" "$LIB/pacheco-server"
rm -rf "$LIB/public"
cp -R "$SRC/public" "$LIB/public"
install -m 755 "$SRC/pacheco" "$BIN_DIR/pacheco"
install -m 755 "$SRC/desinstalar.sh" "$LIB/desinstalar.sh"

# ── Ícone ─────────────────────────────────────────────────────
ICON_REF="pacheco-solutions"
if [ -f "$SRC/icon.png" ]; then
  install -m 644 "$SRC/icon.png" "$ICONS_DIR/pacheco-solutions.png"
elif [ -f "$SRC/icon.jpg" ]; then
  install -m 644 "$SRC/icon.jpg" "$ICONS_DIR/pacheco-solutions.jpg"
  ICON_REF="$ICONS_DIR/pacheco-solutions.jpg"
fi

# ── Atalho no menu de aplicativos ─────────────────────────────
sed -e "s|@EXEC@|\"$BIN_DIR/pacheco\"|g" \
    -e "s|@ICON@|$ICON_REF|g" \
    "$SRC/pacheco.desktop" > "$APPS_DIR/pacheco-solutions.desktop"
chmod 644 "$APPS_DIR/pacheco-solutions.desktop"

# ── Configuração inicial (JWT_SECRET gerado uma única vez) ────
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

if [ ! -f "$ENV_FILE" ]; then
  if command -v openssl >/dev/null 2>&1; then
    SECRET="$(openssl rand -hex 32)"
  else
    SECRET="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  fi

  cat > "$ENV_FILE" <<EOF
# PACHECO SOLUTIONS — configuração local (gerada pelo instalador)
# Edite com cuidado. Reinicie o aplicativo após alterações.
JWT_SECRET=$SECRET
PORT=3001
NODE_ENV=production
AUTH_TOKEN_EXPIRATION=7d
EOF
  chmod 600 "$ENV_FILE"
  info "Configuração criada em $ENV_FILE"
else
  info "Configuração existente mantida em $ENV_FILE"
fi

# ── Atualiza caches do ambiente gráfico (se disponíveis) ──────
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q "$PREFIX/share/icons/hicolor" >/dev/null 2>&1 || true
fi

ok "PACHECO SOLUTIONS instalado!"

echo
echo "🎉 Pronto para usar:"
info "Abra pelo menu de aplicativos (PACHECO SOLUTIONS) ou pelo comando:"
info "  pacheco"
echo
info "Comandos disponíveis:"
info "  pacheco start | stop | status | logs | desinstalar"
echo

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo "⚠️  $BIN_DIR não está no PATH desta sessão."
    echo "   Saia e entre novamente na sessão, ou use o caminho completo:"
    echo "   $BIN_DIR/pacheco"
    ;;
esac
