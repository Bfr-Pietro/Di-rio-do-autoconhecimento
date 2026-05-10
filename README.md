# Diário do Autoconhecimento

Aplicação React com Firebase Auth + Firestore e Gemini AI.

## Como fazer deploy na Vercel

### Opção 1 — Via GitHub (recomendado)

1. Faça upload desta pasta no GitHub como um repositório
2. Acesse [vercel.com](https://vercel.com) e clique em **Add New Project**
3. Importe o repositório do GitHub
4. A Vercel detecta automaticamente que é um projeto **Vite**
5. Clique em **Deploy** — pronto!

### Opção 2 — Via Vercel CLI

```bash
npm install -g vercel
cd diario-autoconhecimento
npm install
vercel
```

### Opção 3 — Upload direto pelo site da Vercel

1. Rode `npm install && npm run build` localmente
2. Faça upload da pasta `dist/` no site da Vercel

## Estrutura do projeto

```
diario-autoconhecimento/
├── index.html          # Entry point HTML
├── package.json        # Dependências
├── vite.config.js      # Configuração do Vite
├── vercel.json         # Configuração de rotas SPA
├── public/
│   └── favicon.svg
└── src/
    ├── main.jsx        # Entry point React
    └── App.jsx         # Todo o código da aplicação
```

## Desenvolvimento local

```bash
npm install
npm run dev
```
