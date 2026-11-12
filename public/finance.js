/* ═══════════════════════════════════════════════════════════
 * PACHECO SOLUTIONS — Módulo financeiro (escopo EXTAT, fase 1)
 *
 * Script clássico: compartilha os globais do app.js
 * (state, api, $, $$, money, esc, toast, fmtDate, VIEW_MAP,
 *  registerView, busy, logout…). Carregado DEPOIS do app.js e
 *  ANTES do boot (que roda no DOMContentLoaded).
 *
 * Módulo:
 *   · contexto de empresa (seletor no menu lateral)
 *   · Movimentações / Contas a pagar / Contas a receber
 *   · drawer: criar/editar/detalhe de movimentação + pagamento
 *     + estorno (livro-caixa)
 *   · Empresa: informações, plano de contas, contas bancárias,
 *     centros de custo, fornecedores
 * ═══════════════════════════════════════════════════════════ */
'use strict';

/* ── Constantes espelhando o backend ─────────────────────── */

const FIN_STATUS = {
  pago: 'Pago',
  pago_parcial: 'Pago parcial',
  vence_hoje: 'Vence hoje',
  a_vencer: 'A vencer',
  vencido: 'Vencido',
};
const FIN_METHODS = {
  dinheiro_ou_pix: 'Dinheiro ou Pix',
  debito: 'Cartão de débito',
  credito: 'Cartão de crédito',
  transferencia: 'Transferência',
  boleto: 'Boleto',
  outros: 'Outros',
};
const PENDING_STATUSES = ['a_vencer', 'vencido', 'vence_hoje', 'pago_parcial'];
const ACCOUNT_TYPES = {
  corrente: 'Conta corrente',
  poupanca: 'Poupança',
  investimento: 'Investimento',
};
const COA_TYPE_LABELS = {
  receita: 'Receita',
  despesa: 'Despesa',
  ativo: 'Ativo',
  passivo: 'Passivo',
  patrimonio_liquido: 'Patrimônio líquido',
};
const ROLE_LABELS = {
  owner: 'Proprietário',
  admin: 'Administrador',
  member: 'Membro',
  viewer: 'Leitor',
};
const TAX_REGIMES = ['Simples Nacional', 'Lucro Presumido', 'Lucro Real', 'MEI'];

/* ── Helpers locais ──────────────────────────────────────── */

/** 'AAAA-MM-DD' → 'DD/MM/AAAA' */
function fmtDay(s) {
  if (!s) return '—';
  const [y, m, d] = String(s).split('-');
  if (!y || !m || !d) return String(s);
  return `${d}/${m}/${y}`;
}

function todayISO() { return new Date().toISOString().slice(0, 10); }
function currentMonth() { return new Date().toISOString().slice(0, 7); }

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function statusChip(status) {
  return `<span class="status-chip ${status}">${FIN_STATUS[status] || status}</span>`;
}

function typeBadge(type) {
  return `<span class="badge ${type === 'receita' ? 'in' : 'out'}">${type === 'receita' ? 'Receita' : 'Despesa'}</span>`;
}

function parseAddress(raw) {
  try { return typeof raw === 'string' ? (JSON.parse(raw) || {}) : (raw || {}); }
  catch { return {}; }
}

/* ── Contexto de empresa ────────────────────────────────── */

let finCompanies = [];
let finOptions = null; // opções dos selects (categorias, contas…)
let finCtxToken = null;
let finCtxPromise = null;
let currentDetail = null; // detalhe aberto no drawer {id, prefix}

/** api() com o header x-company-id da empresa ativa. */
function fapi(path, opts = {}) {
  return api(path, { ...opts, company: true });
}

async function initCompanyContext() {
  const box = $('#company-box');
  const select = $('#company-select');
  box.hidden = true;
  try {
    const data = await api('/companies');
    finCompanies = data.companies || [];
  } catch {
    finCompanies = [];
  }
  if (!state.token) return;
  box.hidden = finCompanies.length === 0;
  select.innerHTML = finCompanies.map((c) =>
    `<option value="${esc(c.id)}">${esc(c.trade_name || c.name)}</option>`).join('');
  const current = finCompanies.find((c) => c.id === state.companyId);
  if (current) {
    select.value = current.id;
  } else if (finCompanies.length) {
    setCompany(finCompanies[0].id, { silent: true });
    select.value = finCompanies[0].id;
  }
}

/** Garante o contexto (idempotente por token — reseta em logout/login). */
function ensureCompanyContext() {
  if (finCtxToken !== state.token) {
    finCtxToken = state.token;
    finCtxPromise = initCompanyContext();
  }
  return finCtxPromise;
}

function setCompany(id, { silent = false } = {}) {
  state.companyId = id || null;
  if (id) localStorage.setItem(COMPANY_KEY, id);
  else localStorage.removeItem(COMPANY_KEY);
  finOptions = null; // as opções são por empresa
  if (!silent) route();
}

function bindCompanySelect() {
  $('#company-select').addEventListener('change', (e) => {
    setCompany(e.target.value);
    toast('Empresa ativa alterada.');
  });
}

/* ── Opções dos selects ─────────────────────────────────── */

async function loadFinOptions(force = false) {
  if (finOptions && !force) return finOptions;
  const [catsR, catsD, accounts, costCenters, suppliers] = await Promise.all([
    fapi('/companies/coa/list/receita'),
    fapi('/companies/coa/list/despesa'),
    fapi('/bank-accounts'),
    fapi('/cost-centers'),
    fapi('/suppliers'),
  ]);
  finOptions = {
    categories: {
      receita: (catsR.accounts || []).filter((a) => !a.is_title),
      despesa: (catsD.accounts || []).filter((a) => !a.is_title),
    },
    accounts: (accounts.bank_accounts || []),
    costCenters: (costCenters.cost_centers || []),
    suppliers: (suppliers.suppliers || []),
  };
  return finOptions;
}

function coaOptions(list, selectedId) {
  if (!list?.length) return '<option value="">(sem categorias deste tipo)</option>';
  return list.map((a) =>
    `<option value="${a.id}" ${Number(a.id) === Number(selectedId) ? 'selected' : ''}>${esc(a.code)} · ${esc(a.label)}</option>`).join('');
}

function methodOptions(selected) {
  return Object.entries(FIN_METHODS).map(([v, l]) =>
    `<option value="${v}" ${v === selected ? 'selected' : ''}>${l}</option>`).join('');
}

/* ── Estados vazios / erro ───────────────────────────────── */

function renderNoCompany(root, { showCreate = false } = {}) {
  root.innerHTML = `
    <div class="card empty-state">
      <h2>🏢 Nenhuma empresa ativa</h2>
      <p class="muted">O módulo financeiro organiza as movimentações por empresa.<br>
      Crie a primeira empresa para começar a usar contas a pagar e receber.</p>
      <div class="form-actions" style="justify-content:center">
        <button type="button" class="btn primary" id="no-company-create">＋ Criar empresa</button>
      </div>
    </div>`;
  $('#no-company-create').addEventListener('click', openCompanyCreateModal);
}

function renderError(root, message) {
  root.innerHTML = `
    <div class="card empty-state">
      <h2>⚠️ Não foi possível carregar</h2>
      <p class="form-error" style="text-align:left">${esc(message)}</p>
      <button type="button" class="btn ghost" onclick="location.reload()">Tentar novamente</button>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
 * Listas de movimentações (fábrica para as 3 views)
 * ═══════════════════════════════════════════════════════════ */

const finViews = {};

function setupFinanceList(prefix, opts = {}) {
  const root = $(`#${prefix}-root`);
  const fixedType = opts.fixedType || null;
  const defaultStatus = opts.defaultStatus || '';

  const view = {
    page: 1,
    total: 0,
    totalPages: 1,
    mounted: false,

    /* Monta markup + listeners na raiz (pode ser chamado de novo se a raiz
       tiver sido substituída por um empty-state de "sem empresa"). */
    mount() {
      root.innerHTML = `
    <div class="card filter-card">
      <div class="filter-bar">
        <input type="search" id="${prefix}-search" class="f-search"
               placeholder="🔍 Buscar por descrição ou contato…" />
        <select id="${prefix}-status" class="f-select" title="Status">
          <option value="">Todos os status</option>
          <option value="pendente">Pendentes</option>
          <option value="pago">Pagas</option>
          <option value="vencido">Vencidas</option>
          <option value="vence_hoje">Vencem hoje</option>
          <option value="a_vencer">A vencer</option>
          <option value="pago_parcial">Pagas parcialmente</option>
        </select>
        ${fixedType ? '' : `
        <select id="${prefix}-type" class="f-select" title="Tipo">
          <option value="">Receitas e despesas</option>
          <option value="despesa">Só despesas</option>
          <option value="receita">Só receitas</option>
        </select>`}
        <select id="${prefix}-date-type" class="f-select" title="Aplicar período a">
          <option value="due_date">Vencimento</option>
          <option value="competence">Competência</option>
          <option value="payment_date">Data do pagamento</option>
        </select>
        <input type="date" id="${prefix}-start" class="f-date" title="Início do período" />
        <input type="date" id="${prefix}-end" class="f-date" title="Fim do período" />
        <select id="${prefix}-category" class="f-select" title="Categoria">
          <option value="">Categoria: todas</option>
        </select>
        <select id="${prefix}-account" class="f-select" title="Conta bancária">
          <option value="">Conta: todas</option>
        </select>
        <select id="${prefix}-cost-center" class="f-select" title="Centro de custo">
          <option value="">Centro: todos</option>
        </select>
        <select id="${prefix}-supplier" class="f-select" title="Fornecedor">
          <option value="">Fornecedor: todos</option>
        </select>
        <button type="button" class="btn ghost" id="${prefix}-clear">Limpar</button>
      </div>
    </div>
    <div class="card table-card">
      <div class="table-scroll">
        <table class="table fin-table" id="${prefix}-table">
          <thead><tr>
            <th>Status</th>
            <th>Descrição</th>
            <th>Categoria</th>
            <th>Conta</th>
            <th>Vencimento</th>
            <th>Competência</th>
            <th class="right">Valor</th>
            <th class="right">Pago</th>
            <th class="right">Restante</th>
            <th class="right">Ações</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <p class="empty" id="${prefix}-empty" hidden></p>
      <div class="pagination" id="${prefix}-pagination"></div>
    </div>`;

      if (defaultStatus) $(`#${prefix}-status`).value = defaultStatus;

      /* ── Listeners dos filtros (recriados a cada montagem) ── */
      const refetch = debounce(() => { view.page = 1; view.fetch(); }, 350);
      $(`#${prefix}-search`).addEventListener('input', refetch);
      ['status', 'type', 'date-type', 'category', 'account', 'cost-center', 'supplier', 'start', 'end']
        .forEach((sfx) => {
          const el = $(`#${prefix}-${sfx}`);
          if (el) el.addEventListener('change', refetch);
        });
      $(`#${prefix}-clear`).addEventListener('click', () => {
        $(`#${prefix}-search`).value = '';
        $$(`#${prefix}-root select`).forEach((s) => {
          s.value = s.querySelector('option')?.value ?? '';
        });
        $$(`#${prefix}-root input[type=date]`).forEach((i) => (i.value = ''));
        view.page = 1;
        view.fetch();
      });
      $(`#${prefix}-table`).addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const id = btn.dataset.id;
        if (btn.dataset.action === 'view') openTxDetail(id, prefix);
        if (btn.dataset.action === 'edit') openTxForm({ id, prefix });
        if (btn.dataset.action === 'delete') confirmDeleteTx(id, prefix);
      });
      view.mounted = true;
    },

    async load() {
      await ensureCompanyContext();
      if (!state.companyId) { renderNoCompany(root, { showCreate: true }); return; }
      if (!view.mounted || !root.querySelector('table')) view.mount();
      try {
        await loadFinOptions();
        fillFilterSelects(prefix, fixedType);
      } catch (err) {
        renderError(root, err.message);
        return;
      }
      await view.fetch();
    },

    async fetch() {
      if (!state.companyId) return;
      const params = new URLSearchParams();
      params.set('page', String(view.page));
      params.set('limit', '50');

      const status = $(`#${prefix}-status`).value;
      if (status === 'pendente') params.set('status', PENDING_STATUSES.join(','));
      else if (status) params.set('status', status);

      const type = fixedType || $(`#${prefix}-type`)?.value || '';
      if (type) params.set('type', type);
      params.set('date_type', $(`#${prefix}-date-type`).value || 'due_date');
      const start = $(`#${prefix}-start`).value;
      const end = $(`#${prefix}-end`).value;
      if (start) params.set('start_date', start);
      if (end) params.set('end_date', end);
      const map = { category: 'categories', account: 'bank_accounts', 'cost-center': 'cost_centers', supplier: 'suppliers' };
      for (const [sfx, qp] of Object.entries(map)) {
        const v = $(`#${prefix}-${sfx}`).value;
        if (v) params.set(qp, v);
      }
      const search = $(`#${prefix}-search`).value.trim();
      if (search) params.set('search', search);

      const tbody = $(`#${prefix}-table tbody`);
      tbody.innerHTML = '<tr><td colspan="10" class="muted load-cell">Carregando…</td></tr>';
      try {
        const data = await fapi(`/companies/transactions?${params}`);
        view.total = data.total;
        view.totalPages = data.total_pages || 1;
        view.render(data.transactions || []);
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="10" class="load-cell form-error">${esc(err.message)}</td></tr>`;
      }
    },

    render(list) {
      const tbody = $(`#${prefix}-table tbody`);
      const empty = $(`#${prefix}-empty`);
      if (!list.length) {
        tbody.innerHTML = '';
        empty.hidden = false;
        empty.innerHTML = 'Nenhuma movimentação encontrada<br><span class="muted-inline">ajuste os filtros ou crie uma nova</span>';
      } else {
        empty.hidden = true;
        tbody.innerHTML = list.map((t) => finTxRow(t)).join('');
      }
      renderPagination(prefix, view);
    },
  };

  return view;
}

/** Preenche os selects de filtro (uma vez; preserva a seleção). */
function fillFilterSelects(prefix, fixedType) {
  const o = finOptions;
  const catSel = $(`#${prefix}-category`);
  if (catSel && catSel.options.length <= 1) {
    const cats = fixedType
      ? o.categories[fixedType]
      : [...o.categories.receita, ...o.categories.despesa]
        .sort((a, b) => String(a.code).localeCompare(String(b.code)));
    catSel.innerHTML = '<option value="">Categoria: todas</option>' +
      cats.map((a) => `<option value="${a.id}">${esc(a.code)} · ${esc(a.label)}</option>`).join('');
  }
  const accSel = $(`#${prefix}-account`);
  if (accSel && accSel.options.length <= 1) {
    accSel.innerHTML = '<option value="">Conta: todas</option>' +
      o.accounts.map((a) =>
        `<option value="${a.id}">${esc(a.alias)}${Number(a.active) === 1 ? '' : ' (inativa)'}</option>`).join('');
  }
  const ccSel = $(`#${prefix}-cost-center`);
  if (ccSel && ccSel.options.length <= 1) {
    ccSel.innerHTML = '<option value="">Centro: todos</option>' +
      o.costCenters.map((c) =>
        `<option value="${c.id}">${esc(c.name)}${Number(c.active) === 1 ? '' : ' (inativo)'}</option>`).join('');
  }
  const supSel = $(`#${prefix}-supplier`);
  if (supSel && supSel.options.length <= 1) {
    supSel.innerHTML = '<option value="">Fornecedor: todos</option>' +
      o.suppliers.map((s) =>
        `<option value="${s.id}">${esc(s.name)}${Number(s.active) === 1 ? '' : ' (inativo)'}</option>`).join('');
  }
}

function finTxRow(t) {
  return `<tr>
    <td>${statusChip(t.status)}</td>
    <td class="tx-desc">
      <strong>${esc(t.reference)}</strong>
      ${t.contact ? `<small class="muted">👤 ${esc(t.contact)}</small>` : ''}
      ${t.cost_center ? `<small class="muted">🎯 ${esc(t.cost_center.name)}</small>` : ''}
    </td>
    <td class="muted">${t.category ? esc(t.category.code) : '—'}</td>
    <td class="muted">${t.bank_account ? esc(t.bank_account.alias) : '—'}</td>
    <td class="nowrap ${t.status === 'vencido' ? 'overdue' : ''}">${fmtDay(t.due_date)}</td>
    <td class="nowrap muted">${t.competence || '—'}</td>
    <td class="right nowrap ${t.type === 'receita' ? 'in' : 'out'}">${t.type === 'receita' ? '+' : '−'} ${money(t.amount)}</td>
    <td class="right nowrap">${money(t.paid_amount)}</td>
    <td class="right nowrap ${Number(t.remaining_amount) > 0 ? 'pending' : 'paid-ok'}">${money(t.remaining_amount)}</td>
    <td class="right nowrap">
      <button class="icon-btn" data-action="view" data-id="${t.id}" title="Ver detalhes">👁</button>
      <button class="icon-btn" data-action="edit" data-id="${t.id}" title="Editar">✏️</button>
      <button class="icon-btn danger" data-action="delete" data-id="${t.id}" title="Excluir">🗑</button>
    </td>
  </tr>`;
}

function renderPagination(prefix, view) {
  const el = $(`#${prefix}-pagination`);
  if (view.totalPages <= 1) {
    el.innerHTML = `<span class="muted">${view.total} ${view.total === 1 ? 'movimentação' : 'movimentações'}</span>`;
    return;
  }
  el.innerHTML = `
    <button class="btn ghost" data-page="${view.page - 1}" ${view.page <= 1 ? 'disabled' : ''}>← Anterior</button>
    <span class="muted">Página ${view.page} de ${view.totalPages} · ${view.total} movimentações</span>
    <button class="btn ghost" data-page="${view.page + 1}" ${view.page >= view.totalPages ? 'disabled' : ''}>Próxima →</button>`;
  el.querySelectorAll('button[data-page]').forEach((b) =>
    b.addEventListener('click', () => {
      view.page = Number(b.dataset.page);
      view.fetch();
    }));
}

/** Resumos de Contas a pagar / receber. */
async function loadFinStatsSafe(prefix, type) {
  await ensureCompanyContext();
  const box = $(`#${prefix}-stats`);
  if (!state.companyId) { box.innerHTML = ''; return; }
  try {
    const data = await fapi(
      `/companies/transactions?type=${type}&status=${PENDING_STATUSES.join(',')}&limit=200`,
    );
    const list = data.transactions || [];
    const stat = (st) => {
      const items = st ? list.filter((t) => t.status === st) : list;
      return {
        value: items.reduce((s, t) => s + Number(t.remaining_amount), 0),
        count: items.length,
      };
    };
    const label = type === 'despesa' ? 'a pagar' : 'a receber';
    const cards = [
      { label: `⏳ Total ${label}`, ...stat(null), cls: type === 'despesa' ? 'out' : 'in' },
      { label: '🔴 Vencido', ...stat('vencido'), cls: 'out' },
      { label: '🟠 Vence hoje', ...stat('vence_hoje'), cls: 'warn' },
      { label: '🟢 A vencer', ...stat('a_vencer'), cls: 'in' },
      { label: '🔵 Pago parcial', ...stat('pago_parcial'), cls: 'partial' },
    ];
    box.innerHTML = cards.map((c) => `
      <div class="card stat">
        <span class="stat-label">${c.label}</span>
        <span class="stat-value ${c.cls}">${money(c.value)}</span>
        <span class="stat-sub">${c.count} ${c.count === 1 ? 'item' : 'itens'}</span>
      </div>`).join('');
  } catch {
    box.innerHTML = '';
  }
}

/** Recarrega a view de lista + estatísticas daquele prefixo. */
function refreshFinanceView(prefix) {
  const view = finViews[prefix];
  if (view) view.fetch();
  if (prefix === 'pay') loadFinStatsSafe('pay', 'despesa');
  if (prefix === 'rec') loadFinStatsSafe('rec', 'receita');
}

async function loadFinTransactions() { finViews.fin.load(); }
async function loadFinPayables() {
  finViews.pay.load();
  loadFinStatsSafe('pay', 'despesa');
}
async function loadFinReceivables() {
  finViews.rec.load();
  loadFinStatsSafe('rec', 'receita');
}

/* ═══════════════════════════════════════════════════════════
 * Drawer + Modal (infraestrutura)
 * ═══════════════════════════════════════════════════════════ */

function openDrawer(title, bodyHTML) {
  $('#drawer-title').textContent = title;
  $('#drawer-body').innerHTML = bodyHTML;
  $('#drawer').hidden = false;
  $('#drawer-backdrop').hidden = false;
  $('#drawer-body').scrollTop = 0;
}

function closeDrawer() {
  $('#drawer').hidden = true;
  $('#drawer-backdrop').hidden = true;
  currentDetail = null;
}

let modalDismiss = null;

function openModal(title, bodyHTML, footerHTML = '') {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHTML;
  $('#modal-footer').innerHTML = footerHTML;
  $('#modal').hidden = false;
  $('#modal-backdrop').hidden = false;
}

function closeModal() {
  $('#modal').hidden = true;
  $('#modal-backdrop').hidden = true;
  if (modalDismiss) {
    const d = modalDismiss;
    modalDismiss = null;
    d();
  }
}

/**
 * Confirmação (com input opcional). Resolve:
 *   true  → confirmado (sem input)
 *   string → valor do input
 *   null  → cancelado (botão, fundo ou ESC)
 */
function confirmModal({
  title,
  message = '',
  confirmLabel = 'Confirmar',
  danger = false,
  inputLabel = null,
  inputPlaceholder = '',
  inputType = 'text',
  inputValue = '',
}) {
  return new Promise((resolve) => {
    openModal(
      title,
      `
      ${message ? `<p class="modal-message">${message}</p>` : ''}
      ${inputLabel ? `
        <label class="modal-label">${inputLabel}
          <input type="${inputType}" id="modal-input" placeholder="${esc(inputPlaceholder)}" value="${esc(inputValue)}">
        </label>` : ''}`,
      `
      <button type="button" class="btn ghost" id="modal-cancel">Cancelar</button>
      <button type="button" class="btn ${danger ? 'danger' : 'primary'}" id="modal-confirm">${confirmLabel}</button>`,
    );
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      modalDismiss = null;
      closeModal();
      resolve(v);
    };
    modalDismiss = () => finish(null);
    $('#modal-cancel').onclick = () => finish(null);
    $('#modal-confirm').onclick = () =>
      finish(inputLabel ? $('#modal-input').value : true);
    if (inputLabel) $('#modal-input').focus();
  });
}

/* ═══════════════════════════════════════════════════════════
 * Drawer: criar / editar movimentação
 * ═══════════════════════════════════════════════════════════ */

async function openTxForm({ id = null, prefix = 'fin', type = null } = {}) {
  await ensureCompanyContext();
  if (!state.companyId) {
    toast('Selecione ou crie uma empresa primeiro.', 'error');
    return;
  }
  let options;
  try {
    options = await loadFinOptions();
  } catch (err) {
    toast(err.message, 'error');
    return;
  }

  let tx = null;
  if (id) {
    try {
      tx = (await fapi(`/companies/transactions/${id}`)).transaction;
    } catch (err) {
      toast(err.message, 'error');
      return;
    }
  }
  const initialType = tx?.type || type || 'despesa';
  const activeAccounts = options.accounts.filter((a) =>
    Number(a.active) === 1 || a.id === tx?.bank_account?.id);

  openDrawer(tx ? 'Editar movimentação' : 'Criar movimentação', `
    <form id="tx-form" class="drawer-form">
      <div class="seg" id="tx-type-seg">
        <button type="button" data-type="receita" class="${initialType === 'receita' ? 'active' : ''}">↗ Receita</button>
        <button type="button" data-type="despesa" class="${initialType === 'despesa' ? 'active' : ''}">↙ Despesa</button>
      </div>
      <input type="hidden" id="tx-type" value="${initialType}">

      <label>Descrição *
        <input type="text" id="tx-reference" required maxlength="200"
               value="${esc(tx?.reference ?? '')}" placeholder="ex.: Aluguel do galpão — novembro">
      </label>

      <div class="form-grid">
        <label>Valor *
          <div class="amount-field"><span class="currency">R$</span>
            <input type="number" id="tx-amount" required min="0.01" step="0.01"
                   inputmode="decimal" value="${tx ? tx.amount : ''}" placeholder="0,00">
          </div>
        </label>
        <label>Competência *
          <input type="month" id="tx-competence" required value="${tx?.competence ?? currentMonth()}">
        </label>
      </div>

      <div class="form-grid">
        <label>Vencimento *
          <input type="date" id="tx-due" required value="${tx?.due_date ?? ''}">
        </label>
        <label>Conta bancária *
          <select id="tx-account" required>
            ${activeAccounts.map((a) =>
    `<option value="${a.id}" ${a.id === tx?.bank_account?.id ? 'selected' : ''}>${esc(a.alias)} · ${esc(a.bank_label)}</option>`).join('')}
          </select>
        </label>
      </div>

      <label>Categoria *
        <select id="tx-coa" required>
          ${coaOptions(options.categories[initialType], tx?.category?.id)}
        </select>
      </label>

      <div class="form-grid">
        <label>Centro de custo
          <select id="tx-cost-center">
            <option value="">— nenhum —</option>
            ${options.costCenters.filter((c) => Number(c.active) === 1).map((c) =>
    `<option value="${c.id}" ${c.id === tx?.cost_center?.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </label>
        <label>Fornecedor
          <select id="tx-supplier">
            <option value="">— nenhum —</option>
            ${options.suppliers.filter((s) => Number(s.active) === 1).map((s) =>
    `<option value="${s.id}" ${s.id === tx?.supplier?.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select>
        </label>
      </div>

      <label>Contato <small class="muted-inline">(cliente ou fornecedor externo)</small>
        <input type="text" id="tx-contact" maxlength="120" value="${esc(tx?.contact ?? '')}">
      </label>

      <label>Informações adicionais
        <textarea id="tx-more" rows="2" maxlength="500">${esc(tx?.more_infos ?? '')}</textarea>
      </label>

      ${tx ? `
        <label>Motivo da alteração
          <small class="muted-inline">(obrigatório ao mudar valor/tipo/conta de um item com pagamentos)</small>
          <input type="text" id="tx-reason" maxlength="300" placeholder="ex.: correção do valor combinado">
        </label>` : `
        <div class="pay-now-box">
          <label class="check">
            <input type="checkbox" id="tx-paid-now">
            Já está ${type === 'receita' ? 'recebida' : 'paga'} — registrar pagamento na criação
          </label>
          <div class="pay-now-fields hidden" id="tx-paid-fields">
            <div class="form-grid">
              <label>Data do pagamento
                <input type="date" id="tx-payment-date" value="${todayISO()}">
              </label>
              <label>Forma de pagamento
                <select id="tx-payment-method">${methodOptions('dinheiro_ou_pix')}</select>
              </label>
            </div>
            <p class="form-hint">O valor integral será registrado na conta escolhida acima.</p>
          </div>
        </div>`}

      <p class="form-error" id="tx-form-error" hidden></p>

      <div class="form-actions">
        <button type="button" class="btn ghost" id="tx-cancel">Cancelar</button>
        <button type="submit" class="btn primary" id="tx-submit">
          ${tx ? 'Salvar alterações' : 'Criar movimentação'}
        </button>
      </div>
    </form>`);

  // alternância de tipo → recarrega categorias compatíveis
  $('#tx-type-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-type]');
    if (!btn) return;
    $$('#tx-type-seg button').forEach((b) => b.classList.toggle('active', b === btn));
    $('#tx-type').value = btn.dataset.type;
    $('#tx-coa').innerHTML = coaOptions(options.categories[btn.dataset.type], null);
  });

  $('#tx-paid-now')?.addEventListener('change', (e) => {
    $('#tx-paid-fields').classList.toggle('hidden', !e.target.checked);
  });

  $('#tx-cancel').addEventListener('click', closeDrawer);

  $('#tx-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#tx-form-error');
    err.hidden = true;

    const amount = Number($('#tx-amount').value);
    if (!Number.isFinite(amount) || amount <= 0) {
      err.textContent = 'Informe um valor maior que zero.';
      err.hidden = false;
      return;
    }
    if (!$('#tx-due').value) {
      err.textContent = 'Informe o vencimento.';
      err.hidden = false;
      return;
    }

    const body = {
      type: $('#tx-type').value,
      reference: $('#tx-reference').value.trim(),
      amount,
      competence: $('#tx-competence').value,
      due_date: $('#tx-due').value,
      bank_account_id: $('#tx-account').value,
      coa_id: Number($('#tx-coa').value),
      cost_center_id: $('#tx-cost-center').value,
      supplier_id: $('#tx-supplier').value,
      contact: $('#tx-contact').value.trim() || undefined,
      more_infos: $('#tx-more').value.trim() || undefined,
    };
    if (!body.coa_id) {
      err.textContent = 'Selecione uma categoria (crie contas no plano de contas se necessário).';
      err.hidden = false;
      return;
    }

    if (tx) {
      if (body.cost_center_id === '') body.cost_center_id = ''; // '' limpa no PATCH
      if (body.supplier_id === '') body.supplier_id = '';
      const reason = $('#tx-reason').value.trim();
      if (reason) body.reason = reason;
    } else if ($('#tx-paid-now')?.checked) {
      body.payment_date = $('#tx-payment-date').value || todayISO();
      body.payment_method = $('#tx-payment-method').value;
    }

    const btn = $('#tx-submit');
    busy(btn, true, 'Salvando…');
    try {
      const data = await fapi(`/companies/transactions${tx ? `/${tx.id}` : ''}`, {
        method: tx ? 'PATCH' : 'POST',
        body,
      });
      toast(data.message || (tx ? 'Movimentação atualizada!' : 'Movimentação criada!'));
      closeDrawer();
      refreshFinanceView(prefix);
    } catch (e2) {
      err.textContent = e2.message;
      err.hidden = false;
    } finally {
      busy(btn, false);
    }
  });
}

/* ═══════════════════════════════════════════════════════════
 * Drawer: detalhe da movimentação (+ pagamento + estorno)
 * ═══════════════════════════════════════════════════════════ */

async function openTxDetail(id, prefix = 'fin') {
  await ensureCompanyContext();
  if (!state.companyId) return;

  let tx;
  try {
    tx = (await fapi(`/companies/transactions/${id}`)).transaction;
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  currentDetail = { id, prefix };

  const remaining = Number(tx.remaining_amount);
  let activeAccounts = [];
  try {
    activeAccounts = (await loadFinOptions()).accounts.filter((a) => Number(a.active) === 1);
  } catch { /* mantém vazio — só afeta o formulário de pagamento */ }

  openDrawer('Detalhe da movimentação', `
    <div class="tx-detail">
      <div class="tx-detail-head">
        ${statusChip(tx.status)}
        ${typeBadge(tx.type)}
        <span class="muted-inline">criada por ${esc(tx.created_by?.name ?? '—')} · ${fmtDate(tx.created_at)}</span>
      </div>
      <h3 class="tx-detail-title">${esc(tx.reference)}</h3>

      <div class="detail-grid">
        <div><dt>Valor</dt><dd class="${tx.type === 'receita' ? 'in' : 'out'}">${money(tx.amount)}</dd></div>
        <div><dt>Pago</dt><dd>${money(tx.paid_amount)}</dd></div>
        <div><dt>Restante</dt><dd class="${remaining > 0 ? 'pending' : 'paid-ok'}">${money(remaining)}</dd></div>
        <div><dt>Vencimento</dt><dd>${fmtDay(tx.due_date)}</dd></div>
        <div><dt>Competência</dt><dd>${tx.competence || '—'}</dd></div>
        <div><dt>Pagamento</dt><dd>${fmtDay(tx.payment_date)}</dd></div>
        <div><dt>Categoria</dt><dd>${tx.category ? `${esc(tx.category.code)} · ${esc(tx.category.label)}` : '—'}</dd></div>
        <div><dt>Conta bancária</dt><dd>${tx.bank_account ? esc(tx.bank_account.alias) : '—'}</dd></div>
        <div><dt>Centro de custo</dt><dd>${tx.cost_center ? esc(tx.cost_center.name) : '—'}</dd></div>
        <div><dt>Fornecedor</dt><dd>${tx.supplier ? esc(tx.supplier.name) : '—'}</dd></div>
        <div><dt>Contato</dt><dd>${tx.contact ? esc(tx.contact) : '—'}</dd></div>
        <div><dt>Origem</dt><dd>Conta bancária</dd></div>
      </div>

      ${tx.more_infos ? `
        <p class="tx-more"><strong>Mais informações:</strong><br>${esc(tx.more_infos)}</p>` : ''}

      ${remaining > 0 && activeAccounts.length ? `
      <div class="pay-box">
        <h4>💰 Registrar pagamento</h4>
        <form id="tx-pay-form" class="pay-form">
          <div class="form-grid">
            <label>Valor
              <input type="number" id="tx-pay-amount" min="0.01" step="0.01"
                     value="${remaining}" required inputmode="decimal">
            </label>
            <label>Data
              <input type="date" id="tx-pay-date" value="${todayISO()}" required>
            </label>
          </div>
          <div class="form-grid">
            <label>Conta
              <select id="tx-pay-account" required>
                ${activeAccounts.map((a) =>
    `<option value="${a.id}" ${a.id === tx.bank_account?.id ? 'selected' : ''}>${esc(a.alias)} · ${esc(a.bank_label)}</option>`).join('')}
              </select>
            </label>
            <label>Forma
              <select id="tx-pay-method">${methodOptions('transferencia')}</select>
            </label>
          </div>
          <div class="form-actions">
            <span class="form-hint">Restante: <strong>${money(remaining)}</strong></span>
            <button type="submit" class="btn primary" id="tx-pay-submit">Registrar pagamento</button>
          </div>
          <p class="form-error" id="tx-pay-error" hidden></p>
        </form>
      </div>` : ''}

      <div class="ledger">
        <h4>📖 Livro-caixa</h4>
        ${tx.payments?.length ? `
          <table class="table">
            <thead><tr>
              <th>Data</th><th>Forma</th><th>Conta</th>
              <th class="right">Valor</th><th class="right">Restante</th><th class="right"></th>
            </tr></thead>
            <tbody>${tx.payments.map((p) => paymentRow(p)).join('')}</tbody>
          </table>` : '<p class="muted">Nenhum pagamento registrado ainda.</p>'}
      </div>

      <div class="form-actions detail-actions">
        <button type="button" class="btn ghost" id="detail-edit">✏️ Editar</button>
        <button type="button" class="btn danger" id="detail-delete">🗑 Excluir</button>
      </div>
    </div>`);

  $('#detail-edit').addEventListener('click', () => openTxForm({ id, prefix }));
  $('#detail-delete').addEventListener('click', () => confirmDeleteTx(id, prefix));

  $('#tx-pay-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#tx-pay-error');
    err.hidden = true;
    const btn = $('#tx-pay-submit');
    busy(btn, true, 'Registrando…');
    try {
      const data = await fapi(`/companies/transactions/${id}/pay`, {
        method: 'POST',
        body: {
          amount: Number($('#tx-pay-amount').value),
          bank_account_id: $('#tx-pay-account').value,
          payment_date: $('#tx-pay-date').value,
          payment_method: $('#tx-pay-method').value,
        },
      });
      toast(data.message || 'Pagamento registrado!');
      refreshFinanceView(prefix);
      openTxDetail(id, prefix); // re-renderiza com o novo pagamento
    } catch (e2) {
      err.textContent = e2.message;
      err.hidden = false;
    } finally {
      busy(btn, false);
    }
  });
}

function paymentRow(p) {
  const isRev = p.kind === 'reversal';
  return `<tr class="${isRev ? 'reversal-row' : ''}" title="${esc(p.reason || '')}">
    <td class="nowrap">${fmtDay(p.payment_date)}</td>
    <td class="muted">${FIN_METHODS[p.payment_method] || p.payment_method}</td>
    <td class="muted">${p.bank_account ? esc(p.bank_account.alias) : '—'}</td>
    <td class="right nowrap ${isRev ? 'in' : 'out'}">${isRev ? '' : '+'} ${money(p.amount)}</td>
    <td class="right nowrap">${money(p.remaining_amount)}</td>
    <td class="right nowrap">
      ${!isRev && !p.reversed
    ? `<button class="icon-btn danger" data-reverse="${p.id}" title="Estornar o restante deste pagamento">↩️</button>`
    : ''}
      ${!isRev && p.reversed ? '<span class="muted-inline">estornado</span>' : ''}
      ${isRev ? '<span class="muted-inline">estorno</span>' : ''}
    </td>
  </tr>`;
}

async function confirmDeleteTx(id, prefix) {
  const answer = await confirmModal({
    title: 'Excluir movimentação',
    message: 'A movimentação e todos os seus pagamentos/estornos serão removidos.<br><strong>Esta ação não pode ser desfeita.</strong>',
    confirmLabel: 'Excluir definitivamente',
    danger: true,
  });
  if (!answer) return;
  try {
    const data = await fapi(`/companies/transactions/${id}`, {
      method: 'DELETE',
      body: { confirm: true },
    });
    toast(data.message || 'Movimentação excluída!');
    closeDrawer();
    refreshFinanceView(prefix);
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ═══════════════════════════════════════════════════════════
 * Empresa: informações
 * ═══════════════════════════════════════════════════════════ */

async function loadCompanyInfo() {
  await ensureCompanyContext();
  const root = $('#company-info-root');
  if (!state.companyId) { renderNoCompany(root, { showCreate: true }); return; }

  let detail;
  let members;
  try {
    [detail, members] = await Promise.all([
      fapi(`/companies/${state.companyId}`),
      fapi(`/companies/${state.companyId}/members`),
    ]);
  } catch (err) {
    renderError(root, err.message);
    return;
  }
  const company = detail.company;
  const list = members.members || [];
  const addr = parseAddress(company.address);

  root.innerHTML = `
    <div class="grid-2 company-grid">
      <div class="card form-card">
        <h2>📁 Dados cadastrais</h2>
        <form id="company-form">
          <label>Razão social *
            <input type="text" id="cf-name" required maxlength="150" value="${esc(company.name)}">
          </label>
          <label>Nome fantasia
            <input type="text" id="cf-trade" maxlength="150" value="${esc(company.trade_name ?? '')}">
          </label>
          <div class="form-grid">
            <label>CNPJ *
              <input type="text" id="cf-document" required maxlength="20" value="${esc(company.document)}">
            </label>
            <label>Ramo de atividade
              <input type="text" id="cf-business" maxlength="150" value="${esc(company.business ?? '')}">
            </label>
          </div>
          <div class="form-grid">
            <label>Email
              <input type="email" id="cf-email" maxlength="150" value="${esc(company.email ?? '')}">
            </label>
            <label>Telefone
              <input type="text" id="cf-phone" maxlength="30" value="${esc(company.phone ?? '')}">
            </label>
          </div>
          <label>Website
            <input type="url" id="cf-website" maxlength="200" value="${esc(company.website ?? '')}">
          </label>
          <div class="form-grid">
            <label>Regime tributário
              <select id="cf-tax">
                ${TAX_REGIMES.map((r) =>
    `<option ${r === company.tax_regime ? 'selected' : ''}>${r}</option>`).join('')}
              </select>
            </label>
            <label>Faturamento médio mensal (R$)
              <input type="number" id="cf-billing" min="0" step="0.01" value="${company.average_billing ?? 0}">
            </label>
          </div>
          <label>Data de fundação
            <input type="date" id="cf-founded" value="${company.founded_at ?? ''}">
          </label>

          <h2 class="section-title">📮 Endereço</h2>
          <div class="form-grid">
            <label>Rua <input type="text" id="cf-street" value="${esc(addr.street ?? '')}"></label>
            <label>Número <input type="text" id="cf-number" maxlength="10" value="${esc(addr.number ?? '')}"></label>
          </div>
          <div class="form-grid">
            <label>Bairro <input type="text" id="cf-neigh" value="${esc(addr.neighbourhood ?? '')}"></label>
            <label>CEP <input type="text" id="cf-zip" maxlength="10" value="${esc(addr.zip_code ?? '')}"></label>
          </div>
          <div class="form-grid">
            <label>Cidade <input type="text" id="cf-city" value="${esc(addr.city ?? '')}"></label>
            <label>UF <input type="text" id="cf-state" maxlength="2" value="${esc(addr.state ?? '')}"></label>
          </div>

          <div class="form-actions">
            <span class="form-hint">Meu papel: <strong>${ROLE_LABELS[company.my_role] || company.my_role}</strong></span>
            <button type="submit" class="btn primary" id="cf-submit">Salvar alterações</button>
          </div>
          <p class="form-error" id="cf-error" hidden></p>
        </form>
      </div>

      <div>
        <div class="card">
          <div class="card-head"><h2>👥 Membros (${list.length})</h2></div>
          <table class="table">
            <thead><tr><th>Nome</th><th>Username</th><th>Papel</th></tr></thead>
            <tbody>
              ${list.map((m) => `<tr>
                <td>${esc(m.name)}</td>
                <td class="muted">${esc(m.username)}</td>
                <td><span class="badge ${m.role === 'owner' ? '' : 'admin'}">${ROLE_LABELS[m.role] || m.role}</span></td>
              </tr>`).join('')}
            </tbody>
          </table>
          <p class="muted-inline" style="margin-top:10px">
            Convites de membros chegam na fase 2 do módulo financeiro.
          </p>
        </div>
      </div>
    </div>`;

  $('#company-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#cf-error');
    err.hidden = true;
    const btn = $('#cf-submit');
    busy(btn, true, 'Salvando…');
    try {
      await fapi(`/companies/${state.companyId}`, {
        method: 'PATCH',
        body: {
          name: $('#cf-name').value.trim(),
          trade_name: $('#cf-trade').value.trim() || undefined,
          document: $('#cf-document').value.trim(),
          business: $('#cf-business').value.trim() || undefined,
          email: $('#cf-email').value.trim() || undefined,
          phone: $('#cf-phone').value.trim() || undefined,
          website: $('#cf-website').value.trim() || undefined,
          tax_regime: $('#cf-tax').value,
          average_billing: Number($('#cf-billing').value) || 0,
          founded_at: $('#cf-founded').value || undefined,
          address: {
            street: $('#cf-street').value.trim(),
            number: $('#cf-number').value.trim(),
            neighbourhood: $('#cf-neigh').value.trim(),
            zip_code: $('#cf-zip').value.trim(),
            city: $('#cf-city').value.trim(),
            state: $('#cf-state').value.trim().toUpperCase(),
          },
        },
      });
      toast('Informações da empresa atualizadas!');
      finCtxPromise = initCompanyContext(); // atualiza nome no seletor
    } catch (e2) {
      err.textContent = e2.message;
      err.hidden = false;
    } finally {
      busy(btn, false);
    }
  });
}

/** Modal de criação de empresa (também usado pelo estado vazio). */
async function openCompanyCreateModal() {
  const answer = await new Promise((resolve) => {
    openModal(
      'Criar empresa',
      `
      <label class="modal-label">Razão social *
        <input type="text" id="nc-name" maxlength="150" placeholder="ex.: Comercial Pacheco Ltda">
      </label>
      <label class="modal-label">Nome fantasia
        <input type="text" id="nc-trade" maxlength="150" placeholder="ex.: Comercial Pacheco">
      </label>
      <label class="modal-label">CNPJ *
        <input type="text" id="nc-document" maxlength="20" placeholder="00.000.000/0000-00">
      </label>
      <label class="modal-label">Ramo de atividade
        <input type="text" id="nc-business" maxlength="150" placeholder="ex.: Comércio varejista">
      </label>
      <p class="form-error" id="nc-error" hidden></p>`,
      `
      <button type="button" class="btn ghost" id="modal-cancel">Cancelar</button>
      <button type="button" class="btn primary" id="modal-confirm">Criar empresa</button>`,
    );
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      modalDismiss = null;
      closeModal();
      resolve(v);
    };
    modalDismiss = () => finish(null);
    $('#modal-cancel').onclick = () => finish(null);
    $('#modal-confirm').onclick = async () => {
      const err = $('#nc-error');
      err.hidden = true;
      const name = $('#nc-name').value.trim();
      const document_ = $('#nc-document').value.trim();
      if (!name || !document_) {
        err.textContent = 'Razão social e CNPJ são obrigatórios.';
        err.hidden = false;
        return;
      }
      const btn = $('#modal-confirm');
      busy(btn, true, 'Criando…');
      try {
        const data = await api('/companies', {
          method: 'POST',
          body: {
            name,
            trade_name: $('#nc-trade').value.trim() || undefined,
            document: document_,
            business: $('#nc-business').value.trim() || undefined,
          },
        });
        finish(data.company?.id ?? true);
        toast(data.message || 'Empresa criada!');
      } catch (e2) {
        err.textContent = e2.message;
        err.hidden = false;
        busy(btn, false);
      }
    };
  });
  if (!answer) return;
  // seleciona a empresa recém-criada e abre a página de informações
  finCtxToken = null;
  await ensureCompanyContext();
  if (typeof answer === 'string') setCompany(answer, { silent: true });
  location.hash = '#/empresa';
  route();
}

/* ═══════════════════════════════════════════════════════════
 * Empresa: plano de contas
 * ═══════════════════════════════════════════════════════════ */

async function loadCompanyCoa() {
  await ensureCompanyContext();
  const root = $('#coa-root');
  if (!state.companyId) { renderNoCompany(root, { showCreate: true }); return; }

  let tree;
  try {
    tree = (await fapi('/companies/coa')).accounts || [];
  } catch (err) {
    renderError(root, err.message);
    return;
  }

  root.innerHTML = `
    <div class="card">
      <p class="muted-inline" style="margin:0 0 14px">
        Use códigos consistentes: <code>1.x</code> Ativo · <code>2.x</code> Passivo ·
        <code>3.x</code> Receitas · <code>4.x</code> Despesas · <code>5.x</code> Patrimônio.
        Contas com subcontas são <strong>títulos</strong> e não recebem lançamentos.
      </p>
      <div class="coa-tree" id="coa-tree">
        ${tree.length ? tree.map((n) => coaNodeHTML(n, 0)).join('') : ''}
      </div>
      ${tree.length ? '' : `
        <p class="empty">Plano de contas vazio.<br>
        <span class="muted-inline">Comece criando contas raiz de receita e despesa.</span></p>`}
    </div>`;

  root.querySelector('#coa-tree').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-coa-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const action = btn.dataset.coaAction;
    const code = btn.dataset.code;
    const label = btn.dataset.label;
    const type = btn.dataset.type;
    if (action === 'add') openCoaForm({ parentId: id, parentLabel: label, parentCode: code, type });
    if (action === 'edit') openCoaForm({ id });
    if (action === 'delete') confirmDeleteCoa(id, label);
  });
}

function coaNodeHTML(node, depth) {
  const isTitle = Number(node.is_title) === 1;
  return `
    <div class="coa-row ${Number(node.active) === 0 ? 'inactive' : ''}" style="padding-left:${8 + depth * 22}px">
      <span class="coa-code">${esc(node.code ?? '—')}</span>
      <span class="coa-label ${isTitle ? 'is-title' : ''}">${esc(node.label)}</span>
      <span class="badge type-${node.type}">${COA_TYPE_LABELS[node.type] || node.type}</span>
      ${isTitle ? '<span class="muted-inline">título</span>' : ''}
      ${Number(node.active) === 0 ? '<span class="status-chip vencido">inativa</span>' : ''}
      <span class="row-actions">
        ${isTitle ? `<button class="icon-btn" data-coa-action="add" data-id="${node.id}"
              data-code="${esc(node.code ?? '')}" data-label="${esc(node.label)}" data-type="${node.type}"
              title="Criar subconta">＋</button>` : ''}
        <button class="icon-btn" data-coa-action="edit" data-id="${node.id}" title="Editar">✏️</button>
        <button class="icon-btn danger" data-coa-action="delete" data-id="${node.id}" title="Excluir">🗑</button>
      </span>
    </div>
    ${(node.children || []).map((c) => coaNodeHTML(c, depth + 1)).join('')}`;
}

/** Modal do formulário de conta do plano (criar/editar/subconta). */
async function openCoaForm({ id = null, parentId = null, parentLabel = null, parentCode = null, type = 'despesa' } = {}) {
  await ensureCompanyContext();
  if (!state.companyId) return;

  let account = null;
  if (id) {
    try {
      account = (await fapi(`/companies/coa/${id}`)).account;
    } catch (err) {
      toast(err.message, 'error');
      return;
    }
  }
  const initialType = account?.type || type;

  const answer = await new Promise((resolve) => {
    openModal(
      account ? `Editar conta ${account.code ?? ''}` : parentId ? `Nova subconta de ${parentCode}` : 'Nova conta do plano',
      `
      ${parentId ? `<p class="muted-inline">Subconta de: <strong>${esc(parentCode)} · ${esc(parentLabel)}</strong></p>` : ''}
      <label class="modal-label">Nome *
        <input type="text" id="coaf-label" maxlength="120" value="${esc(account?.label ?? '')}"
               placeholder="ex.: Energia elétrica">
      </label>
      <div class="form-grid">
        <label class="modal-label">Tipo
          <select id="coaf-type" ${parentId ? 'disabled' : ''}>
            ${Object.entries(COA_TYPE_LABELS).map(([v, l]) =>
    `<option value="${v}" ${v === initialType ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        <label class="modal-label">Código
          <input type="text" id="coaf-code" maxlength="20" value="${esc(account?.code ?? '')}"
                 placeholder="auto (ex.: 4.2.07)">
        </label>
      </div>
      <label class="modal-label">Descrição
        <input type="text" id="coaf-desc" maxlength="300" value="${esc(account?.description ?? '')}">
      </label>
      <label class="check">
        <input type="checkbox" id="coaf-active" ${!account || Number(account.active) === 1 ? 'checked' : ''}>
        Conta ativa
      </label>
      <p class="form-error" id="coaf-error" hidden></p>`,
      `
      <button type="button" class="btn ghost" id="modal-cancel">Cancelar</button>
      <button type="button" class="btn primary" id="modal-confirm">${account ? 'Salvar' : 'Criar conta'}</button>`,
    );
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      modalDismiss = null;
      closeModal();
      resolve(v);
    };
    modalDismiss = () => finish(null);
    $('#modal-cancel').onclick = () => finish(null);
    $('#modal-confirm').onclick = async () => {
      const err = $('#coaf-error');
      err.hidden = true;
      const label = $('#coaf-label').value.trim();
      if (!label) {
        err.textContent = 'O nome é obrigatório.';
        err.hidden = false;
        return;
      }
      const body = {
        label,
        type: initialType,
        code: $('#coaf-code').value.trim() || undefined,
        description: $('#coaf-desc').value.trim() || undefined,
        active: $('#coaf-active').checked,
        ...(parentId ? { parent_id: parentId } : {}),
      };
      const btn = $('#modal-confirm');
      busy(btn, true, 'Salvando…');
      try {
        const data = await fapi(`/companies/coa${account ? `/${account.id}` : ''}`, {
          method: account ? 'PATCH' : 'POST',
          body,
        });
        finish(true);
        toast(data.message || 'Conta salva!');
      } catch (e2) {
        err.textContent = e2.message;
        err.hidden = false;
        busy(btn, false);
      }
    };
  });
  if (answer) loadCompanyCoa();
}

async function confirmDeleteCoa(id, label) {
  const answer = await confirmModal({
    title: 'Excluir conta do plano',
    message: `Excluir <strong>${esc(label)}</strong>?<br>
      <span class="muted-inline">Contas usadas por movimentações ou com subcontas não podem ser excluídas.</span>`,
    confirmLabel: 'Excluir conta',
    danger: true,
  });
  if (!answer) return;
  try {
    const data = await fapi(`/companies/coa/${id}`, { method: 'DELETE' });
    toast(data.message || 'Conta excluída!');
    loadCompanyCoa();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ═══════════════════════════════════════════════════════════
 * Empresa: contas bancárias
 * ═══════════════════════════════════════════════════════════ */

async function loadCompanyAccounts() {
  await ensureCompanyContext();
  const root = $('#accounts-root');
  if (!state.companyId) { renderNoCompany(root, { showCreate: true }); return; }

  let accounts;
  try {
    accounts = (await fapi('/bank-accounts')).bank_accounts || [];
  } catch (err) {
    renderError(root, err.message);
    return;
  }

  root.innerHTML = `
    <div class="card">
      <div class="table-scroll">
      <table class="table">
        <thead><tr>
          <th>Conta</th><th>Banco</th><th>Agência</th><th>Número</th><th>Tipo</th>
          <th class="right">Saldo inicial</th><th class="right">Saldo atual</th>
          <th class="right">Movim.</th><th>Status</th><th class="right">Ações</th>
        </tr></thead>
        <tbody>
          ${accounts.map((a) => `<tr>
            <td><strong>${esc(a.alias)}</strong></td>
            <td class="muted">${esc(a.bank_code)} · ${esc(a.bank_label)}</td>
            <td class="nowrap muted">${esc(a.agency)}</td>
            <td class="nowrap muted">${esc(a.account_number)}</td>
            <td class="muted">${ACCOUNT_TYPES[a.type] || a.type}</td>
            <td class="right nowrap muted">${money(a.opening_balance)}</td>
            <td class="right nowrap ${Number(a.current_balance) >= 0 ? 'in' : 'out'}">${money(a.current_balance)}</td>
            <td class="right muted">${a.transactions_count}</td>
            <td>${Number(a.active) === 1
    ? '<span class="status-chip pago">ativa</span>'
    : '<span class="status-chip vencido">inativa</span>'}</td>
            <td class="right nowrap">
              <button class="icon-btn" data-acc-action="edit" data-id="${a.id}" title="Editar">✏️</button>
              <button class="icon-btn danger" data-acc-action="delete" data-id="${a.id}" title="Excluir">🗑</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>
      ${accounts.length ? '' : `
        <p class="empty">Nenhuma conta bancária cadastrada.<br>
        <span class="muted-inline">As movimentações precisam de pelo menos uma conta ativa.</span></p>`}
      <p class="muted-inline" style="margin:12px 0 0">
        O saldo atual é derivado do saldo inicial + pagamentos registrados − estornos.
      </p>
    </div>`;

  root.querySelector('table').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-acc-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.accAction === 'edit') openAccountForm(id);
    if (btn.dataset.accAction === 'delete') confirmDeleteAccount(id);
  });
}

async function openAccountForm(id = null) {
  await ensureCompanyContext();
  if (!state.companyId) return;

  let banks;
  let account = null;
  try {
    banks = (await api('/banks')).banks || [];
    if (id) account = (await fapi(`/bank-accounts/${id}`)).bank_account;
  } catch (err) {
    toast(err.message, 'error');
    return;
  }

  const answer = await new Promise((resolve) => {
    openModal(
      account ? 'Editar conta bancária' : 'Nova conta bancária',
      `
      <label class="modal-label">Banco *
        <select id="accf-bank" required ${account ? 'disabled' : ''}>
          ${banks.map((b) =>
    `<option value="${b.id}" ${b.id === account?.bank_id ? 'selected' : ''}>${esc(b.code)} · ${esc(b.label)}</option>`).join('')}
        </select>
      </label>
      <label class="modal-label">Apelido *
        <input type="text" id="accf-alias" maxlength="100" required
               value="${esc(account?.alias ?? '')}" placeholder="ex.: Conta Principal BB">
      </label>
      <div class="form-grid">
        <label class="modal-label">Agência *
          <input type="text" id="accf-agency" maxlength="15" required
                 value="${esc(account?.agency ?? '')}" placeholder="ex.: 1234-5">
        </label>
        <label class="modal-label">Número *
          <input type="text" id="accf-number" maxlength="20" required
                 value="${esc(account?.account_number ?? '')}" placeholder="ex.: 98765-4">
        </label>
      </div>
      <label class="modal-label">Tipo
        <select id="accf-type">
          ${Object.entries(ACCOUNT_TYPES).map(([v, l]) =>
    `<option value="${v}" ${v === account?.type ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </label>
      ${account ? `
        <label class="check"><input type="checkbox" id="accf-active" ${Number(account.active) === 1 ? 'checked' : ''}> Conta ativa</label>
        <p class="muted-inline">O saldo inicial não pode ser alterado depois de criada a conta.</p>` : `
        <label class="modal-label">Saldo inicial (R$)
          <input type="number" id="accf-opening" min="0" step="0.01" value="0" placeholder="0,00">
        </label>`}
      <p class="form-error" id="accf-error" hidden></p>`,
      `
      <button type="button" class="btn ghost" id="modal-cancel">Cancelar</button>
      <button type="button" class="btn primary" id="modal-confirm">${account ? 'Salvar' : 'Criar conta'}</button>`,
    );
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      modalDismiss = null;
      closeModal();
      resolve(v);
    };
    modalDismiss = () => finish(null);
    $('#modal-cancel').onclick = () => finish(null);
    $('#modal-confirm').onclick = async () => {
      const err = $('#accf-error');
      err.hidden = true;
      const body = {
        alias: $('#accf-alias').value.trim(),
        agency: $('#accf-agency').value.trim(),
        account_number: $('#accf-number').value.trim(),
        type: $('#accf-type').value,
      };
      if (!body.alias || !body.agency || !body.account_number) {
        err.textContent = 'Preencha apelido, agência e número.';
        err.hidden = false;
        return;
      }
      if (account) body.active = $('#accf-active').checked;
      else {
        body.bank_id = $('#accf-bank').value;
        body.opening_balance = Number($('#accf-opening').value) || 0;
      }
      const btn = $('#modal-confirm');
      busy(btn, true, 'Salvando…');
      try {
        const data = await fapi(`/bank-accounts${account ? `/${account.id}` : ''}`, {
          method: account ? 'PATCH' : 'POST',
          body,
        });
        finish(true);
        toast(data.message || 'Conta salva!');
      } catch (e2) {
        err.textContent = e2.message;
        err.hidden = false;
        busy(btn, false);
      }
    };
  });
  if (answer) {
    loadCompanyAccounts();
    finOptions = null; // lista de contas mudou
  }
}

async function confirmDeleteAccount(id) {
  const answer = await confirmModal({
    title: 'Excluir conta bancária',
    message: 'Contas com movimentações registradas não podem ser excluídas<br>(integridade histórica) — nesse caso, desative-a.',
    confirmLabel: 'Excluir conta',
    danger: true,
  });
  if (!answer) return;
  try {
    const data = await fapi(`/bank-accounts/${id}`, { method: 'DELETE' });
    toast(data.message || 'Conta excluída!');
    loadCompanyAccounts();
    finOptions = null;
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ═══════════════════════════════════════════════════════════
 * Empresa: centros de custo
 * ═══════════════════════════════════════════════════════════ */

async function loadCostCenters() {
  await ensureCompanyContext();
  const root = $('#cost-centers-root');
  if (!state.companyId) { renderNoCompany(root, { showCreate: true }); return; }

  let centers;
  try {
    centers = (await fapi('/cost-centers')).cost_centers || [];
  } catch (err) {
    renderError(root, err.message);
    return;
  }

  root.innerHTML = `
    <div class="card">
      <form class="inline-form" id="cc-create-form">
        <input type="text" id="cc-name" maxlength="100" placeholder="Nome do novo centro de custo…">
        <button type="submit" class="btn primary">＋ Criar</button>
      </form>
      <table class="table" id="cc-table">
        <thead><tr>
          <th>Centro de custo</th><th class="right">Movimentações</th><th>Status</th><th class="right">Ações</th>
        </tr></thead>
        <tbody>
          ${centers.map((c) => `<tr data-id="${c.id}">
            <td><strong>${esc(c.name)}</strong></td>
            <td class="right muted">${c.usage_count}</td>
            <td>${Number(c.active) === 1
    ? '<span class="status-chip pago">ativo</span>'
    : '<span class="status-chip vencido">inativo</span>'}</td>
            <td class="right nowrap">
              <button class="icon-btn" data-cc-action="edit" data-id="${c.id}" data-name="${esc(c.name)}" title="Renomear">✏️</button>
              <button class="icon-btn danger" data-cc-action="delete" data-id="${c.id}" title="Excluir">🗑</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${centers.length ? '' : '<p class="empty">Nenhum centro de custo cadastrado.</p>'}
      <p class="muted-inline" style="margin:12px 0 0">
        Centros usados por movimentações não são excluídos — apenas desativados.
      </p>
    </div>`;

  $('#cc-create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#cc-name').value.trim();
    if (!name) return;
    try {
      const data = await fapi('/cost-centers', { method: 'POST', body: { name } });
      toast(data.message || 'Centro criado!');
      finOptions = null;
      loadCostCenters();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#cc-table').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-cc-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.ccAction === 'edit') {
      const answer = await confirmModal({
        title: 'Renomear centro de custo',
        inputLabel: 'Novo nome *',
        inputValue: btn.dataset.name,
        confirmLabel: 'Salvar',
      });
      if (!answer || !String(answer).trim()) return;
      try {
        await fapi(`/cost-centers/${id}`, {
          method: 'PATCH',
          body: { name: String(answer).trim() },
        });
        toast('Centro renomeado!');
        finOptions = null;
        loadCostCenters();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    if (btn.dataset.ccAction === 'delete') {
      const answer = await confirmModal({
        title: 'Excluir centro de custo',
        message: 'Centros usados por movimentações não são excluídos — apenas desativados.',
        confirmLabel: 'Excluir',
        danger: true,
      });
      if (!answer) return;
      try {
        const data = await fapi(`/cost-centers/${id}`, { method: 'DELETE' });
        toast(data.message || 'Excluído!');
        finOptions = null;
        loadCostCenters();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });
}

/* ═══════════════════════════════════════════════════════════
 * Empresa: fornecedores
 * ═══════════════════════════════════════════════════════════ */

async function loadSuppliers() {
  await ensureCompanyContext();
  const root = $('#suppliers-root');
  if (!state.companyId) { renderNoCompany(root, { showCreate: true }); return; }

  let suppliers;
  try {
    suppliers = (await fapi('/suppliers')).suppliers || [];
  } catch (err) {
    renderError(root, err.message);
    return;
  }

  root.innerHTML = `
    <div class="card">
      <form class="inline-form" id="sup-create-form">
        <input type="text" id="sup-name" maxlength="120" placeholder="Nome do fornecedor…">
        <input type="text" id="sup-document" maxlength="20" class="sup-doc" placeholder="CNPJ/CPF…">
        <button type="submit" class="btn primary">＋ Criar</button>
      </form>
      <table class="table" id="sup-table">
        <thead><tr>
          <th>Fornecedor</th><th>Documento</th><th class="right">Movimentações</th><th>Status</th><th class="right">Ações</th>
        </tr></thead>
        <tbody>
          ${suppliers.map((s) => `<tr>
            <td><strong>${esc(s.name)}</strong></td>
            <td class="nowrap muted">${esc(s.document)}</td>
            <td class="right muted">${s.usage_count}</td>
            <td>${Number(s.active) === 1
    ? '<span class="status-chip pago">ativo</span>'
    : '<span class="status-chip vencido">inativo</span>'}</td>
            <td class="right nowrap">
              <button class="icon-btn" data-sup-action="edit" data-id="${s.id}" data-name="${esc(s.name)}"
                      data-doc="${esc(s.document)}" title="Editar">✏️</button>
              <button class="icon-btn danger" data-sup-action="delete" data-id="${s.id}" title="Excluir">🗑</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${suppliers.length ? '' : '<p class="empty">Nenhum fornecedor cadastrado.</p>'}
      <p class="muted-inline" style="margin:12px 0 0">
        Fornecedores usados por movimentações não são excluídos — apenas desativados.
      </p>
    </div>`;

  $('#sup-create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#sup-name').value.trim();
    const document_ = $('#sup-document').value.trim();
    if (!name || !document_) {
      toast('Informe nome e documento (CNPJ/CPF) do fornecedor.', 'error');
      return;
    }
    try {
      const data = await fapi('/suppliers', {
        method: 'POST',
        body: { name, document: document_ },
      });
      toast(data.message || 'Fornecedor criado!');
      finOptions = null;
      loadSuppliers();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#sup-table').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-sup-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.supAction === 'edit') {
      const answer = await confirmModal({
        title: 'Editar fornecedor',
        inputLabel: 'Nome *',
        inputValue: btn.dataset.name,
        confirmLabel: 'Salvar',
      });
      if (!answer || !String(answer).trim()) return;
      const name = String(answer).trim();
      const doc = await confirmModal({
        title: 'Editar fornecedor',
        inputLabel: 'Documento (CNPJ/CPF) *',
        inputValue: btn.dataset.doc,
        confirmLabel: 'Salvar',
      });
      if (!doc || !String(doc).trim()) return;
      try {
        await fapi(`/suppliers/${id}`, {
          method: 'PATCH',
          body: { name, document: String(doc).trim() },
        });
        toast('Fornecedor atualizado!');
        finOptions = null;
        loadSuppliers();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    if (btn.dataset.supAction === 'delete') {
      const answer = await confirmModal({
        title: 'Excluir fornecedor',
        message: 'Fornecedores usados por movimentações não são excluídos — apenas desativados.',
        confirmLabel: 'Excluir',
        danger: true,
      });
      if (!answer) return;
      try {
        const data = await fapi(`/suppliers/${id}`, { method: 'DELETE' });
        toast(data.message || 'Excluído!');
        finOptions = null;
        loadSuppliers();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });
}

/* ═══════════════════════════════════════════════════════════
 * Registro das views + bindings globais
 * ═══════════════════════════════════════════════════════════ */

Object.assign(VIEW_MAP, {
  'financas/transacoes': 'fin-transactions',
  'financas/contas-a-pagar': 'fin-payables',
  'financas/contas-a-receber': 'fin-receivables',
  'empresa': 'company-info',
  'empresa/plano-contas': 'company-coa',
  'empresa/contas-bancarias': 'company-accounts',
  'empresa/centros-custo': 'company-cost-centers',
  'empresa/fornecedores': 'company-suppliers',
});

registerView('fin-transactions', loadFinTransactions);
registerView('fin-payables', loadFinPayables);
registerView('fin-receivables', loadFinReceivables);
registerView('company-info', loadCompanyInfo);
registerView('company-coa', loadCompanyCoa);
registerView('company-accounts', loadCompanyAccounts);
registerView('company-cost-centers', loadCostCenters);
registerView('company-suppliers', loadSuppliers);

/* Fábricas das 3 listas (fin = todas · pay = despesas · rec = receitas) */
finViews.fin = setupFinanceList('fin');
finViews.pay = setupFinanceList('pay', { fixedType: 'despesa', defaultStatus: 'pendente' });
finViews.rec = setupFinanceList('rec', { fixedType: 'receita', defaultStatus: 'pendente' });

/* Botões de criação nos cabeçalhos */
$('#fin-new').addEventListener('click', () => openTxForm({ prefix: 'fin' }));
$('#pay-new').addEventListener('click', () => openTxForm({ prefix: 'pay', type: 'despesa' }));
$('#rec-new').addEventListener('click', () => openTxForm({ prefix: 'rec', type: 'receita' }));
$('#company-new').addEventListener('click', openCompanyCreateModal);
$('#coa-new').addEventListener('click', () => openCoaForm({}));
$('#account-new').addEventListener('click', () => openAccountForm());

/* Seletor de empresa no menu lateral */
bindCompanySelect();

/* Fechamento de drawer/modal */
$('#drawer-close').addEventListener('click', closeDrawer);
$('#drawer-backdrop').addEventListener('click', closeDrawer);
$('#modal-close').addEventListener('click', closeModal);
$('#modal-backdrop').addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#modal').hidden) closeModal();
  else if (!$('#drawer').hidden) closeDrawer();
});

/* Estorno de pagamento (delegação no corpo do drawer) */
$('#drawer-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-reverse]');
  if (!btn || !currentDetail) return;
  const paymentId = btn.dataset.reverse;
  const answer = await confirmModal({
    title: 'Estornar pagamento',
    message: 'O <strong>restante</strong> deste pagamento será estornado no livro-caixa<br>(nova linha com valor negativo, mesmo design da EXTAT).',
    inputLabel: 'Motivo do estorno *',
    inputPlaceholder: 'ex.: pagamento feito na conta errada',
    confirmLabel: 'Estornar',
    danger: true,
  });
  if (!answer) return;
  if (!String(answer).trim()) {
    toast('Informe o motivo do estorno.', 'error');
    return;
  }
  try {
    const data = await fapi(
      `/companies/transactions/${currentDetail.id}/payments/${paymentId}/reverse`,
      { method: 'POST', body: { reason: String(answer).trim() } },
    );
    toast(data.message || 'Estorno registrado!');
    refreshFinanceView(currentDetail.prefix);
    openTxDetail(currentDetail.id, currentDetail.prefix);
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* Reação a login/logout (chamada pelo app.js em setSession/logout).
   Reseta caches por empresa e reinicializa o contexto. */
function onSessionChanged() {
  finOptions = null;
  finCompanies = [];
  finCtxToken = null;
  if (state.token) ensureCompanyContext();
}

/* Contexto de empresa disponível desde o boot (seletor aparece no menu
   mesmo em views da carteira). Idempotente por token. */
if (state.token) ensureCompanyContext();
