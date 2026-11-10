# ExtAT Platform (Backend)

Plataforma de pagamentos/transferências P2P — **resgatada e funcional**.

- **Runtime:** Deno 2 (com Express, bcryptjs e jsonwebtoken via npm — sem Node.js necessário)
- **Banco:** SQLite embutido (`node:sqlite`) — sem Docker/PostgreSQL, dados em `data/extat.db`
- **Linguagem:** TypeScript, modo `strict`, checagem 100% limpa (`deno task check`)

## 🚀 Como executar (executável)

O comando `extat` está instalado no PATH do usuário (`~/.local/bin/extat` → symlink
para `iniciar-extat.sh` deste projeto):

```bash
extat            # inicia o servidor (instala deps e cria o banco na 1ª execução)
extat dev        # modo desenvolvimento (reinicia a cada alteração de arquivo)
extat stop       # finaliza o servidor
extat status     # verifica se está ativo + health check
```

Alternativa, direto na pasta do projeto (`/home/ric_b/extat_plataform`):

```bash
./iniciar-extat.sh          # mesmos comandos
deno task start             # direto pelo Deno
```

Na primeira execução o lançador:
1. cria `.env` a partir de `.env.example` (com JWT_SECRET gerado automaticamente),
2. instala as dependências (`deno install`),
3. cria o banco SQLite com dados de demonstração (`deno task seed`).

## 👤 Contas de demonstração

| Email               | Senha     | Papel  | Saldo inicial |
|---------------------|-----------|--------|---------------|
| admin@extat.local   | Admin@123 | admin  | R$ 1.000,00   |
| maria@extat.local   | Maria@123 | user   | R$ 500,00     |
| joao@extat.local    | Joao@123  | user   | R$ 250,00     |

## 📡 Endpoints

| Método | Endpoint              | Descrição                     | Autenticação |
|--------|-----------------------|-------------------------------|--------------|
| GET    | /                     | Visão geral da API            | Não          |
| GET    | /health               | Health check                  | Não          |
| POST   | /auth/register        | Criar conta                   | Não          |
| POST   | /auth/login           | Login (retorna JWT)           | Não          |
| GET    | /users/profile        | Meu perfil (com saldo)        | Sim          |
| PATCH  | /users/profile        | Atualizar nome/CPF            | Sim          |
| GET    | /users                | Listar usuários               | Admin        |
| GET    | /users/:id            | Buscar usuário por ID         | Sim          |
| GET    | /transactions         | Minhas transações             | Sim          |
| POST   | /transactions/create  | Nova transferência P2P         | Sim          |

Exemplo de transferência:

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"maria@extat.local","password":"Maria@123"}' \
  | deno eval "console.log(JSON.parse(await new Response(Deno.stdin.readable).text()).token)")

curl -X POST http://localhost:3001/transactions/create \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"receiver_username":"joao","amount":150.50,"description":"pagamento"}'
```

## 📁 Estrutura do Projeto

```
iniciar-extat.sh      # executável / lançador (instalado como `extat` no PATH)
src/
├── index.ts          # Entry point (Express + middlewares)
├── config/           # env.ts (.env + validação) e database.ts (SQLite)
├── middleware/       # auth JWT, rate limit, validação, segurança, erros
├── routes/           # auth, users, transactions (+ barrel index.ts)
├── services/         # lógica de negócio (auth, transações, usuários)
└── utils/            # logger
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

O projeto original foi desenvolvido para Node.js + PostgreSQL (docker-compose) e
estava incompleto: imports de módulos inexistentes (module-alias, helmet,
compression, express-rate-limit, dotenv), arquivos de rotas duplicados e
bugs de compilação. Foi resgatado do diretório de trabalho do LM Studio e
portado para a pilha disponível nesta máquina (Deno + SQLite):

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
