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

- A aba **Operação ao vivo** controla matéria, página, pausa/retomada, avanço/retorno, velocidade e tamanho do texto.
- A aba **Teleprompter** apresenta o roteiro correspondente. Comandos enviados por qualquer tela são transmitidos via WebSocket para os clientes conectados à mesma sessão.
- A interface tenta reconectar ao backend quando a conexão cai. O estado persistido é carregado ao reconectar.
- A aba **Preparar a operação** valida e mostra uma prévia do JSON antes de importar. O formato aceito é um array de matérias ou um objeto `{ "stories": [...] }`, seguindo o esquema de `src/data/stories.json`. A ordem, os títulos, as páginas e os metadados editoriais são mantidos.

## iNEWS

A tela informa explicitamente que a conexão direta com iNEWS ainda não está configurada. Não existem detalhes do endpoint, versão, protocolo de autenticação nem acesso ao servidor da redação neste projeto. Até que a equipe responsável forneça a interface autorizada e um exemplo de exportação, use a importação JSON; ela não representa uma conexão nem autenticação iNEWS.

## Validar

```bash
npm run build
```

## Funcionalidades demonstrativas

Captura de áudio, transcrição de voz e registros de improviso continuam sendo exemplos. As preferências visuais incluem tipografia, tamanho, cores e alto contraste; são sincronizadas para os outros clientes da sessão.
