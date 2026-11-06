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

O produto não exige conexão com iNEWS ou outro sistema editorial externo. A importação de roteiro é feita por arquivo JSON. Na tela **Apresentador (Teleprompter)**, inicie **Acompanhamento pela fala** para exibir a transcrição e comparar os trechos reconhecidos ao roteiro. O microfone permanece ligado enquanto o reconhecimento envia segmentos de até cerca de 5 segundos, além de processar pausas curtas; assim o ponto pode ser acompanhado sem parar a captura. O faster-whisper local não fornece transcrição palavra a palavra, então pode haver atraso de alguns segundos por segmento. A interface indica acompanhamento, possível omissão (salto de várias palavras), repetição de um trecho já lido, retomada em página anterior e fala sem correspondência (possível improviso). Ao identificar continuação em outra página ou correspondência forte com outra matéria, ajusta a página ou seleciona a matéria correspondente. Essas indicações são heurísticas e podem errar por causa do reconhecimento de voz ou de frases semelhantes; não são uma classificação editorial definitiva. Arquivos e fala ao vivo são transcritos localmente no backend com faster-whisper, sem chave de API; o primeiro uso baixa o modelo configurado no backend. Também é possível gravar uma fala ou selecionar um arquivo de até 25 MB para transcrição, revisar o texto e aplicá-lo à página atual. A gravação e o acompanhamento ao vivo exigem permissão do microfone e HTTPS ou `localhost`; os controles manuais continuam disponíveis.

## Validar

```bash
npm run build
```

As preferências visuais incluem tipografia, tamanho, cores e alto contraste; são sincronizadas para os outros clientes da sessão.
