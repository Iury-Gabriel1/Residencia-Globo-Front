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
