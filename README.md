# PACHECO SOLUTIONS

Plataforma de pagamentos/transferências P2P — **interface web + API no mesmo
servidor** (resgatada de um projeto incompleto, corrigida e rebrandeda).

- **Runtime:** Deno 2 (com Express, bcryptjs e jsonwebtoken via npm — sem Node.js necessário)
- **Banco:** SQLite embutido (`node:sqlite`) — sem Docker/PostgreSQL, dados em `data/pacheco.db`
- **Interface:** SPA em HTML/CSS/JS puro (sem build) servida pelo próprio Express em `public/`
- **Linguagem:** TypeScript, modo `strict`, checagem 100% limpa (`deno task check`)

## 🚀 Como executar (executável)

O comando `pacheco` está instalado no PATH do usuário (`~/.local/bin/pacheco` → symlink
para `iniciar-pacheco.sh` deste projeto). O comando antigo `extat` continua
funcionando como apelido.

```bash
pacheco           # inicia o servidor e abre a interface no navegador
pacheco dev       # modo desenvolvimento (reinicia a cada alteração de arquivo)
pacheco stop      # finaliza o servidor
pacheco status    # verifica se está ativo + health check
```

Alternativa, direto na pasta do projeto (`/home/ric_b/pacheco_solutions`):

```bash
./iniciar-pacheco.sh        # mesmos comandos
deno task start             # direto pelo Deno
```

Na primeira execução o lançador:
1. cria `.env` a partir de `.env.example` (com JWT_SECRET gerado automaticamente),
2. instala as dependências (`deno install`),
3. cria o banco SQLite com dados de demonstração (`deno task seed`),
4. abre a interface web no navegador padrão (`http://localhost:3001`).

## 👤 Contas de demonstração

| Email                | Senha     | Papel  | Saldo inicial |
|----------------------|-----------|--------|---------------|
| admin@pacheco.local  | Admin@123 | admin  | R$ 1.000,00   |
| maria@pacheco.local  | Maria@123 | user   | R$ 500,00     |
| joao@pacheco.local   | Joao@123  | user   | R$ 250,00     |

## 🖥️ Interface web

Abra `http://localhost:3001` no navegador (o lançador abre automaticamente).
Tema escuro com a identidade visual PACHECO SOLUTIONS (dourado champanhe
sobre carvão, extraído do logotipo oficial), responsiva (celular e desktop),
em português.

| Tela | Descrição |
|------|-----------|
| Login / Cadastro | entrada com JWT; conta demo destacada |
| Visão geral | saldo, totais enviados/recebidos, últimas transações |
| Transferir | formulário P2P com validação (saldo, valor, destinatário) |
| Transações | histórico completo com filtros (todas / enviadas / recebidas) |
| Perfil | dados da conta e edição de nome/CPF |
| Usuários | listagem de contas (visível apenas para admin) |
| Movimentações | contas a pagar e a receber com filtros, detalhe e livro-caixa |
| Contas a pagar / receber | visões por status com totais (vencido, vence hoje, a vencer, pago parcial) |
| Painel | saldo em contas, pendências em aberto, resultado do mês, tendência de 6 meses e maiores despesas |
| DRE | receitas e despesas por conta contábil (regime de competência), margem e resultado mês a mês |
| Fluxo de caixa | entradas/saídas realizadas (regime de caixa), saldo acumulado e saldo por conta |
| Empresa → Informações | dados cadastrais da empresa e gestão de membros (adicionar, papel e remover) |
| Empresa → Plano de contas | árvore de contas (ativo/passivo/receita/despesa/PL) com subcontas |
| Empresa → Contas bancárias | contas com saldo inicial, saldo atual derivado e transferências entre contas |
| Empresa → Centros de custo / Fornecedores | cadastros auxiliares do financeiro |
| Carteira | transferências P2P entre usuários da plataforma |

A empresa ativa é escolhida no seletor do menu e enviada em todo request
financeiro pelo header `x-company-id`.

Sessão mantida no `localStorage` (token JWT); expiração tratada com logout
automático. Sem build, sem frameworks — HTML/CSS/JS puro em `public/`.

## 📡 Endpoints

| Método | Endpoint              | Descrição                     | Autenticação |
|--------|-----------------------|-------------------------------|--------------|
| GET    | /                     | Interface web (SPA)           | Não          |
| GET    | /api                  | Visão geral da API            | Não          |
| GET    | /health               | Health check                  | Não          |
| POST   | /auth/register        | Criar conta                   | Não          |
| POST   | /auth/login           | Login (retorna JWT)           | Não          |
| GET    | /users/profile        | Meu perfil (com saldo)        | Sim          |
| PATCH  | /users/profile        | Atualizar nome/CPF            | Sim          |
| GET    | /users                | Listar usuários               | Admin        |
| GET    | /users/:id            | Buscar usuário por ID         | Sim          |
| GET    | /transactions         | Minhas transações             | Sim          |
| POST   | /transactions/create  | Nova transferência P2P         | Sim          |

### Financeiro (Fase 1) — exigem `x-company-id` + JWT

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET/POST | `/companies` | empresas do usuário / criar empresa |
| GET/PATCH/DELETE | `/companies/:id` | dados cadastrais (+ `/:id/members`) |
| GET/POST | `/bank-accounts` | contas bancárias (saldo atual derivado) |
| PATCH/DELETE | `/bank-accounts/:id` | editar / excluir (bloqueia se houver uso) |
| GET/POST | `/companies/coa` | plano de contas (árvore por tipo) |
| PATCH/DELETE | `/companies/coa/:id` | editar / excluir (409 se em uso) |
| GET/POST | `/cost-centers` | centros de custo |
| GET/POST | `/suppliers` | fornecedores |
| GET | `/companies/transactions` | movimentações com filtros, busca e paginação |
| POST | `/companies/transactions` | criar movimentação (valor em centavos) |
| GET/PATCH/DELETE | `/companies/transactions/:id` | detalhe / editar / excluir (`confirm:true`) |
| POST | `/companies/transactions/:id/pay` | registrar pagamento (idempotente) |
| POST | `/companies/transactions/:id/payments/:paymentId/reverse` | estornar pagamento (linha negativa no livro-caixa) |

Regras principais: valores em **centavos** (`INTEGER`), status **derivado**
(pago > vencido > vence hoje > pago parcial > a vencer), pagamento exige
`reason` quando há pagamento prévio, e exclusões com uso retornam **409**.

### Financeiro (Fase 2) — relatórios, transferências e membros

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/companies/reports/dashboard` | painel: saldo em contas, pendências em aberto, resultado do mês, tendência (6 meses) e maiores despesas |
| GET | `/companies/reports/dre?start_month=AAAA-MM&end_month=AAAA-MM` | DRE por conta contábil (regime de competência), com margem e resultado mês a mês |
| GET | `/companies/reports/cash-flow?start_month=AAAA-MM&end_month=AAAA-MM` | fluxo de caixa realizado (regime de caixa), saldo inicial/acumulado e saldo por conta |
| GET/POST | `/bank-transfers` | listar / criar transferência entre contas da mesma empresa |
| DELETE | `/bank-transfers/:id` | excluir transferência (saldos recalculados) |
| GET/POST | `/companies/:id/members` | listar membros / adicionar usuário cadastrado por email |
| PATCH | `/companies/:id/members/:userId` | alterar papel (`admin`, `member`, `viewer`) — apenas o proprietário |
| DELETE | `/companies/:id/members/:userId` | remover membro — proprietário ou admin (o owner nunca é removido) |

Regras principais: as respostas de relatórios usam **reais** (os valores são
convertidos na borda); o **DRE** considera a competência e o **fluxo de caixa**
considera pagamentos/estornos realizados; **transferências entre contas** não
alteram receita/despesa nem o saldo total, apenas o saldo de cada conta; a
gestão de membros exige vínculo com a empresa (um usuário só é adicionado se
já tiver conta na plataforma).

Exemplo de relatório:

```bash
curl "http://localhost:3001/companies/reports/dre?start_month=2026-11&end_month=2026-11" \
  -H "Authorization: Bearer $TOKEN" -H "x-company-id: $COMPANY_ID"
```

Exemplo de transferência entre contas:

```bash
curl -X POST http://localhost:3001/bank-transfers \
  -H "Authorization: Bearer $TOKEN" -H "x-company-id: $COMPANY_ID" \
  -H 'Content-Type: application/json' \
  -d '{"from_account_id":"<origem>","to_account_id":"<destino>","amount":2000,"transfer_date":"2026-11-05","description":"Aporte"}'
```

Exemplo de transferência:

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"maria@pacheco.local","password":"Maria@123"}' \
  | deno eval "console.log(JSON.parse(await new Response(Deno.stdin.readable).text()).token)")

curl -X POST http://localhost:3001/transactions/create \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"receiver_username":"joao","amount":150.50,"description":"pagamento"}'
```

## 📁 Estrutura do Projeto

```
iniciar-pacheco.sh    # executável / lançador (instalado como `pacheco` no PATH)
public/               # interface web (servida na raiz — sem build)
├── index.html        # SPA com hash routing (#/visao-geral, #/transferir…)
├── app.js            # cliente da API + lógica das telas
├── finance.js        # módulo financeiro (movimentações, empresa, cadastros)
├── style.css         # tema visual (carvão + dourado, responsivo)
└── logo.jpg          # logotipo oficial (otimizado p/ web)
src/
├── index.ts          # Entry point (Express + static + middlewares)
├── config/           # env.ts (.env + validação) e database.ts (SQLite)
├── middleware/       # auth JWT, empresa ativa (x-company-id), rate limit…
├── routes/           # auth, users, transactions, companies, coa, bank-accounts…
├── services/         # lógica de negócio (inclui o núcleo financeiro)
└── utils/            # logger, dinheiro/status financeiros
scripts/
├── seed.ts           # dados de demonstração (deno task seed)
└── security-check.ts # verificação de segurança (deno task security:check)
schema.sql            # schema SQLite (documentação; aplicado no boot)
legacy/               # arquivos da pilha original (Node/Postgres/Docker)
```

## 🔧 Comandos

| Comando                    | Descrição                                  |
|----------------------------|--------------------------------------------|
| `deno task start`          | inicia o servidor                          |
| `deno task dev`            | modo watch                                 |
| `deno task seed`           | cria/atualiza dados de demonstração        |
| `deno task check`          | checagem de tipos (TypeScript strict)      |
| `deno task security:check` | varredura de segurança básica              |

## 🛡️ Segurança

- Senhas com bcrypt (`BCRYPT_SALT_ROUNDS` do .env)
- Autenticação JWT (segredo via `JWT_SECRET`, obrigatório — o servidor recusa iniciar sem)
- Rate limiting global + proteção extra em login/registro
- Validação de entrada (username, e-mail, senha, valor da transferência)
- Transferências atômicas (transação SQL serializada); dinheiro em **centavos** (sem erro de ponto flutuante)
- CORS restrito a origens do `.env`
- Nunca transferir para si mesmo; saldo nunca negativo (constraint do banco)

## 📜 Histórico do resgate

O projeto original ("ExtAT Platform") foi desenvolvido para Node.js + PostgreSQL
(docker-compose) e estava incompleto: imports de módulos inexistentes (module-alias,
helmet, compression, express-rate-limit, dotenv), arquivos de rotas duplicados e
bugs de compilação. Foi resgatado do diretório de trabalho do LM Studio, portado
para a pilha disponível nesta máquina (Deno + SQLite) e, posteriormente,
rebrandedo para **PACHECO SOLUTIONS** (interface, servidor, executável e
identidade visual com o logotipo oficial):

1. **Snapshot original** preservado no primeiro commit do git e em `legacy/`
2. **Bugs corrigidos** (ver cabeçalhos "Correções" nos arquivos-fonte):
   - rate limit quebrava **todas** as requisições (500) na primeira chamada de cada IP
   - `getTransactions` usava `query` sem importar
   - tipo inválido `as AuthRequest.user` (não compilava)
   - arquivos de rota duplicados com comportamentos divergentes
3. **Portado** PostgreSQL → SQLite embutido (adaptador mantém o dialeto SQL
   do código original: placeholders `$1…`, `BEGIN/COMMIT`, `RETURNING`)
   e Node/npm → Deno (o projeto continua usando os mesmos pacotes npm:
   express, bcryptjs, jsonwebtoken)
4. **Interface web** criada (SPA em `public/`) e integrada ao servidor
5. **Rebranding** para PACHECO SOLUTIONS: logotipo oficial, paleta dourada
   extraída da imagem, emails de demonstração migrados no banco
6. **Módulo financeiro (Fase 1)**: engenharia reversa do contrato do
   `app.extat.com.br` (mesmos paths, header `x-company-id`, campos
   `reference`, `competence`, `due_date`, `payment_date`, `origin`),
   reimplementado em Deno + SQLite: empresas e membros, contas bancárias,
   plano de contas hierárquico, centros de custo, fornecedores e
   movimentações com status derivado, pagamentos idempotentes e estorno
   (livro-caixa com linha negativa). Interface correspondente em
   `public/finance.js`. A carteira P2P foi mantida como módulo separado.
7. **Módulo financeiro (Fase 2)**: painel gerencial, DRE (competência),
   fluxo de caixa (caixa), transferências entre contas bancárias
   (`bank_transfers`, saldo por conta sem alterar o total) e gestão de
   membros por email com papéis (`owner`, `admin`, `member`, `viewer`).
