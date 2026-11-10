#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  EXTAT PLATFORM — Executável de inicialização
#
#  Uso:
#    ./iniciar-extat.sh          inicia o servidor (porta do .env)
#    ./iniciar-extat.sh dev      inicia em modo desenvolvimento (watch)
#    ./iniciar-extat.sh stop     finaliza o servidor em execução
#    ./iniciar-extat.sh status   verifica se o servidor está ativo
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

# ── Localizar o diretório real do projeto ─────────────────────
# Resolve symlinks (quando instalado em ~/.local/bin, aponta de volta
# para a raiz do projeto). Sobrescreva com EXTAT_HOME se mover o projeto.
if [ -n "${EXTAT_HOME:-}" ] && [ -d "$EXTAT_HOME" ]; then
  PROJECT_DIR="$EXTAT_HOME"
else
  SELF="$(readlink -f "${BASH_SOURCE[0]}")"
  PROJECT_DIR="$(dirname "$SELF")"
fi

SERVER_CMD="deno run -A --no-check src/index.ts"

# ── Localizar o Deno ──────────────────────────────────────────
if [ -x "$HOME/.deno/bin/deno" ]; then
  DENO="$HOME/.deno/bin/deno"
elif command -v deno >/dev/null 2>&1; then
  DENO="$(command -v deno)"
else
  echo "❌ Deno não encontrado. Instale com:"
  echo "   curl -fsSL https://deno.land/install.sh | sh"
  exit 1
fi

# ── Helpers ───────────────────────────────────────────────────
running_pid() {
  pgrep -f "$SERVER_CMD" | head -1 || true
}

stop_server() {
  if PID=$(running_pid); then
    kill "$PID" 2>/dev/null || true
    sleep 1
    echo "🛑 Servidor finalizado (PID $PID)."
  else
    echo "ℹ️  Nenhum servidor em execução."
  fi
}

start_server() {
  # Finaliza instância anterior (semântica de reinício do lançador)
  if PID=$(running_pid); then
    kill "$PID" 2>/dev/null || true
    sleep 1
    echo "♻️  Reiniciando servidor (instância anterior finalizada)…"
  fi

  cd "$PROJECT_DIR"

  # .env — cria com segredo JWT gerado na primeira execução
  if [ ! -f .env ] && [ -f .env.example ]; then
    cp .env.example .env
    SECRET=$("$DENO" eval "console.log(crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''))")
    sed -i "s|<gere-um-segredo-aqui>|$SECRET|" .env
    echo "✅ .env criado com JWT_SECRET gerado automaticamente"
  fi

  # Dependências — instala na primeira execução
  if [ ! -d node_modules ]; then
    echo "📦 Instalando dependências (primeira execução)…"
    "$DENO" install --quiet
  fi

  # Banco — cria dados de demonstração na primeira execução
  DB_PATH=$(grep -E '^DB_PATH=' .env | cut -d= -f2-)
  DB_PATH="${DB_PATH:-./data/extat.db}"
  case "$DB_PATH" in
    /*) ;;
    *) DB_PATH="$PROJECT_DIR/$DB_PATH" ;;
  esac
  if [ ! -f "$DB_PATH" ]; then
    echo "🌱 Primeira execução — criando banco com dados de demonstração…"
    "$DENO" run -A --no-check scripts/seed.ts
  fi

  # Porta
  PORT=$(grep -E '^PORT=' .env | cut -d= -f2-)
  PORT="${PORT:-3001}"

  echo "═══════════════════════════════════════════════════════"
  echo "        INICIANDO EXTAT PLATFORM                       "
  echo "═══════════════════════════════════════════════════════"
  echo ""
  echo "📍 URL Principal:    http://localhost:$PORT"
  echo "📊 Health Check:     http://localhost:$PORT/health"
  echo "🔐 Login demo:        admin@extat.local / Admin@123"
  echo "💰 Transações:        http://localhost:$PORT/transactions"
  echo ""
  echo "▶️  Servidor iniciando (Ctrl+C para parar)…"
  echo ""
  exec "$DENO" run -A --no-check src/index.ts
}

# ── Comandos ───────────────────────────────────────────────────
case "${1:-start}" in
  start)
    start_server
    ;;
  dev)
    cd "$PROJECT_DIR"
    [ -d node_modules ] || "$DENO" install --quiet
    exec "$DENO" run -A --watch src/index.ts
    ;;
  stop)
    stop_server
    ;;
  status)
    if PID=$(running_pid); then
      echo "✅ Servidor em execução (PID $PID)."
      curl -s -m 3 "http://localhost:${PORT:-3001}/health" && echo
    else
      echo "⛔ Servidor não está em execução."
      exit 1
    fi
    ;;
  *)
    echo "Uso: $0 [start|dev|stop|status]"
    exit 1
    ;;
esac
