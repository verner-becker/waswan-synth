# Evolução da interface do Synth e da DAW

O objetivo é tocar, editar e gravar em uma tela Full HD, aproveitar a largura disponível em ultrawide e retirar a interface Legacy SMK da distribuição após migrar suas funções. O diagnóstico de partida é o [parecer do Astra](ux-evolution-astra.md) sobre o MVP em `21bd5bc`.

Em 18/11/2026, o usuário autorizou registrar este plano, integrar o MVP à `main`, remover as branches incorporadas e iniciar a etapa 1. Cada etapa tem uma branch empilhada sobre a anterior, validação e revisão antes da próxima. Uma nova integração à `main` exige aprovação explícita.

## 1. Synth e navegação principal

- Organizar a navegação em **Synth** e **DAW**, com **Performance** e **TONES** dentro do Synth. Manter SEQ, Studio e a interface SMK acessíveis pela navegação secundária durante a migração. Retirar as telas planejadas da primeira linha. Manter os grupos implementados de osciladores, filtro, envelopes, modulação e efeitos compartilhados acessíveis em TONES.
- Usar **Settings** como entrada única para conexão MIDI, atribuições, sessão e diagnósticos. Identificar os mixers pelo alvo, partes do Synth ou projeto DAW. Oferecer uma opção explícita para usar teclado e pads no MIDI Setup.
- Compactar os medidores e a informação sobre a parte ativa. Usar um modo explícito para atribuir MIDI e mostrar pickup durante a interação. Definir o padrão dos ícones, foco, seleção, cores de estado e dicas no mouse e no teclado.
- Validar o fluxo Start audio → teclado visível e tocável → TONES → Save ou Save as, em Full HD com zoom de 100% e 125%. Confirmar atribuição explícita, soft takeover e notas mantidas ao navegar.

## 2. Arrangement e edição de clipes

- Enxugar o topo, manter transporte, posição e BPM visíveis e juntar operações de projeto em **Arquivo**. Atualizar a mensagem de acordo com o estado do áudio e da seleção. Levar marcadores à régua. Usar o editor inferior sob demanda, com grade ou waveform antes dos campos avançados.
- Ampliar os alvos M/S/R, distinguir volume e pan visualmente e aplicar a iconografia com nomes e dicas no foco. Preservar operação dos divisores por setas e atalhos por contexto. Oferecer edição por teclado para pontos de automação e preservar edição numérica, unidades e Undo.
- Validar início com projeto vazio, criação de pista e clipe, grade visível no primeiro uso, edição de notas e velocity, Undo/Redo e projeto salvo e reaberto.

## 3. Gravação e roteamento

- Transformar **Browser** em **Inspetor da pista**. Reunir origem, monitor, armação e substituição de tomada. Mostrar no transporte a pista armada, a fonte e o que será gravado. Distinguir o roteamento MIDI ao Synth e à DAW e realçar gravação ativa em vermelho com texto.
- Centralizar preferências e perfis de controladores em Settings, preservando a distinção entre porta, perfil, foco e roteamento. Manter o aprendizado por ação explícita.
- Validar tomada MIDI, captação interna do Synth, entrada física, count-in, cancelamento, Undo e recuperação. Verificar que a captação interna conserva a separação do acompanhamento e do click.

## 4. Ultrawide e novas abas

- Liberar a largura da aba DAW e corrigir os tokens de tema na janela destacada. Priorizar Mixer e Piano Roll. Oferecer inspetor ou editor lateral opcional conforme o espaço disponível. Em janelas curtas ou com zoom alto, dar acesso claro à alternância entre Arrangement e editor.
- Unificar abrir, focar, redimensionar e devolver. Restaurar foco e seleção, identificar a aba hospedeira e esclarecer onde abre o teclado do Synth. Validar contraste, zoom e layout em 2560×1080 e 3440×1440, incluindo monitores físicos quando disponíveis.
- Validar o retorno durante reprodução e gravação, posse única do áudio, posição, sustain e restauração de layout sem alterar o projeto. Fechar a aba hospedeira encerra a sessão conforme o contrato atual.

## 5. Retirada da interface Legacy SMK

- Inventariar e migrar o acesso às funções que ainda dependem do painel original. Incluir DRUM-X e pads, SUPER MIX, seleção e mixagem das partes A–D, quatro sends, Split/Layer, favoritos, patterns, sequenciador do instrumento, arpejador, ajustes globais, MIDI MODE, rodas pitch/mod, bancos de faders, Power, Mute, Panic e persistência.
- Desacoplar as ações usadas pela shell dos elementos de apresentação. Preservar comportamento do teclado, pads, mapeamentos existentes, pickup e release. Depois de verificar paridade, retirar painel, links e `?legacy=1` da distribuição pública e atualizar manual e testes.

## 6. Consolidação de SEQ e STUDIO

- Concentrar a composição na DAW. A proposta para revisão é manter **Gravação rápida** como ação do Synth, com tomada de referência, histórico de eventos, contexto de timbres e recuperação.
- Abrir projetos Studio antigos representativos e comparar notas, áudio, expressão, FX compartilhados e automação. Verificar também o efeito de parar o transporte: Studio mantém o último valor automatizado e a DAW restaura o valor-base. Retirar SEQ e Studio da navegação após decidir o destino das funções e resolver as diferenças que afetam os projetos.

## Contratos de validação

Manter uma instância do instrumento, upstream fixado, pool global de 256 vozes e compatibilidade de presets e projetos. Navegação e layout preservam a continuidade do áudio e a seleção musical. Usar Chrome, com Full HD como mínimo de trabalho, incluindo dimensões úteis e zoom real, e distinguir validação de software de aceite físico. Registrar implementação, evidências, limitações, decisões e próximo passo de cada etapa em seu fechamento. Evidências locais ficam em `.local/validation/`.

O Astra recomendou manter o tema escuro e sinalizar gravação ativa com vermelho e texto. Usar a cor de pista principalmente para identificação e oferecer um modo explícito de atribuição MIDI são propostas do plano de implementação.
