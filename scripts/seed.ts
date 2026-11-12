/**
 * PACHECO SOLUTIONS — Seed de dados de demonstração
 *
 * Cria usuários de teste com saldo inicial (idempotente — pode rodar
 * quantas vezes quiser; dados existentes não são duplicados).
 *
 *   deno task seed
 *
 * Contas criadas:
 *   admin@pacheco.local  / Admin@123  (role: admin, saldo R$ 1.000,00)
 *   maria@pacheco.local  / Maria@123  (saldo R$ 500,00 — owner da empresa demo)
 *   joao@pacheco.local   / Joao@123   (saldo R$ 250,00 — membro da empresa demo)
 *
 * Módulo financeiro (escopo EXTAT):
 *   - catálogo de bancos brasileiros (código Comp)
 *   - empresa "Comercial Pacheco Ltda" (maria = owner, joão = membro)
 *   - plano de contas padrão BR (receitas 3.x / despesas 4.x)
 *   - 2 contas bancárias (Banco do Brasil e Nubank PJ)
 *   - fornecedores e centros de custo
 *   - 13 movimentações cobrindo TODOS os status:
 *     pago · pago_parcial · vence_hoje · a_vencer · vencido
 *     (+ um pagamento estornado no modelo livro-caixa)
 */

import bcrypt from 'bcryptjs';
import { connectDatabase, query } from '../src/config/database.ts';
import { config } from '../src/config/env.ts';
import { logger } from '../src/utils/logger.ts';

interface SeedUser {
  username: string;
  email: string;
  password: string;
  name: string;
  role: 'user' | 'admin';
  balanceCents: number;
}

const DEMO_USERS: SeedUser[] = [
  {
    username: 'admin',
    email: 'admin@pacheco.local',
    password: 'Admin@123',
    name: 'Administrador Pacheco',
    role: 'admin',
    balanceCents: 100_000, // R$ 1.000,00
  },
  {
    username: 'maria',
    email: 'maria@pacheco.local',
    password: 'Maria@123',
    name: 'Maria Silva',
    role: 'user',
    balanceCents: 50_000, // R$ 500,00
  },
  {
    username: 'joao',
    email: 'joao@pacheco.local',
    password: 'Joao@123',
    name: 'João Souza',
    role: 'user',
    balanceCents: 25_000, // R$ 250,00
  },
];

/* ── Catálogo de bancos (código Comp) ─────────────────────── */

const BANKS: Array<[code: string, label: string]> = [
  ['001', 'Banco do Brasil'],
  ['004', 'Banco do Nordeste'],
  ['033', 'Banco Santander'],
  ['041', 'Banco Banrisul'],
  ['077', 'Banco Inter'],
  ['104', 'Caixa Econômica Federal'],
  ['208', 'Banco BTG Pactual'],
  ['237', 'Banco Bradesco'],
  ['260', 'Nu Pagamentos (Nubank)'],
  ['290', 'PagSeguro'],
  ['323', 'Mercado Pago'],
  ['336', 'Banco C6'],
  ['341', 'Banco Itaú'],
  ['380', 'PicPay'],
  ['422', 'Banco Safra'],
  ['748', 'Sicredi'],
  ['756', 'Sicoob'],
];

/* ── Helpers de data (UTC, mesmo relógio do servidor) ─────── */

/** Data ISO 'AAAA-MM-DD' com deslocamento em dias (0 = hoje). */
function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Mês de competência 'AAAA-MM' com deslocamento (0 = mês atual). */
function month(offsetMonths: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offsetMonths);
  return d.toISOString().slice(0, 7);
}

const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/* ── Seed de usuários ────────────────────────────────────── */

async function seedUsers(): Promise<number> {
  let created = 0;
  for (const user of DEMO_USERS) {
    const existing = await query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [user.email, user.username],
    );
    if (existing.rows.length > 0) {
      logger.info(`↷ ${user.email} já existe — ignorado`);
      continue;
    }

    const passwordHash = await bcrypt.hash(user.password, config.bcryptSaltRounds);
    await query(
      `INSERT INTO users (username, email, password_hash, name, balance, role)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        user.username,
        user.email,
        passwordHash,
        user.name,
        user.balanceCents,
        user.role,
      ],
    );
    created++;
    logger.info(
      `✚ ${user.email} criado (saldo R$ ${(user.balanceCents / 100).toFixed(2)})`,
    );
  }
  return created;
}

/* ── Seed do módulo financeiro ───────────────────────────── */

interface SeedPayment {
  amountCents: number;
  dateOffset: number;
  method: string;
  account: 'bb' | 'nu';
  reversed?: { dateOffset: number; reason: string };
}

interface SeedTx {
  type: 'receita' | 'despesa';
  amountCents: number;
  reference: string;
  moreInfos?: string;
  contact?: string;
  competenceMonthsFromNow: number;
  dueOffset: number;
  coaCode: string;
  account: 'bb' | 'nu';
  supplierName?: string;
  costCenterName?: string;
  payments?: SeedPayment[];
}

async function seedFinance(): Promise<void> {
  // catálogo de bancos (global, idempotente)
  for (const [code, label] of BANKS) {
    await query(
      `INSERT INTO banks (code, label) VALUES ($1, $2)
       ON CONFLICT(code) DO NOTHING`,
      [code, label],
    );
  }
  logger.info(`🏦 Catálogo de bancos: ${BANKS.length} bancos disponíveis`);

  // empresa demo — idempotente por CNPJ
  const companyDocument = '12.345.678/0001-90';
  const existingCompany = await query(
    `SELECT id FROM companies WHERE document = $1`,
    [companyDocument],
  );
  if (existingCompany.rows.length) {
    logger.info('↷ Empresa demo já existe — seed financeiro ignorado');
    return;
  }

  const maria = await query(
    `SELECT id, name FROM users WHERE email = $1`,
    ['maria@pacheco.local'],
  );
  if (!maria.rows.length) {
    logger.warn('Usuária maria não encontrada — seed financeiro pulado');
    return;
  }
  const mariaId = String((maria.rows[0] as Record<string, unknown>).id);

  const joao = await query(
    `SELECT id FROM users WHERE email = $1`,
    ['joao@pacheco.local'],
  );
  const joaoId = joao.rows.length
    ? String((joao.rows[0] as Record<string, unknown>).id)
    : null;

  // empresa
  const company = await query(
    `INSERT INTO companies
       (name, trade_name, document, business, email, phone, website,
        tax_regime, average_billing, founded_at, address, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      'Comercial Pacheco Ltda',
      'Comercial Pacheco',
      companyDocument,
      'Comércio varejista de alimentos',
      'financeiro@comercialpacheco.com.br',
      '(31) 3344-5566',
      'https://comercialpacheco.com.br',
      'Simples Nacional',
      8_500_000, // R$ 85.000,00/mês
      '2019-03-15',
      JSON.stringify({
        street: 'Av. Amazonas',
        number: '1200',
        neighbourhood: 'Centro',
        city: 'Belo Horizonte',
        state: 'MG',
        zip_code: '30180-000',
      }),
      mariaId,
    ],
  );
  const companyId = String((company.rows[0] as Record<string, unknown>).id);

  await query(
    `INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [companyId, mariaId],
  );
  if (joaoId) {
    await query(
      `INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'member')`,
      [companyId, joaoId],
    );
  }
  logger.info('🏢 Empresa "Comercial Pacheco Ltda" criada (maria = owner)');

  // plano de contas — [código, nome, tipo, código do pai]
  const coaTree: Array<[string, string, string, string | null]> = [
    // 3 = Receitas
    ['3.1', 'Receitas de Vendas', 'receita', null],
    ['3.1.01', 'Venda de produtos', 'receita', '3.1'],
    ['3.1.02', 'Prestação de serviços', 'receita', '3.1'],
    ['3.1.03', 'Venda de ativos', 'receita', '3.1'],
    ['3.2', 'Receitas Financeiras', 'receita', null],
    ['3.2.01', 'Juros recebidos', 'receita', '3.2'],
    ['3.2.02', 'Rendimento de aplicações', 'receita', '3.2'],
    ['3.3', 'Outras Receitas', 'receita', null],
    ['3.3.01', 'Outras receitas', 'receita', '3.3'],
    // 4 = Despesas
    ['4.1', 'Despesas com Pessoal', 'despesa', null],
    ['4.1.01', 'Salários e ordenados', 'despesa', '4.1'],
    ['4.1.02', 'Encargos sociais (INSS, FGTS)', 'despesa', '4.1'],
    ['4.1.03', 'Benefícios e vale-transporte', 'despesa', '4.1'],
    ['4.2', 'Despesas Operacionais', 'despesa', null],
    ['4.2.01', 'Aluguel', 'despesa', '4.2'],
    ['4.2.02', 'Energia elétrica', 'despesa', '4.2'],
    ['4.2.03', 'Água e esgoto', 'despesa', '4.2'],
    ['4.2.04', 'Internet e telefone', 'despesa', '4.2'],
    ['4.2.05', 'Material de escritório', 'despesa', '4.2'],
    ['4.2.06', 'Transporte e frete', 'despesa', '4.2'],
    ['4.3', 'Despesas Administrativas', 'despesa', null],
    ['4.3.01', 'Contador', 'despesa', '4.3'],
    ['4.3.02', 'Software e assinaturas', 'despesa', '4.3'],
    ['4.3.03', 'Marketing e publicidade', 'despesa', '4.3'],
    ['4.4', 'Despesas Financeiras', 'despesa', null],
    ['4.4.01', 'Tarifas bancárias', 'despesa', '4.4'],
    ['4.4.02', 'Juros e multas', 'despesa', '4.4'],
  ];
  const coaIds = new Map<string, number>();
  for (const [code, label, type, parentCode] of coaTree) {
    const parentId = parentCode ? coaIds.get(parentCode) ?? null : null;
    const inserted = await query(
      `INSERT INTO chart_of_accounts
         (company_id, code, label, type, parent_id, is_title)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [companyId, code, label, type, parentId, parentId ? 1 : 0],
    );
    coaIds.set(code, Number((inserted.rows[0] as Record<string, unknown>).id));
  }
  logger.info(`🧾 Plano de contas: ${coaTree.length} contas criadas`);

  // contas bancárias
  const bankOf = async (code: string) => {
    const r = await query(`SELECT id FROM banks WHERE code = $1`, [code]);
    return String((r.rows[0] as Record<string, unknown>).id);
  };
  const bbBankId = await bankOf('001');
  const nuBankId = await bankOf('260');

  const bbAccount = await query(
    `INSERT INTO bank_accounts
       (company_id, bank_id, alias, agency, account_number, type,
        opening_balance, created_by)
     VALUES ($1, $2, $3, $4, $5, 'corrente', $6, $7)
     RETURNING id`,
    [
      companyId,
      bbBankId,
      'Conta Principal BB',
      '1234-5',
      '98765-4',
      2_500_000, // R$ 25.000,00
      mariaId,
    ],
  );
  const nuAccount = await query(
    `INSERT INTO bank_accounts
       (company_id, bank_id, alias, agency, account_number, type,
        opening_balance, created_by)
     VALUES ($1, $2, $3, $4, $5, 'corrente', $6, $7)
     RETURNING id`,
    [
      companyId,
      nuBankId,
      'Nubank PJ',
      '0001',
      '12345678-9',
      800_000, // R$ 8.000,00
      mariaId,
    ],
  );
  const accountIds = {
    bb: String((bbAccount.rows[0] as Record<string, unknown>).id),
    nu: String((nuAccount.rows[0] as Record<string, unknown>).id),
  };
  logger.info('🏦 2 contas bancárias criadas (BB e Nubank PJ)');

  // fornecedores
  const suppliersSeed: Array<[string, string]> = [
    ['Cemig Distribuição', '03.557.161/0001-79'],
    ['Gama Alimentos Atacado', '34.567.890/0001-03'],
    ['Beta Transportes e Logística', '23.456.789/0001-02'],
    ['Delta Contabilidade', '45.678.901/0001-04'],
    ['Alfa Material de Escritório', '12.345.678/0001-01'],
    ['Ômega Tech Software', '56.789.012/0001-05'],
  ];
  const supplierIds = new Map<string, string>();
  for (const [name, document] of suppliersSeed) {
    const inserted = await query(
      `INSERT INTO suppliers (company_id, name, document, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [companyId, name, document, mariaId],
    );
    supplierIds.set(name, String((inserted.rows[0] as Record<string, unknown>).id));
  }

  // centros de custo
  const costCentersSeed = ['Administrativo', 'Comercial', 'Operações', 'Logística'];
  const costCenterIds = new Map<string, string>();
  for (const name of costCentersSeed) {
    const inserted = await query(
      `INSERT INTO cost_centers (company_id, name, created_by)
       VALUES ($1, $2, $3) RETURNING id`,
      [companyId, name, mariaId],
    );
    costCenterIds.set(name, String((inserted.rows[0] as Record<string, unknown>).id));
  }
  logger.info(
    `🏷️ ${suppliersSeed.length} fornecedores e ${costCentersSeed.length} centros de custo criados`,
  );

  // movimentações — cobrem todos os status
  const txs: SeedTx[] = [
    {
      // PAGO — despesa quitada integralmente
      type: 'despesa',
      amountCents: 650_000,
      reference: 'Aluguel do galpão — Centro de Distribuição',
      moreInfos: 'Contrato de locação comercial, parcela mensal.',
      competenceMonthsFromNow: 0,
      dueOffset: -8,
      coaCode: '4.2.01',
      account: 'bb',
      costCenterName: 'Operações',
      payments: [
        {
          amountCents: 650_000,
          dateOffset: -8,
          method: 'transferencia',
          account: 'bb',
        },
      ],
    },
    {
      // VENCIDO — conta de energia em atraso (sem pagamentos)
      type: 'despesa',
      amountCents: 185_000,
      reference: 'Energia elétrica — Cemig',
      competenceMonthsFromNow: -1,
      dueOffset: -10,
      coaCode: '4.2.02',
      account: 'bb',
      supplierName: 'Cemig Distribuição',
      costCenterName: 'Operações',
    },
    {
      // VENCE HOJE — internet
      type: 'despesa',
      amountCents: 42_000,
      reference: 'Internet e telefone — fibra 500MB',
      competenceMonthsFromNow: 0,
      dueOffset: 0,
      coaCode: '4.2.04',
      account: 'nu',
      costCenterName: 'Administrativo',
    },
    {
      // PAGO PARCIAL — equipamentos (entrada paga, restante a vencer)
      type: 'despesa',
      amountCents: 900_000,
      reference: 'Equipamentos de refrigeração — Gelopar',
      moreInfos: 'Compra de 2 câmaras frias; entrada + 2 parcelas.',
      competenceMonthsFromNow: 0,
      dueOffset: 20,
      coaCode: '4.2.05',
      account: 'bb',
      supplierName: 'Gama Alimentos Atacado',
      costCenterName: 'Operações',
      payments: [
        {
          amountCents: 350_000,
          dateOffset: -2,
          method: 'boleto',
          account: 'nu',
        },
      ],
    },
    {
      // PAGO E ESTORNADO (livro-caixa) — volta a ficar em atraso
      type: 'despesa',
      amountCents: 120_000,
      reference: 'Frete de mercadorias — lote #247',
      competenceMonthsFromNow: 0,
      dueOffset: -6,
      coaCode: '4.2.06',
      account: 'bb',
      supplierName: 'Beta Transportes e Logística',
      costCenterName: 'Logística',
      payments: [
        {
          amountCents: 120_000,
          dateOffset: -6,
          method: 'dinheiro_ou_pix',
          account: 'bb',
          reversed: {
            dateOffset: -5,
            reason: 'Boleto pago em duplicidade — estorno solicitado ao fornecedor.',
          },
        },
      ],
    },
    {
      // A VENCER — folha de pagamento
      type: 'despesa',
      amountCents: 2_800_000,
      reference: 'Folha de pagamento — salários',
      moreInfos: '7 colaboradores (CLT).',
      competenceMonthsFromNow: 0,
      dueOffset: 5,
      coaCode: '4.1.01',
      account: 'bb',
      costCenterName: 'Administrativo',
    },
    {
      // A VENCER — contador
      type: 'despesa',
      amountCents: 95_000,
      reference: 'Honorários contábeis — Delta Contabilidade',
      competenceMonthsFromNow: 0,
      dueOffset: 15,
      coaCode: '4.3.01',
      account: 'bb',
      supplierName: 'Delta Contabilidade',
      costCenterName: 'Administrativo',
    },
    {
      // A VENCER — marketing
      type: 'despesa',
      amountCents: 240_000,
      reference: 'Campanha de final de ano — Google Ads',
      competenceMonthsFromNow: 0,
      dueOffset: 25,
      coaCode: '4.3.03',
      account: 'nu',
      costCenterName: 'Comercial',
    },
    {
      // A VENCER — venda grande
      type: 'receita',
      amountCents: 1_250_000,
      reference: 'Venda de produtos — Supermercado Bom Preço',
      moreInfos: 'Pedido #1032, 30 dias de prazo.',
      contact: 'Supermercado Bom Preço',
      competenceMonthsFromNow: 0,
      dueOffset: 12,
      coaCode: '3.1.01',
      account: 'bb',
      costCenterName: 'Comercial',
    },
    {
      // A VENCER — prestação de serviços
      type: 'receita',
      amountCents: 480_000,
      reference: 'Prestação de serviços — consultoria de estoque',
      contact: 'Restaurante Sabor Mineiro',
      competenceMonthsFromNow: 0,
      dueOffset: 18,
      coaCode: '3.1.02',
      account: 'bb',
    },
    {
      // VENCIDO — receita a receber em atraso
      type: 'receita',
      amountCents: 230_000,
      reference: 'Venda de produtos — Cliente Ômega (fatura #98)',
      contact: 'Ômega Tech Software',
      competenceMonthsFromNow: 0,
      dueOffset: -3,
      coaCode: '3.1.01',
      account: 'bb',
      costCenterName: 'Comercial',
    },
    {
      // PAGO — receita pequena já recebida
      type: 'receita',
      amountCents: 18_000,
      reference: 'Juros recebidos — atraso fatura #77',
      competenceMonthsFromNow: 0,
      dueOffset: -1,
      coaCode: '3.2.01',
      account: 'nu',
      payments: [
        {
          amountCents: 18_000,
          dateOffset: -1,
          method: 'dinheiro_ou_pix',
          account: 'nu',
        },
      ],
    },
    {
      // A VENCER — rendimento
      type: 'receita',
      amountCents: 32_000,
      reference: 'Rendimento de aplicações — CDB',
      competenceMonthsFromNow: 0,
      dueOffset: 8,
      coaCode: '3.2.02',
      account: 'nu',
    },
  ];

  for (const tx of txs) {
    const coaId = coaIds.get(tx.coaCode)!;
    const inserted = await query(
      `INSERT INTO financial_transactions
         (company_id, type, amount, reference, more_infos, contact,
          competence, due_date, origin, coa_id, bank_account_id,
          cost_center_id, supplier_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'bank_account',
               $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        companyId,
        tx.type,
        tx.amountCents,
        tx.reference,
        tx.moreInfos ?? null,
        tx.contact ?? null,
        month(tx.competenceMonthsFromNow),
        isoDate(tx.dueOffset),
        coaId,
        accountIds[tx.account],
        tx.costCenterName ? costCenterIds.get(tx.costCenterName) ?? null : null,
        tx.supplierName ? supplierIds.get(tx.supplierName) ?? null : null,
        mariaId,
      ],
    );
    const txId = String((inserted.rows[0] as Record<string, unknown>).id);

    for (const payment of tx.payments ?? []) {
      const paymentRow = await query(
        `INSERT INTO transaction_payments
           (transaction_id, company_id, amount, kind, payment_date,
            payment_method, bank_account_id, created_by)
         VALUES ($1, $2, $3, 'payment', $4, $5, $6, $7)
         RETURNING id`,
        [
          txId,
          companyId,
          payment.amountCents,
          isoDate(payment.dateOffset),
          payment.method,
          accountIds[payment.account],
          mariaId,
        ],
      );

      if (payment.reversed) {
        const paymentId = String(
          (paymentRow.rows[0] as Record<string, unknown>).id,
        );
        await query(
          `INSERT INTO transaction_payments
             (transaction_id, company_id, amount, kind, reverses_payment_id,
              payment_date, payment_method, bank_account_id, reason, created_by)
           VALUES ($1, $2, $3, 'reversal', $4, $5, $6, $7, $8, $9)`,
          [
            txId,
            companyId,
            -payment.amountCents,
            paymentId,
            isoDate(payment.reversed.dateOffset),
            payment.method,
            accountIds[payment.account],
            payment.reversed.reason,
            mariaId,
          ],
        );
      }
    }
  }
  logger.info(
    `📜 ${txs.length} movimentações criadas (pago, pago parcial, vence hoje, a vencer, vencido e 1 estorno)`,
  );
  logger.info(`   Saldos derivados: BB ${brl(1_850_000)} · Nubank ${brl(468_000)}`);
}

/* ── Execução ────────────────────────────────────────────── */

async function seed() {
  await connectDatabase();

  const created = await seedUsers();
  logger.info(
    created > 0
      ? `🌱 Usuários: ${created} criado(s).`
      : '🌱 Usuários: nada a fazer (dados já existem).',
  );

  await seedFinance();
  logger.info('🌱 Seed concluído.');
}

seed().catch((error) => {
  logger.error('Falha no seed:', error);
  Deno.exit(1);
});
