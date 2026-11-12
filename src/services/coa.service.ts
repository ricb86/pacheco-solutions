/**
 * PACHECO SOLUTIONS — Serviço do plano de contas (módulo financeiro EXTAT)
 *
 * Contas contábeis hierárquicas por empresa (receita, despesa, ativo,
 * passivo, patrimônio líquido). O código é opcional: ausente, é gerado
 * automaticamente a partir da hierarquia (convenção EXTAT/BR:
 * 1=Ativo, 2=Passivo, 3=Receita, 4=Despesa, 5=Patrimônio Líquido).
 *
 * `is_title` é derivado na leitura: conta com subcontas é um título
 * (não deve receber lançamentos diretamente).
 */

import type { Response } from 'express';
import { query } from '../config/database.ts';
import type { CompanyRequest } from '../middleware/company.middleware.ts';
import { canEdit } from '../middleware/company.middleware.ts';
import { textOrNull } from '../utils/finance.ts';

export const COA_TYPES = [
  'receita',
  'despesa',
  'ativo',
  'passivo',
  'patrimonio_liquido',
] as const;

const TYPE_PREFIX: Record<string, string> = {
  ativo: '1',
  passivo: '2',
  receita: '3',
  despesa: '4',
  patrimonio_liquido: '5',
};

const COA_LABELS: Record<string, string> = {
  receita: 'Receita',
  despesa: 'Despesa',
  ativo: 'Ativo',
  passivo: 'Passivo',
  patrimonio_liquido: 'Patrimônio Líquido',
};

export const coaTypeLabel = (type: string): string =>
  COA_LABELS[type] ?? type;

interface CoaRow {
  id: number;
  company_id: string;
  code: string | null;
  label: string;
  type: string;
  parent_id: number | null;
  description: string | null;
  active: number;
  is_default: number;
  created_at: string;
  updated_at: string;
}

interface CoaNode extends CoaRow {
  children: CoaNode[];
  is_title: number;
}

/** Verifica se um código já existe na empresa. */
function codeExists(companyId: string, code: string): boolean {
  const found = query(
    `SELECT 1 FROM chart_of_accounts WHERE company_id = $1 AND code = $2`,
    [companyId, code],
  );
  return found.rows.length > 0;
}

/** Gera o próximo código disponível para uma nova conta. */
function generateCode(
  companyId: string,
  type: string,
  parentId: number | null,
): string | null {
  if (parentId !== null) {
    const parent = query(
      `SELECT code FROM chart_of_accounts WHERE id = $1 AND company_id = $2`,
      [parentId, companyId],
    );
    const base = parent.rows.length
      ? String((parent.rows[0] as Record<string, unknown>).code ?? '')
      : '';
    if (base) {
      let n = 1;
      while (codeExists(companyId, `${base}.${pad(n)}`)) n++;
      return `${base}.${pad(n)}`;
    }
  }
  const prefix = TYPE_PREFIX[type] ?? '9';
  let n = 1;
  while (codeExists(companyId, `${prefix}.${pad(n)}`)) n++;
  return `${prefix}.${pad(n)}`;
}

/** Subníveis com 2 dígitos (4.4.01, 4.4.02, …) — padrão contábil BR. */
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Monta a árvore hierárquica (filhos embutidos, ordenados por código). */
function buildTree(rows: CoaRow[]): CoaNode[] {
  const byId = new Map<number, CoaNode>();
  for (const row of rows) {
    byId.set(Number(row.id), { ...row, children: [], is_title: 0 });
  }
  const roots: CoaNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.parent_id === null ? null : Number(node.parent_id);
    const parent = parentId !== null ? byId.get(parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortByCode = (a: CoaNode, b: CoaNode) =>
    String(a.code ?? 'zzz').localeCompare(String(b.code ?? 'zzz'), 'pt-BR', {
      numeric: true,
    });
  for (const node of byId.values()) {
    node.children.sort(sortByCode);
    node.is_title = node.children.length > 0 ? 1 : 0;
  }
  return roots.sort(sortByCode);
}

/** Carrega as contas da empresa e devolve a árvore + mapa por id. */
function loadCompanyCoa(companyId: string, onlyActive = false) {
  const result = query<CoaRow>(
    `SELECT * FROM chart_of_accounts
      WHERE company_id = $1${onlyActive ? ' AND active = 1' : ''}
      ORDER BY code IS NULL, code, id`,
    [companyId],
  );
  const byId = new Map<number, CoaRow>();
  for (const row of result.rows) byId.set(Number(row.id), row);
  return { rows: result.rows, byId, tree: buildTree(result.rows) };
}

/** Caminho legível: "Receitas › Vendas › Produtos". */
function pathOf(row: CoaRow, byId: Map<number, CoaRow>): string {
  const parts: string[] = [row.label];
  let current = row;
  const seen = new Set<number>([Number(row.id)]);
  while (current.parent_id !== null && !seen.has(Number(current.parent_id))) {
    const parent = byId.get(Number(current.parent_id));
    if (!parent) break;
    parts.unshift(parent.label);
    seen.add(Number(parent.id));
    current = parent;
  }
  return parts.join(' › ');
}

/* ── Árvore completa ────────────────────────────────────── */

export const listCoa = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    const { tree } = loadCompanyCoa(req.company!.id);
    res.json({ accounts: tree });
  } catch (error) {
    console.error('Erro ao listar plano de contas:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

/* ── Lista plana por tipo (para campos de seleção) ─────── */

export const listCoaByType = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    const type = String(req.params.type);
    if (!COA_TYPES.includes(type as (typeof COA_TYPES)[number])) {
      res.status(400).json({
        error: `type inválido. Use: ${COA_TYPES.join(', ')}.`,
      });
      return;
    }
    const { rows, byId, tree } = loadCompanyCoa(req.company!.id);
    const hasChildren = new Set<number>();
    for (const node of tree) collectIds(node, hasChildren);

    const accounts = rows
      .filter((r) => r.type === type && Number(r.active) === 1)
      .map((r) => ({
        id: r.id,
        code: r.code,
        label: r.label,
        type: r.type,
        parent_id: r.parent_id,
        active: r.active,
        path: pathOf(r, byId),
        is_title: hasChildren.has(Number(r.id)) ? 1 : 0,
      }))
      .sort((a, b) =>
        String(a.code ?? 'zzz').localeCompare(
          String(b.code ?? 'zzz'),
          'pt-BR',
          { numeric: true },
        ),
      );

    res.json({ accounts });
  } catch (error) {
    console.error('Erro ao listar contas por tipo:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

function collectIds(node: CoaNode, ids: Set<number>): void {
  if (node.children.length > 0) {
    ids.add(Number(node.id));
    for (const child of node.children) collectIds(child, ids);
  }
}

/* ── CRUD ───────────────────────────────────────────────── */

export const createCoa = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canEdit(req.company!.role)) {
      res.status(403).json({ error: 'Sem permissão para editar esta empresa.' });
      return;
    }

    const body = req.body ?? {};
    const label = textOrNull(body.label);
    const type = textOrNull(body.type);
    if (!label || !type) {
      res.status(400).json({ error: 'label e type são obrigatórios.' });
      return;
    }
    if (!COA_TYPES.includes(type as (typeof COA_TYPES)[number])) {
      res.status(400).json({
        error: `type inválido. Use: ${COA_TYPES.join(', ')}.`,
      });
      return;
    }

    // Conta pai: precisa existir, ser da empresa e do MESMO tipo
    let parentId: number | null = null;
    if (body.parent_id !== undefined && body.parent_id !== null &&
      String(body.parent_id) !== ''
    ) {
      parentId = Number(body.parent_id);
      const parent = query(
        `SELECT id, type FROM chart_of_accounts WHERE id = $1 AND company_id = $2`,
        [parentId, req.company!.id],
      );
      if (!parent.rows.length) {
        res.status(422).json({ error: 'Conta pai inexistente nesta empresa.' });
        return;
      }
      if (String((parent.rows[0] as Record<string, unknown>).type) !== type) {
        res.status(422).json({
          error: 'A conta pai deve ser do mesmo tipo da nova conta.',
        });
        return;
      }
    }

    // Código: informado ou gerado; único dentro da empresa
    let code = textOrNull(body.code);
    if (code) {
      if (codeExists(req.company!.id, code)) {
        res.status(409).json({
          error: `O código "${code}" já existe no plano de contas desta empresa.`,
        });
        return;
      }
    } else {
      code = generateCode(req.company!.id, type, parentId);
    }

    const created = query(
      `INSERT INTO chart_of_accounts
         (company_id, code, label, type, parent_id, description, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        req.company!.id,
        code,
        label,
        type,
        parentId,
        textOrNull(body.description),
        body.active === false ? 0 : 1,
      ],
    );

    res.status(201).json({
      message: 'Conta criada com sucesso!',
      account: created.rows[0],
    });
  } catch (error) {
    console.error('Erro ao criar conta do plano:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const getCoa = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    const { byId, tree } = loadCompanyCoa(req.company!.id);
    const id = Number(req.params.id);
    const row = byId.get(id);
    if (!row) {
      res.status(404).json({ error: 'Conta não encontrada.' });
      return;
    }
    const node = findNode(tree, id);
    res.json({ account: { ...row, path: pathOf(row, byId), ...(node ?? {}) } });
  } catch (error) {
    console.error('Erro ao buscar conta:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

function findNode(tree: CoaNode[], id: number): CoaNode | null {
  for (const node of tree) {
    if (Number(node.id) === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

export const updateCoa = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canEdit(req.company!.role)) {
      res.status(403).json({ error: 'Sem permissão para editar esta empresa.' });
      return;
    }

    const id = Number(req.params.id);
    const found = query(
      `SELECT * FROM chart_of_accounts WHERE id = $1 AND company_id = $2`,
      [id, req.company!.id],
    );
    if (!found.rows.length) {
      res.status(404).json({ error: 'Conta não encontrada.' });
      return;
    }

    const body = req.body ?? {};
    const label = textOrNull(body.label);
    const type = textOrNull(body.type);
    const code = textOrNull(body.code);
    const description = textOrNull(body.description);

    if (type && !COA_TYPES.includes(type as (typeof COA_TYPES)[number])) {
      res.status(400).json({
        error: `type inválido. Use: ${COA_TYPES.join(', ')}.`,
      });
      return;
    }
    if (code && codeExists(req.company!.id, code)) {
      const currentCode = String(
        (found.rows[0] as Record<string, unknown>).code ?? '',
      );
      if (code !== currentCode) {
        res.status(409).json({
          error: `O código "${code}" já existe no plano de contas desta empresa.`,
        });
        return;
      }
    }

    const updated = query(
      `UPDATE chart_of_accounts SET
         label = COALESCE($1, label),
         type = COALESCE($2, type),
         code = COALESCE($3, code),
         description = COALESCE($4, description),
         active = COALESCE($5, active),
         updated_at = datetime('now')
       WHERE id = $6 AND company_id = $7
       RETURNING *`,
      [
        label,
        type,
        code,
        description,
        typeof body.active === 'boolean' ? Number(body.active) : null,
        id,
        req.company!.id,
      ],
    );

    res.json({
      message: 'Conta atualizada com sucesso!',
      account: updated.rows[0],
    });
  } catch (error) {
    console.error('Erro ao atualizar conta:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const deleteCoa = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canEdit(req.company!.role)) {
      res.status(403).json({ error: 'Sem permissão para editar esta empresa.' });
      return;
    }

    const id = Number(req.params.id);
    const found = query(
      `SELECT * FROM chart_of_accounts WHERE id = $1 AND company_id = $2`,
      [id, req.company!.id],
    );
    if (!found.rows.length) {
      res.status(404).json({ error: 'Conta não encontrada.' });
      return;
    }

    const children = query(
      `SELECT COUNT(*) AS total FROM chart_of_accounts WHERE parent_id = $1`,
      [id],
    );
    if (Number((children.rows[0] as Record<string, unknown>).total) > 0) {
      res.status(409).json({
        error:
          'Esta conta possui subcontas e não pode ser excluída. Exclua ou mova as subcontas primeiro.',
      });
      return;
    }

    const usage = query(
      `SELECT COUNT(*) AS total FROM financial_transactions WHERE coa_id = $1`,
      [id],
    );
    if (Number((usage.rows[0] as Record<string, unknown>).total) > 0) {
      res.status(409).json({
        error:
          'Esta conta é usada por movimentações e não pode ser excluída (integridade histórica). Desative-a se quiser tirá-la de uso.',
      });
      return;
    }

    query(
      `DELETE FROM chart_of_accounts WHERE id = $1 AND company_id = $2`,
      [id, req.company!.id],
    );
    res.json({ message: 'Conta excluída com sucesso!' });
  } catch (error) {
    console.error('Erro ao excluir conta:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};
