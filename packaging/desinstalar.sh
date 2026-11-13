#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  PACHECO SOLUTIONS — desinstalador (instalação por usuário)
#
#  Remove o programa, o atalho e o ícone. Seus dados NÃO são apagados:
#    ~/.local/share/pacheco-solutions  (banco de dados)
#    ~/.config/pacheco-solutions       (configuração/.env)
#
#  Uso:
#    desinstalar.sh        pergunta antes de remover
#    desinstalar.sh -y     remove sem perguntar
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

SELF="$(readlink -f "${BASH_SOURCE[0]}")"
LIB="$(dirname "$SELF")"
PREFIX="$(dirname "$LIB")"

DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/pacheco-solutions"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/pacheco-solutions"

if [ "${1:-}" != "-y" ] && [ "${1:-}" != "--sim" ]; then
  echo "Isto removerá o PACHECO SOLUTIONS de: $PREFIX"
  echo "Seus dados serão mantidos em:"
  echo "  $DATA_DIR"
  echo "  $CONFIG_DIR"
  printf 'Continuar? [s/N] '
  read -r answer
  case "$answer" in
    s|S|y|Y) ;;
    *) echo "Cancelado."; exit 0 ;;
  esac
fi

if [ -x "$PREFIX/bin/pacheco" ]; then
  "$PREFIX/bin/pacheco" stop >/dev/null 2>&1 || true
fi

rm -rf "$LIB"
rm -f "$PREFIX/bin/pacheco"
rm -f "$PREFIX/share/applications/pacheco-solutions.desktop"
rm -f "$PREFIX/share/icons/hicolor/256x256/apps/pacheco-solutions.png"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$PREFIX/share/applications" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q "$PREFIX/share/icons/hicolor" >/dev/null 2>&1 || true
fi

echo "✅ PACHECO SOLUTIONS removido."
echo "   Dados preservados em:"
echo "     $DATA_DIR"
echo "     $CONFIG_DIR"
echo "   Apague essas pastas se quiser remover tudo."
