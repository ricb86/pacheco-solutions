#!/usr/bin/env deno
// Script de inicialização do EXTAT Platform
// Execute: deno run --allow-read --allow-write --allow-run --allow-env start.ts

import { execSync } from 'child_process';

console.log('═══════════════════════════════════════════════════════');
console.log('        INICIANDO SISTEMA EXTAT PLATFORM              ');
console.log('═══════════════════════════════════════════════════════\n');

// 1. Instalar dependências
console.log('📦 PASSO 1: Instalando dependências...\n');
try {
  execSync('npm install --silent', { 
    cwd: '/home/user/repositorio_extat_platform',
    stdio: 'inherit'
  });
  console.log('✅ Dependências instaladas!\n');
} catch (error) {
  console.log('⚠️ Instalando novamente...\n');
  execSync('npm install', { 
    cwd: '/home/user/repositorio_extat_platform',
    stdio: 'inherit'
  });
}

// 2. Verificar se docker-compose está disponível
console.log('\n═══════════════════════════════════════════════════════');
console.log('        PASSO 2: Iniciar containers                 ');
console.log('═══════════════════════════════════════════════════════\n');

try {
  execSync('docker-compose --version', { stdio: 'ignore' });
  console.log('🐳 Docker Compose disponível. Iniciando...\n');
  execSync('docker-compose up -d', { 
    cwd: '/home/user/repositorio_extat_platform',
    stdio: 'inherit'
  });
} catch (error) {
  console.log('⚠️ Docker não disponível. Usando npm run dev...\n');
  execSync('npm run dev', { 
    cwd: '/home/user/repositorio_extat_platform',
    stdio: 'inherit'
  });
}

console.log('\n═══════════════════════════════════════════════════════');
console.log('        ✅ SISTEMA INICIADO COM SUCESSO!           ');
console.log('═══════════════════════════════════════════════════════\n');
console.log('📍 URL Principal:    http://localhost:3000');
console.log('📊 Health Check:     http://localhost:3000/health');
console.log('🔐 Auth Endpoint:    http://localhost:3000/auth/login');
console.log('💰 Transações:       http://localhost:3000/transactions');
console.log('\n✅ Sistema pronto para análise!\n');