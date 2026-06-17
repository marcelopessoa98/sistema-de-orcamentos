# Sistema de Orçamento SEINFRA

MVP web local em Node.js para buscar serviços da Tabela de Custos da SEINFRA, montar um orçamento e gerar PDF.

## Tecnologias

- Node.js + Express
- Scraper com Cheerio e fallback em Playwright
- SQLite para cache local dos serviços
- Frontend com HTML, CSS e JavaScript puro
- Fuse.js para busca/autocomplete inteligente
- jsPDF + jspdf-autotable para geração do PDF no backend

## Como instalar

```bash
npm install
```

## Como rodar

```bash
npm run dev
```

Depois acesse:

```text
http://localhost:3000
```

Se a porta 3000 já estiver em uso no Windows:

```bash
set PORT=3001&& npm run dev
```

Para rodar sem watch:

```bash
npm start
```

## Atualizar a base SEINFRA

Pela interface, clique em **Atualizar Base SEINFRA**.

Pelo terminal:

```bash
npm run sync
```

O scraper usa como ponto inicial:

```text
https://sin.seinfra.ce.gov.br/site-seinfra/siproce/desonerada/html/2.1.html?a=1698150683595
```

Também é possível trocar a origem e limites por variáveis de ambiente:

```bash
SEINFRA_BASE_URL="https://..." SEINFRA_MAX_PAGES=1200 SEINFRA_MAX_DEPTH=8 npm run sync
```

Por padrão, o crawler segue páginas numéricas da navegação da tabela, como `2.1.html`, e evita entrar nas páginas de composição `C5011.html`/`I...html`, porque elas não trazem novas linhas de serviço. Para varrer também essas páginas de composição:

```bash
SEINFRA_INCLUDE_COMPOSITIONS=true npm run sync
```

## Teste do scraper

```bash
npm run test:scraper
```

Esse teste verifica se a coleta encontra os serviços `C5011` e `C2779`.

## Gerar PDF

1. Pesquise um serviço.
2. Clique em **Adicionar**.
3. Informe a atividade/etapa e a quantidade.
4. Clique em **Gerar PDF**.

O arquivo é baixado como:

```text
orcamento-seinfra.pdf
```

## API

### `GET /api/health`

Retorna status da aplicação e estatísticas da base local.

### `POST /api/sync-seinfra`

Executa o scraper, atualiza o SQLite e retorna total de serviços coletados.

### `GET /api/services`

Retorna todos os serviços cadastrados.

### `GET /api/services/search?q=escavacao&unit=m3`

Retorna serviços filtrados por texto e unidade.

### `POST /api/budget/pdf`

Recebe itens do orçamento e retorna um PDF.

## Estrutura

```text
src/
  server/
    database.js       SQLite e consultas
    index.js          bootstrap Express
    normalization.js  conversões de valor, unidade e texto
    routes.js         rotas da API e PDF
    scraper.js        coleta recursiva SEINFRA
  public/
    index.html        interface
    style.css         estilos
    app.js            busca, orçamento e PDF
data/
  seinfra.sqlite      criado após a primeira sincronização
```
