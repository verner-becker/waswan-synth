# WASWAN Synth — UI Foundation v0.2

## Referência e escopo

Branch temporária: `feat/ui-foundation-v2`, criada da `main` atualizada em **`b3c9eaa82b7535083c5eea5a93ed3abdca466f4c`**. Esta entrega aguarda aprovação para integração; não cria tag.

A v0.1 já havia sido aprovada pelo usuário com o SMK-37 Pro. A v0.2 expõe a conexão MIDI na inicialização e os modos de voz na Performance. Não modifica DSP, WASM, alocador, Engine, presets, perfil MIDI, quantidade de vozes UNISON ou firmware. O submódulo permanece em `3f751bc2be066414f204cf44e1aa05d9c7467d7f`.

## MIDI Setup

**Start audio → MIDI Setup → Connect MIDI keyboard → MIDI Input → OK.** OK também permite continuar sem conectar nada, usando teclado virtual e pads.

- `web/ui-midi-setup.js` monta um diálogo nativo com o tema existente. Move o mesmo `.midi-panel`, com os mesmos `#midiConnect` e `#midiInput`, de Settings para o diálogo e o devolve ao fechar. Não há controles clonados, segunda lista de dispositivos ou novo armazenamento.
- Conexão, descoberta, seleção, portas e tratamento de permissões continuam no controlador existente. Somente **Connect MIDI keyboard** solicita Web MIDI, com `sysex:false`; abrir o diálogo não solicita permissão.
- Callbacks existentes de status/portas são encadeados para apresentar textos em inglês, sem alterar o gerenciamento MIDI. A mesma configuração fica integralmente disponível em Settings após OK ou Escape.
- Uma intenção temporária de abertura é definida apenas pela ação explícita Start audio/Resume audio. Na inicialização, o diálogo aparece quando o instrumento informa `ready`; na retomada manual, depois de `resume()` concluir. Navegação e retomada automática não o abrem.
- Falha de inicialização não abre o diálogo. O tratamento original do app é preservado e uma nova tentativa pode funcionar normalmente. Erro do processador também encerra o diálogo aberto e mantém a indicação de recarga do instrumento.
- Não se acrescentou preferência de porta nem reconexão automática: essas regras continuam sendo as do gerenciador original. Mapeamentos persistidos permanecem intactos.

## Voice Mode na Performance

O espaço abaixo de Play / stop e Sustain MIDI recebe apenas a fileira **POLY | MONO | DUAL | UNISON**, com quatro colunas uniformes. O estado ativo usa o destaque teal existente e `aria-pressed`; não há seleção otimista independente do motor.

`web/polyphony-panel.js` exporta a lista de modos e a ação `selectVoiceMode`. Performance e Diagnostics chamam essa mesma função, que verifica execução/parte ANALOG/MIDI MODE e mantém a sequência anterior: `controller.release()` seguido de `voice-mode` para a parte selecionada. **A troca de modo continua liberando notas e sustain conforme o comportamento existente**, inclusive nos demais canais alcançados pelo release original. A navegação sozinha não faz isso.

O snapshot real atualiza Performance, cabeçalho e Diagnostics. Mudar a parte ou editar o modo no Legacy também atualiza o seletor. DRUM-X desabilita os quatro botões e não destaca um modo ANALOG. MIDI MODE desabilita a edição; o modo salvo do patch pode continuar indicado como informação. O seletor de quantidade UNISON em Diagnostics não foi alterado nem duplicado.

## Layout e revisão visual

Referência de geometria da v0.1 medida no Chrome antes da alteração, com o motor em execução; desktop versionado em `tests/fixtures/ui-foundation-v1-panel.json`.

| Viewport | Altura anterior do Performance State | v0.2 | Observação |
|---|---:|---:|---|
| 1560 px | 210 px | 210 px | Largura e posições dos cinco elementos anteriores preservadas. |
| 1440 px | 222,84375 px | 222,84375 px | Mesmas dimensões e posições. |
| 1100 px | 209,375 px | 230,375 px | Cresce 21 px para acomodar a fileira sem sobrepor o conteúdo. |
| 390 px | 175,5625 px | 211,5625 px | Cresce 36 px; os quatro modos continuam na mesma fileira. |

**Limitação de layout:** a preservação exata das dimensões foi validada nas duas larguras desktop acima. Onde a composição responsiva anterior não tinha espaço livre suficiente, o painel ganha altura. Essa escolha mantém as posições do conteúdo anterior, a fileira única e a legibilidade, sem reduzir os botões a alvos impraticáveis ou sobrepor controles.

O diálogo foi inspecionado em 1560×1100 e 390×844, sem overflow horizontal interno. Capturas reais, em contexto isolado e com dispositivos MIDI sintéticos:

- [MIDI Setup desktop](assets/ui-foundation-v2/midi-setup-desktop.png).
- [Modos na Performance](assets/ui-foundation-v2/performance-modes.png).
- [MIDI Setup em viewport menor](assets/ui-foundation-v2/midi-setup-mobile.png).

## Testes executados

Chrome **157.0.8103.78**, Ubuntu, headless; áudio/WASM/AudioWorklet reais e MIDI sintético. Nenhum perfil pessoal foi usado ou alterado.

| Teste | Resultado |
|---|---|
| `voice-mode-action.test.mjs` | PASS: quatro modos, parte correta, sequência original release/send e recusa antes de executar, em DRUM ou MIDI MODE. |
| `browser-ui-foundation-v2.mjs` | PASS: Start/diálogo, nenhuma permissão automática, lista com duas entradas, seleção, OK, mesmos nós em Settings e preservação exata do perfil. |
| Cenários sem entrada e permissão negada | PASS: synth continua em execução e teclado virtual produz/libera notas. OK sem solicitar MIDI também funciona. |
| Falha no carregamento WASM e retry | PASS: nenhum diálogo na falha; nova inicialização funciona e apresenta Setup. |
| Modos nas três interfaces | PASS: cada modo na parte A, edição independente da B, Diagnostics → Performance, encoder da página VOICE do Legacy → Performance, restrição DRUM e UNISON inalterado. |
| Navegação e sustain | PASS: três vozes com gate mantidas entre workspaces e Legacy, zero comandos enviados pela navegação, um AudioContext/ready e liberação após pedal-up. |
| Retomada | PASS: automática não abre Setup; manual abre sem recriar AudioContext. |
| Geometria | PASS: quatro botões na mesma linha em 1560/1440/1100/390; dimensões e posições desktop comparadas à v0.1. |
| `midi-profile`, `midi-diagnostic`, `knob-pickup`, `polyphony-256` | PASS: regressões Node existentes de MIDI, diagnóstico, captura suave, alocação/roubo, sustain e release. |
| `ui-foundation.test.mjs` | PASS: regressão de parâmetros/persistência; 256.000 amostras escalares idênticas à referência auditada usada pela suíte. |
| `dsp-monitor.test.mjs` | PASS: estatísticas, agregação e áudio idêntico entre off/live/capture — 384.000 amostras escalares por modo. |
| `browser-ui-foundation.mjs` | PASS: knobs, toque, faders, learn, navegação, mute/resume, preset SAVE/recall, export/import de sessão e exportação DSP. Adaptado somente para fechar o novo Setup nos pontos esperados. |
| `browser-polyphony-256.mjs` | PASS: 256 vozes, modos, MIDI, sustain, release e áudio válido no modo legado. |

Nenhuma exceção JavaScript nos testes finais. O ensaio Node do DSP que foi interrompido pelo ambiente foi reexecutado integralmente e passou. Não se repetiu o soak de três minutos do navegador nesta alteração de interface; a captura/exportação do monitor foi exercitada pela regressão da shell. Não se declara nova medição de custo de DSP nem teste físico do SMK-37 Pro nesta fase.

### Reproduzir

Com as ferramentas e o WASM da v0.1 disponíveis, não é preciso recompilar o DSP:

```sh
sh scripts/stage-simulator.sh
python3 scripts/serve-simulator.py
node tests/voice-mode-action.test.mjs
node tests/browser-ui-foundation-v2.mjs
node tests/browser-ui-foundation.mjs
node tests/browser-polyphony-256.mjs
```

As suítes Node restantes são executadas com `node tests/<nome>.test.mjs`. Para um clone novo, preparar as ferramentas e compilar conforme README; `ui-foundation.test.mjs` também usa `sh tests/build-ui-reference.sh`. Evidências da nova UI, medições antes/depois e JSON de resultados ficam em `.local/validation/ui-foundation-v2/`, ignorados pelo Git. O teste v0.2 usa a fixture versionada e não depende de medições locais prévias.

## Arquivos e validação manual

Produção: `web/ui-midi-setup.js` (novo), `web/ui-foundation.js`, `web/ui-foundation.css`, `web/polyphony-panel.js`. Testes: duas suítes novas, uma fixture de geometria e adaptação da regressão da shell. Documentação: AGENTS.md, este relatório e três screenshots.

No Ubuntu, recarregar com **Ctrl+F5**, clicar **Start audio**, conectar e selecionar **SMK-37 Pro-Master** no MIDI Setup e confirmar **OK**. Tocar e experimentar os quatro modos diretamente em Performance State; a mudança de modo libera as notas existentes. Conferir o mesmo modo no cabeçalho e em DIAG. Trocar parte no Legacy e verificar o seletor. Repetir a inicialização com OK sem conectar e tocar o teclado virtual. Settings deve continuar mostrando a configuração MIDI.

A validação física desta v0.2 fica para o usuário. A branch será integrada à `main` somente após aprovação explícita; nenhuma expansão musical foi iniciada.
