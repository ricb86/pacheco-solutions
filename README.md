# ExtAT Platform (Backend)

Plataforma de pagamentos com Node.js, TypeScript e Postgres.

## 🚀 Setup

### 1. Iniciar banco de dados
```bash
docker compose up -d postgres
```

### 2. Instalar dependências
```bash
npm install
```

### 3. Variáveis de ambiente
Crie um arquivo `.env`:
```
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=password
DB_NAME=extat_platform
JWT_SECRET=sua-chave-secreta-aqui
```

### 4. Rodar o servidor
```bash
npm run dev
```

## 📁 Estrutura do Projeto

```
src/
├── index.ts          # Entry point
├── config/           # Configurações
├── middleware/       # Middlewares (auth, validation)
├── routes/           # Rotas HTTP
└── services/         # Lógica de negócio
```

## 🔧 Tecnologias

- **Node.js** + TypeScript
- **Express** (HTTP server)
- **Postgres** (banco de dados)
- **Docker Compose** (infraestrutura)

## 📡 Endpoints

| Método | Endpoint            | Descrição         | Autenticação |
|--------|---------------------|-------------------|--------------|
| POST   | /auth/register      | Criar conta       | Não          |
| POST   | /auth/login         | Login             | Não          |
| GET    | /transactions       | Listar transações | Sim          |
| POST   | /transactions/create| Nova transação    | Sim          |
| GET    | /users/:id          | Perfil do usuário | Sim          |
