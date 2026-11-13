#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  PACHECO SOLUTIONS — gera o instalador autoextraível (.run)
#
#  Resultado:
#    dist/pacheco-solutions-<versão>-instalador-linux-x64.run
#    dist/pacheco-solutions-<versão>-instalador-linux-x64.run.sha256
#
#  O .run é um arquivo único (script + pacote embutido) que instala
#  o aplicativo em ~/.local, sem root e sem dependências. Ideal para
#  copiar em pendrive e instalar em outro desktop Linux x86_64.
#
#  Uso:
#    ./scripts/build-installer.sh
#    deno task package:installer
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -n1)"
[ -n "$VERSION" ] || { echo "❌ Versão não encontrada em package.json"; exit 1; }

DIST="$ROOT/dist"
TARBALL="$DIST/pacheco-solutions-$VERSION-linux-x64.tar.gz"
OUT="$DIST/pacheco-solutions-$VERSION-instalador-linux-x64.run"

if [ ! -f "$TARBALL" ]; then
  echo "📦 Pacote base não encontrado — gerando com build-package.sh..."
  bash "$ROOT/scripts/build-package.sh"
fi

echo "═══════════════════════════════════════════════════"
echo " PACHECO SOLUTIONS — instalador único $VERSION"
echo "═══════════════════════════════════════════════════"

rm -f "$OUT" "$OUT.sha256"

HEADER="$DIST/.pacheco-installer-header"
cat > "$HEADER" <<'HEADER_EOF'
#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  PACHECO SOLUTIONS — instalador autoextraível (Linux x86_64)
#
#  Uso:
#      bash pacheco-solutions-@VERSION@-instalador-linux-x64.run
#    ou
#      ./pacheco-solutions-@VERSION@-instalador-linux-x64.run
#
#  Instala em ~/.local (sem sudo): programa, comando `pacheco`,
#  atalho no menu de aplicativos e ícone. Seus dados ficam em
#  ~/.local/share/pacheco-solutions.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

SELF="$(readlink -f "$0")"

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ;;
  *)
    echo "❌ Este instalador é para Linux x86_64; detectado: $ARCH" >&2
    exit 1
    ;;
esac

PAYLOAD_LINE="$(awk '/^__PACHECO_PAYLOAD__$/ { print NR + 1; exit }' "$SELF")"
if [ -z "${PAYLOAD_LINE:-}" ]; then
  echo "❌ Arquivo corrompido (pacote embutido não encontrado)." >&2
  echo "   Baixe/copie o instalador novamente." >&2
  exit 1
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/pacheco-instalador.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

echo "📦 Extraindo o aplicativo..."
tail -n +"$PAYLOAD_LINE" "$SELF" | tar -xzf - -C "$TMP"

SRC="$TMP/pacheco-solutions-@VERSION@-linux-x64"
if [ ! -x "$SRC/instalar.sh" ]; then
  echo "❌ Pacote embutido inválido ou incompleto." >&2
  exit 1
fi

bash "$SRC/instalar.sh" "$@"

echo
echo "✅ Instalação concluída."
echo "   Abra pelo menu de aplicativos (PACHECO SOLUTIONS) ou rode: pacheco"
exit 0
__PACHECO_PAYLOAD__
HEADER_EOF

sed -i "s|@VERSION@|$VERSION|g" "$HEADER"

cat "$HEADER" "$TARBALL" > "$OUT"
rm -f "$HEADER"
chmod 755 "$OUT"

( cd "$DIST" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" )

# Cópia com nome curto, para facilitar copiar em pendrive
SHORT="$DIST/PACHECO-SOLUTIONS-Instalador.run"
cp -f "$OUT" "$SHORT"
( cd "$DIST" && sha256sum "$(basename "$SHORT")" > "$(basename "$SHORT").sha256" )

echo
echo "✅ Instalador único gerado:"
du -h "$OUT" | sed 's/^/   /'
echo "   $OUT"
echo "   $SHORT  (nome curto)"
echo "   $OUT.sha256"
echo
echo "Para instalar no outro desktop, copie o arquivo .run e rode:"
echo "   bash $(basename "$OUT")"
