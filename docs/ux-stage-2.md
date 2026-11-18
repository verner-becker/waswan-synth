# Etapa 2 da evolução de UX do WASWAN

Implementada em `feat/ux-stage-2-arrangement` sobre a etapa 1 aprovada em `645d0b4`. [Plano de evolução](ux-evolution-plan.md)

## Entrega

- **File** reúne nome do projeto, novo, abrir, salvar, salvar como, recuperação, importação e exportação da composição. Transporte, posição, BPM, loop e Undo/Redo ficam à vista. **Transport options** reúne compasso, duração do projeto, limites da região e exportação do trecho. O status acompanha o áudio e a seleção. Cancelar uma importação continua disponível enquanto ela roda.
- **Markers**, no cabeçalho da régua, permite adicionar no cursor, editar nome e posição e remover. Selecionar um marcador na régua desloca o cursor e seleciona seu registro para edição. A ativação da régua funciona pelo teclado.
- O layout novo abre com o painel inferior recolhido. Criar ou clicar num clipe abre o Piano Roll ou a waveform. Os gráficos vêm antes das ações e dos campos de **Clip properties** e **Exact note values**. A criação de clipes fica no Arrangement, pelo botão **Add clip at cursor** ou por duplo clique na pista MIDI. O nome e o início do clipe são mostrados no editor e nas propriedades, respectivamente. A preferência de altura previamente salva continua a ser lida.
- Mute, Solo e Arm têm alvos de 30×30 px e nomes acessíveis. **Vol** e **Pan** têm rótulos visíveis, cores distintas e valores lidos em dB e posição L/R. Os controles com nomes curtos têm dicas no foco. Os divisores aceitam setas e Home. O painel inferior pode voltar ao Arrangement por **Hide editor**, inclusive quando expandido.
- Na automação de Volume/Pan, o teclado seleciona pontos com Page Up/Down, ajusta posição e valor com as setas, cria no cursor com Enter e remove com Delete. Os campos exatos usam batidas de semínima, ganho linear de 0–2 e pan de −1 a +1. Arraste, edição numérica e teclado usam o histórico do projeto e a mesma regra para pontos que terminam na mesma posição.

## Validação executada

| Ambiente | Resultado |
|---|---|
| Chrome, área útil 1920×937 a 100% | A primeira grade começava em y=960 antes da etapa. Agora ocupa y=692–889 no painel inferior, com a página e o editor sem rolagem. Também passou a jornada projeto vazio → pista MIDI → clipe → editar nota e velocity por teclado → Undo/Redo. |
| Chrome, tela emulada de 1920×1080 a 125% real | A área útil foi 1536×750. Piano Roll com velocity e waveform ficaram inteiros no painel. Cada gráfico teve 142 px de altura útil, entre y=579 e y=721, e o M/S/R da primeira pista ficou visível. Save e Open pelo menu File reproduziram o projeto byte a byte após serializar o snapshot. |
| Chrome, testes do Arrangement, clipes, editores e automação | Projeto de cinco minutos, 32 pistas, reordenação por arraste, marcadores, captura de posição e região, divisores por ponteiro e teclado, notas, velocity, fades e loops. Automação passou com numérico, setas, criação no cursor, seleção, remoção, Undo/Redo e reabertura. |
| Chrome, regressões de áudio e integração | Passaram as jornadas de instrumentos, MIDI contextual, janela compartilhada, gravação, transporte, exportação e shell Synth, com uma instância de áudio. |
| Node | Passaram UI Foundation, Tone Editor, MIDI contextual, perfil MIDI, pool de 256 vozes e testes de domínio da DAW. |

Evidências em `.local/validation/ux-stage-2/`. As séries `before-01/02/03` e `after-01/02/03` registram projeto vazio, pista criada e primeiro clipe. `piano-100.png`, `piano-125.png`, `waveform-125.png` e `file-menu-125.png` registram o zoom real. O teste de save/open usou arquivos do navegador e simulou os diálogos nativos. Leitor de tela e controlador físico ficam pendentes de aceite.

A próxima revisão é a etapa 3, **Gravação e roteamento**.
