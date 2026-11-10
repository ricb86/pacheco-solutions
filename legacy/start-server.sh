#!/bin/bash
set -e

echo "═══════════════════════════════════════════════════════"
echo "        INICIANDO EXTAT PLATFORM                       "
echo "═══════════════════════════════════════════════════════"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependências..."
    npm install
else
    echo "✅ Dependências já instaladas"
fi

# Create .env if not exists
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    cp .env.example .env
    echo "✅ .env criado a partir de .env.example"
else
    echo "ℹ️  .env já existe ou não encontrado exemplo"
fi

echo ""
echo "🏗️  Compilando TypeScript..."
npm run build

echo ""
echo "🚀 Iniciando servidor na porta 3000..."
node dist/index.js &
SERVER_PID=$!

sleep 2

# Health check
echo ""
curl -s http://localhost:3000/health || echo "⏳ Aguardando inicialização do servidor..."

echo ""
echo "═══════════════════════════════════════════════════════"
echo "        🎉 SISTEMA RODANDO EM: http://localhost:3000    "
echo "═══════════════════════════════════════════════════════"
