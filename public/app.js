/* ═══════════════════════════════════════════════════════════
 * PACHECO SOLUTIONS — Interface web (vanilla JS, sem build)
 * Cliente da API REST servida pelo mesmo servidor Express.
 * ═══════════════════════════════════════════════════════════ */
'use strict';

const TOKEN_KEY = 'pacheco_token';
const USER_KEY = 'pacheco_user';

const state = {
  token: localStorage.getItem(TOKEN_KEY),
  user: JSON.parse(localStorage.getItem(USER_KEY) || 'null'),
  transactions: [],
  filter: 'all',
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (v) => fmtBRL.format(Number(v ?? 0));

/** Timestamps do SQLite (UTC, "YYYY-MM-DD HH:MM:SS") → data legível pt-BR. */
function fmtDate(s) {
  if (!s) return '—';
  const iso = s.includes('T') ? s : s.replace(' ', 'T') + 'Z';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const initials = (name) =>
  (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/* ── API ─────────────────────────────────────────────────── */
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = {};
  try { data = await res.json(); } catch { /* resposta sem corpo */ }
  if (res.status === 401 && state.token) {
    logout('Sessão expirada. Entre novamente.');
    throw new Error(data.error || 'Sessão expirada');
  }
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

/* ── Sessão ──────────────────────────────────────────────── */
function setSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function logout(message) {
  state.token = null;
  state.user = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  location.hash = '';
  route();
  if (message) toast(message, 'error');
}

/* ── UI helpers ──────────────────────────────────────────── */
function toast(msg, type = 'success') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 3800);
}

function showError(id, message) {
  const el = $(id);
  el.textContent = message;
  el.hidden = !message;
}

function busy(btn, isBusy, labelBusy = 'Processando…') {
  if (isBusy) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.textContent = labelBusy;
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.label || btn.textContent;
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ── Router ──────────────────────────────────────────────── */
const VIEW_MAP = {
  'visao-geral': 'dashboard',
  'transferir': 'transfer',
  'transacoes': 'transactions',
  'perfil': 'profile',
  'usuarios': 'admin',
};

function route() {
  const authed = !!state.token;
  $('#auth-screen').classList.toggle('hidden', authed);
  $('#app-screen').classList.toggle('hidden', !authed);
  if (!authed) return;

  paintUser();
  const key = (location.hash || '#/visao-geral').replace('#/', '') || 'visao-geral';
  let view = VIEW_MAP[key] || 'dashboard';
  if (view === 'admin' && state.user?.role !== 'admin') view = 'dashboard';

  $$('.view').forEach((v) => (v.hidden = true));
  const el = $(`#view-${view}`);
  if (el) el.hidden = false;
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));

  if (view === 'dashboard') loadDashboard();
  if (view === 'transfer') prepareTransfer();
  if (view === 'transactions') loadTransactions();
  if (view === 'profile') loadProfile();
  if (view === 'admin') loadUsers();
}

function paintUser() {
  const u = state.user;
  $('#nav-admin').hidden = u?.role !== 'admin';
  $('#sidebar-username').textContent = u?.username ?? '—';
  $('#sidebar-role').textContent =
    u?.role === 'admin' ? 'Administrador' : 'Usuário';
  $('#sidebar-avatar').textContent = initials(u?.name);
}

/* ── Login / Cadastro ────────────────────────────────────── */
function bindAuth() {
  $$('.auth-tab').forEach((tab) =>
    tab.addEventListener('click', () => {
      $$('.auth-tab').forEach((t) => t.classList.toggle('active', t === tab));
      $('#login-form').classList.toggle('hidden', tab.dataset.tab !== 'login');
      $('#register-form').classList.toggle('hidden', tab.dataset.tab !== 'register');
      showError('#login-error', '');
      showError('#register-error', '');
    })
  );

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#login-btn');
    busy(btn, true, 'Entrando…');
    showError('#login-error', '');
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: { email: $('#login-email').value.trim(), password: $('#login-password').value },
      });
      setSession(data.token, data.user);
      location.hash = '#/visao-geral';
      route();
      toast(`Bem-vindo(a), ${data.user.name.split(' ')[0]}!`);
    } catch (err) {
      showError('#login-error', err.message);
    } finally {
      busy(btn, false);
    }
  });

  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#register-btn');
    busy(btn, true, 'Criando conta…');
    showError('#register-error', '');
    try {
      const data = await api('/auth/register', {
        method: 'POST',
        body: {
          name: $('#reg-name').value.trim(),
          username: $('#reg-username').value.trim(),
          email: $('#reg-email').value.trim(),
          cpf: $('#reg-cpf').value.trim() || undefined,
          password: $('#reg-password').value,
        },
      });
      setSession(data.token, { ...data.user, balance: 0 });
      location.hash = '#/visao-geral';
      route();
      toast('Conta criada com sucesso! Bem-vindo(a)!');
    } catch (err) {
      showError('#register-error', err.message);
    } finally {
      busy(btn, false);
    }
  });

  $('#logout-btn').addEventListener('click', () => {
    logout();
    toast('Sessão encerrada.');
  });
}

/* ── Visão geral (dashboard) ──────────────────────────────── */
async function refreshUser() {
  try {
    const data = await api('/users/profile');
    state.user = { ...state.user, ...data.user };
    localStorage.setItem(USER_KEY, JSON.stringify(state.user));
    paintUser();
  } catch { /* silencioso — 401 já tratado no api() */ }
}

async function loadDashboard() {
  $('#today').textContent = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  $('#balance-value').textContent = money(state.user?.balance);

  try {
    const data = await api('/transactions');
    state.transactions = data.transactions || [];
  } catch {
    state.transactions = [];
  }

  const mine = state.transactions;
  const sent = mine.filter((t) => t.sender_id === state.user?.id);
  const received = mine.filter((t) => t.sender_id !== state.user?.id);
  $('#stat-sent').textContent = money(sent.reduce((s, t) => s + Number(t.amount), 0));
  $('#stat-sent-count').textContent = `${sent.length} transferência${sent.length === 1 ? '' : 's'}`;
  $('#stat-received').textContent = money(received.reduce((s, t) => s + Number(t.amount), 0));
  $('#stat-received-count').textContent = `${received.length} transferência${received.length === 1 ? '' : 's'}`;

  const tbody = $('#recent-transactions tbody');
  tbody.innerHTML = mine.slice(0, 5).map((t) => txRow(t, true)).join('');
  $('#recent-empty').hidden = mine.length > 0;
  $('#recent-transactions').classList.toggle('hidden', mine.length === 0);
}

function txRow(t, compact = false) {
  const mine = t.sender_id === state.user?.id;
  const dir = mine ? '→' : '←';
  const who = mine ? t.receiver_username : t.sender_username;
  const sign = mine ? '−' : '+';
  const cls = mine ? 'out' : 'in';
  const desc = t.description ? esc(t.description) : '<span class="muted">—</span>';
  if (compact) {
    return `<tr>
      <td class="nowrap">${fmtDate(t.created_at)}</td>
      <td class="nowrap">${dir} <strong>${esc(who)}</strong></td>
      <td>${desc}</td>
      <td class="right nowrap ${cls}">${sign} ${money(t.amount)}</td>
    </tr>`;
  }
  return `<tr>
    <td class="nowrap">${fmtDate(t.created_at)}</td>
    <td><span class="badge ${cls}">${mine ? 'Enviada' : 'Recebida'}</span></td>
    <td class="nowrap">${esc(t.sender_username)} → <strong>${esc(t.receiver_username)}</strong></td>
    <td>${desc}</td>
    <td class="right nowrap ${cls}">${sign} ${money(t.amount)}</td>
  </tr>`;
}

/* ── Transferir ──────────────────────────────────────────── */
async function prepareTransfer() {
  await refreshUser();
  $('#transfer-balance-hint').textContent = `Seu saldo: ${money(state.user?.balance)}`;
  showError('#transfer-error', '');
}

function bindTransfer() {
  $('#transfer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('#transfer-error', '');

    const receiver = $('#transfer-receiver').value.trim();
    const amount = Number($('#transfer-amount').value);
    const description = $('#transfer-description').value.trim();

    if (!receiver) return showError('#transfer-error', 'Informe o username de quem vai receber.');
    if (!Number.isFinite(amount) || amount <= 0)
      return showError('#transfer-error', 'Informe um valor maior que zero.');
    if (receiver === state.user?.username)
      return showError('#transfer-error', 'Não é possível transferir para si mesmo.');
    if (amount > Number(state.user?.balance ?? 0))
      return showError('#transfer-error', 'Saldo insuficiente para esta transferência.');

    const btn = $('#transfer-btn');
    busy(btn, true, 'Transferindo…');
    try {
      const data = await api('/transactions/create', {
        method: 'POST',
        body: { receiver_username: receiver, amount, description: description || undefined },
      });
      toast(`Transferência de ${money(data.transaction.amount)} para ${receiver} realizada!`);
      $('#transfer-receiver').value = '';
      $('#transfer-amount').value = '';
      $('#transfer-description').value = '';
      await refreshUser();
      location.hash = '#/transacoes';
      route();
    } catch (err) {
      showError('#transfer-error', err.message);
    } finally {
      busy(btn, false);
    }
  });
}

/* ── Transações ───────────────────────────────────────────── */
async function loadTransactions() {
  try {
    const data = await api('/transactions');
    state.transactions = data.transactions || [];
  } catch {
    state.transactions = [];
  }
  renderTransactions();
}

function renderTransactions() {
  const uid = state.user?.id;
  let list = state.transactions;
  if (state.filter === 'sent') list = list.filter((t) => t.sender_id === uid);
  if (state.filter === 'received') list = list.filter((t) => t.sender_id !== uid);

  const tbody = $('#transactions-table tbody');
  tbody.innerHTML = list.map((t) => txRow(t)).join('');
  $('#transactions-empty').hidden = list.length > 0;
  $('#transactions-table').classList.toggle('hidden', list.length === 0);
}

function bindFilters() {
  $$('#filter-group .chip').forEach((chip) =>
    chip.addEventListener('click', () => {
      $$('#filter-group .chip').forEach((c) => c.classList.toggle('active', c === chip));
      state.filter = chip.dataset.filter;
      renderTransactions();
    })
  );
}

/* ── Perfil ──────────────────────────────────────────────── */
async function loadProfile() {
  const u = state.user ?? {};
  $('#profile-avatar').textContent = initials(u.name);
  $('#profile-name').textContent = u.name ?? '—';
  $('#profile-email').textContent = u.email ?? '—';
  $('#profile-username').textContent = u.username ?? '—';
  $('#profile-role').textContent = u.role === 'admin' ? 'Administrador' : 'Usuário';
  $('#profile-cpf').textContent = u.cpf || '—';
  $('#profile-balance').textContent = money(u.balance);
  $('#profile-created').textContent = fmtDate(u.created_at);
  $('#profile-form-name').value = u.name ?? '';
  $('#profile-form-cpf').value = u.cpf ?? '';
}

function bindProfile() {
  $('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('#profile-error', '');
    const btn = e.submitter ?? $('#profile-form button[type="submit"]');
    busy(btn, true, 'Salvando…');
    try {
      const data = await api('/users/profile', {
        method: 'PATCH',
        body: {
          name: $('#profile-form-name').value.trim(),
          cpf: $('#profile-form-cpf').value.trim() || undefined,
        },
      });
      state.user = { ...state.user, ...data.user };
      localStorage.setItem(USER_KEY, JSON.stringify(state.user));
      paintUser();
      loadProfile();
      toast('Perfil atualizado com sucesso!');
    } catch (err) {
      showError('#profile-error', err.message);
    } finally {
      busy(btn, false);
    }
  });
}

/* ── Admin: usuários ─────────────────────────────────────── */
async function loadUsers() {
  try {
    const data = await api('/users');
    const tbody = $('#users-table tbody');
    tbody.innerHTML = (data.users || []).map((u) => `<tr>
      <td><span class="avatar small">${initials(u.name)}</span> <strong>${esc(u.username)}</strong></td>
      <td>${esc(u.name)}</td>
      <td class="muted">${esc(u.email)}</td>
      <td><span class="badge ${u.role === 'admin' ? 'admin' : ''}">${u.role === 'admin' ? 'Admin' : 'Usuário'}</span></td>
      <td class="right nowrap">${money(u.balance)}</td>
      <td class="nowrap muted">${fmtDate(u.created_at)}</td>
    </tr>`).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ── Boot ─────────────────────────────────────────────────── */
bindAuth();
bindTransfer();
bindFilters();
bindProfile();
window.addEventListener('hashchange', route);

if (state.token) {
  refreshUser().then(loadDashboard).catch(() => {});
  route();
} else {
  route();
}
