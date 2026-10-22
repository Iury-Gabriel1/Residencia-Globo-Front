# Teleprompter — interface do operador e apresentador

Protótipo de interface feito com React, TypeScript e Vite, baseado nas referências do Figma.

## Executar localmente

```bash
npm install
npm run dev
```

Para validar a compilação:

```bash
npm run build
```

## Interface do operador

- **Conexão iNEWS:** campos de configuração demonstrativos e prévia de importação do espelho.
- **Operação ao vivo:** lista de matérias, área de leitura, indicadores de operação e monitor de áudio demonstrativo.
- **Improvisos:** visualização do trecho transcrito de exemplo, anotação editável e ação de revisão.
- **Leitura ampliada:** texto ampliado e monitor resumido da operação.

## Interface do apresentador

Selecione a aba **Teleprompter** para abrir uma interface independente, com foco no texto, título da matéria, categoria, página atual, progresso do roteiro e controles para anterior, pausa/retomada, próxima página, velocidade de rolagem e tamanho da fonte. A rolagem automática percorre o conteúdo quando ele excede a área visível.

## Limitações atuais

Este projeto é um protótipo de front-end. A conexão iNEWS, a captura de áudio, a transcrição, a sincronização em rede entre telas e a identificação inteligente de mudanças de assunto ainda não estão implementadas. Os estados e exemplos de áudio são simulados.


## Personalização e acessibilidade

Na aba **Teleprompter**, use **Personalizar leitura** para alterar família tipográfica, tamanho do texto, cores de fundo e texto, velocidade de rolagem e tema de alto contraste. As opções de tema incluem modo noturno, claro e alto contraste. O botão **Restaurar padrão** recupera os valores iniciais.

As preferências são gravadas no `localStorage` do navegador deste dispositivo. Elas não são sincronizadas entre dispositivos nem associadas a uma conta, pois o projeto ainda não possui backend.

Atalhos de teclado na tela do apresentador: `Espaço` pausa/retoma, `←` volta uma página, `→` avança, `+`/`-` aumenta ou reduz o texto e `Esc` fecha a personalização. Os atalhos não interceptam a digitação quando o foco está em botões ou campos de formulário.


## Classificação editorial e navegação manual

Na aba **Operação ao vivo**, o operador pode editar a chamada da matéria, escolher uma categoria editorial (incluindo notícia séria, falecimento, política, previsão do tempo e conteúdo leve), definir o tom, ajustar o nível de alerta e editar a orientação para o apresentador. As alterações ficam salvas no armazenamento local do navegador. Alertas editoriais aparecem na lista do espelho e na área de leitura do apresentador.

A lista do espelho permite selecionar uma matéria manualmente; o seletor **Página atual** permite escolher uma página específica. Ao selecionar matéria ou página, a leitura é pausada para evitar saltos inesperados. Os botões Anterior, Próxima e Pausar/Retomar continuam disponíveis ao operador. Uma prévia da próxima matéria aparece no painel de classificação.

A classificação, os indicadores de conexão e os dados de áudio são demonstrativos e locais; não há integração real com iNEWS, backend ou reconhecimento de voz nesta etapa.


## Backend e comunicação em tempo real

O backend está em `backend/` e usa Python, FastAPI e WebSocket para compartilhar a página atual, a matéria selecionada, pausa/retomada, velocidade, tamanho da fonte e classificação editorial entre operador e apresentador.

### Iniciar o backend

Requer Python 3.10 ou superior.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

No Windows PowerShell, ative o ambiente com `.venv\\Scripts\\Activate.ps1`.

- Verificação de saúde: http://localhost:8000/api/health
- Documentação da API: http://localhost:8000/docs
- WebSocket: `ws://localhost:8000/ws/{session_id}`

### Iniciar o frontend

Crie um arquivo `.env.local` na raiz copiando `.env.example`. Para desenvolvimento no mesmo computador:

```dotenv
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
```

Depois execute:

```bash
npm install
npm run dev
```

Operador e apresentador devem usar o mesmo identificador de sessão na URL. Por padrão, a sessão é `demo`. Para separar sessões, acrescente o parâmetro `?session=jornal-noite` à URL em ambas as telas.

### Testar em computadores diferentes na mesma rede

1. Inicie o backend no computador servidor com `--host 0.0.0.0`.
2. Descubra o endereço IP local do servidor (por exemplo, `192.168.1.20`).
3. Configure no frontend `.env.local` com `VITE_API_URL=http://192.168.1.20:8000` e `VITE_WS_URL=ws://192.168.1.20:8000`.
4. Inicie o frontend com `npm run dev -- --host 0.0.0.0`.
5. Libere as portas 8000 e 5173 no firewall da rede, se necessário.
6. Abra o endereço Vite do computador servidor nos dois computadores, usando a mesma sessão. Teste pausa, retomada, anterior, próxima e seleção manual.

Não use `localhost` nas configurações de outro computador: ele apontaria para o próprio computador cliente. Em produção, configure HTTPS/WSS, autenticação e CORS com origens explícitas.

### Escopo e limitações atuais

- O backend mantém o estado em memória: ele é compartilhado entre clientes conectados ao mesmo processo, mas é perdido quando o servidor reinicia. Não use múltiplos workers sem trocar o armazenamento por Redis ou outro mecanismo compartilhado.
- A reconexão tenta recuperar o estado atual da sessão.
- A conexão real com iNEWS, o áudio, a transcrição e a IA para identificar mudanças de assunto continuam fora desta etapa.
- A implementação de rede foi adicionada em uma branch de funcionalidade para revisão antes de integrar à branch principal.
