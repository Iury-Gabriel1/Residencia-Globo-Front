# Changelog

## [0.2.0] - 2026-10-16

### Adicionado

- Interface de demonstração para operação de teleprompter, com telas de conexão iNEWS, operação ao vivo, improvisos, leitura ampliada e apresentador.
- Navegação manual entre matérias e páginas, com pausa automática ao trocar de conteúdo.
- Classificação editorial de matérias e edição de orientações para o apresentador, com persistência local no navegador.
- Personalização da leitura, incluindo fonte, tamanho do texto, cores, contraste e velocidade de rolagem.
- Atalhos de teclado para controlar a leitura do apresentador.
- Roteiros e matérias de exemplo para demonstrar a interface.
- `package-lock.json` para registrar as versões resolvidas das dependências do projeto.

### Observações

- A integração real com iNEWS, a captura e transcrição de áudio, o backend e a sincronização entre dispositivos ainda não estão implementados; os dados correspondentes são demonstrativos.
- Este registro descreve o estado do projeto em 2026-10-16. Na comparação com o Git, `package-lock.json` era o único arquivo novo relacionado ao código; `dist/` e `node_modules/` também aparecem como arquivos locais não rastreados, mas são artefatos/dependências gerados. Não havia alterações pendentes nos arquivos da aplicação.

## 2026-10-22 · Arthur

### Alterado

- Inclusão e edição manual da chamada, categoria editorial, tom e nível de alerta de cada matéria, com classificação salva no navegador.
- Exibição da chamada, categoria e tom antes do texto de leitura, com destaque visual para alertas editoriais importantes.
- Prévia da próxima matéria com chamada, categoria, tom e trecho inicial, incluindo indicação de fim do espelho.
- Prévia da matéria seguinte também disponível no modo do apresentador, com chamada, categoria, tom e trecho inicial.
- Navegação manual e independente de IA, com seleção de matérias no modo do apresentador, sincronização da página, pausa/retomada e controles de avanço/retorno sem ultrapassar o roteiro.
- Ação de assumir controle manual disponível durante a leitura; operações manuais pausam a rolagem e mantêm a posição atual.
- Simplificação da hierarquia visual com monitor de voz, classificação editorial, ajustes e metadados de revisão recolhidos em seções expansíveis, sem remover informações ou ações.
- Melhorias de legibilidade, foco, espaçamento e adaptação responsiva em telas menores.
- Navegação móvel reorganizada para manter as áreas principais visíveis sem rolagem horizontal; estado atual da página identificado para tecnologias assistivas.
- Filtro de improvisos agora corresponde ao registro exibido e apresenta orientação quando não há ocorrências para a matéria.
- Alterações realizadas somente no front-end.
