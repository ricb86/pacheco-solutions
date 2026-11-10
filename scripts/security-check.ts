/**
 * Script de Verificação de Segurança
 * Execute antes de fazer deploy: node scripts/security-check.ts
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

interface SecurityIssue {
  file: string;
  line?: number;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;
}

function checkFile(filePath: string): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  
  try {
    const content = readFileSync(resolve(filePath), 'utf-8');
    const lines = content.split('\n');

    // Check hardcoded secrets
    if (content.includes('default-secret-change-in-production')) {
      issues.push({
        file: filePath,
        line: lines.findIndex(l => l.includes('default-secret-change-in-production')) + 1,
        severity: 'CRITICAL',
        message: 'JWT_SECRET hardcoded no código-fonte! Use variável de ambiente.',
      });
    }

    // Check weak passwords in docker-compose
    if (filePath.includes('docker-compose') && content.includes('password=password')) {
      issues.push({
        file: filePath,
        severity: 'HIGH',
        message: 'Senha padrão no docker-compose.yml - usar variáveis de ambiente.',
      });
    }

    // Check permissive CORS
    if (content.includes('app.use(cors())') && !content.includes('origin')) {
      issues.push({
        file: filePath,
        severity: 'HIGH',
        message: 'CORS sem restrição de origem - configurar origin específica.',
      });
    }

  } catch (e) {
    // File not found is OK for optional checks
  }

  return issues;
}

function main() {
  console.log('\n🔒 Verificação de Segurança ExtAt\n');
  
  const filesToCheck = [
    'src/config/env.ts',
    'docker-compose.yml',
    'src/index.ts',
  ];

  let totalIssues = 0;
  const criticalIssues: SecurityIssue[] = [];

  for (const file of filesToCheck) {
    const issues = checkFile(file);
    totalIssues += issues.length;
    
    if (issues.length > 0) {
      console.log(`📄 ${file}:\n`);
      issues.forEach(issue => {
        const icon = issue.severity === 'CRITICAL' ? '🚨' : 
                     issue.severity === 'HIGH' ? '⚠️' : 'ℹ️';
        console.log(`  ${icon} [${issue.severity}] L${issue.line || '?'}: ${issue.message}\n`);
        
        if (issue.severity === 'CRITICAL') {
          criticalIssues.push(issue);
        }
      });
    }
  }

  console.log('─'.repeat(50));
  
  if (criticalIssues.length > 0) {
    console.log(`\n❌ ${criticalIssues.length} problema(s) crítico(s) encontrado(s)!\n`);
    criticalIssues.forEach(issue => {
      console.log(`   • ${issue.message}\n`);
    });
    process.exit(1);
  } else if (totalIssues === 0) {
    console.log('\n✅ Todos os checks de segurança passaram!\n');
  } else {
    console.log(`\n⚠️  ${totalIssues} alerta(s) encontrado(s).\n`);
  }
}

main();
