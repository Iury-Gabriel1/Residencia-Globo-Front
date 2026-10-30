# Teleprompter — interface do operador e apresentador

Protótipo em React, TypeScript e Vite com sincronização de operação pelo backend FastAPI.

## Executar localmente

Em um terminal, inicie o backend conforme [instruções do backend](../Residencia-Globo-Back/README.md). Para execução rápida sem PostgreSQL, o backend usa SQLite local:

```bash
cd ../Residencia-Globo-Back
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Em outro terminal:

```bash
npm install
npm run dev
```

Por padrão, o front se conecta a `http://localhost:8000` e à sessão `demo`. Configure outro endereço da API em `.env.local`:

```env
VITE_API_URL=http://IP-DO-SERVIDOR:8000
```

Use o mesmo identificador de sessão nas duas telas, por exemplo `http://localhost:5173/?session=estudio-a`. As preferências e o roteiro operacional ficam persistidos por sessão no banco do backend.

## Fluxo de operação

- A aba **Editor de roteiro** permite editar a chamada, a retranca e os textos da página. Use **Marca-texto** para ênfase e **Sublinhar nota coberta** para marcar trechos editoriais; a marcação azul diferencia a nota coberta do destaque amarelo.
- Alterações de texto e formatação são salvas na sessão e propagadas pelo WebSocket. O ponto da rolagem também é sincronizado entre as telas do TP.
- A aba **Operação ao vivo** controla matéria, página, pausa/retomada, avanço/retorno, velocidade e tamanho do texto.
- A aba **Teleprompter** apresenta a mesma matéria, página, formatação e ponto de rolagem. Espaço pausa/retoma; setas esquerda/direita navegam páginas; setas cima/baixo avançam ou retornam manualmente no texto.
- A rolagem começa pausada. O apresentador ou operador pode assumir o controle manual; se o backend desconectar, as alterações continuam locais e são enviadas quando a sessão reconectar.
- A aba **Preparar a operação** valida e mostra uma prévia do JSON antes de importar. O formato aceito é um array de matérias ou um objeto `{ "stories": [...] }`, seguindo o esquema de `src/data/stories.json`. A ordem, os títulos, as páginas e os metadados editoriais são mantidos.

## Escopo

O produto não exige conexão com iNEWS ou outro sistema editorial externo. A importação de roteiro é feita por arquivo JSON. Captura de áudio e acompanhamento automático por reconhecimento de fala ainda não estão implementados; a operação manual continua disponível sem esses recursos.

## Validar

```bash
npm run build
```

As preferências visuais incluem tipografia, tamanho, cores e alto contraste; são sincronizadas para os outros clientes da sessão.
