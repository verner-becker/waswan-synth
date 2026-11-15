# Auditoria inicial — 15/11/2026

## Base e decisão de preservação

Origem: https://github.com/4t59m4f784-creator/SMKSYNTH. Clone completo, com histórico, fixado em `3f751bc2be066414f204cf44e1aa05d9c7467d7f`. `RELEASE.json` declara 1.2.0. Nenhum arquivo rastreado do upstream foi alterado. O submódulo mantém as fontes correspondentes e os avisos junto ao projeto.

A base escolhida é `web/simulator/`, que contém entrada Web MIDI e a sessão de fábrica atual. `site/simulator/` é outra cópia publicada, mais antiga; `web/voice-lab/` e `web/sim/index.html` são interfaces históricas/experimentais. Misturá-las produziria uma base incoerente. O nome `obervave-voice.wasm` na interface atual é legado e não implica que o motor VOICE esteja ativo.

## Inventário reutilizável

| Componente | Local no upstream | Papel e decisão |
|---|---|---|
| Interface atual | `web/simulator/index.html`, `style.css`, `app.js` | Painel, teclas, pads, knobs, faders, controle de sessão. Reutilizar integralmente nesta etapa. |
| Entrada MIDI | `web/simulator/midi.js` | Web MIDI, seleção/hotplug, velocity, note-off, pedal, rodas e liberação de notas. Reutilizar; ponto inicial da expansão. |
| Adaptador JS/WASM | `web/simulator/engine.js` | Instancia WASM sem imports, traduz mensagens, framebuffer e blobs de sessão. Manter o contrato existente. |
| Áudio em tempo real | `web/simulator/worklet.js` | AudioWorklet estéreo, quanta de 128 frames, frames de interface e persistência. Reutilizar. |
| Execução sem áudio | `web/simulator/worker.js` | Fallback de interface quando AudioWorklet não está disponível. Não comprova execução sonora. |
| Adaptador WASM em C | `web/sim/sim.c` | Inclui `firmware/src/obervave.c` em modo host/SMK37, exporta `sim_*` e simula hardware, relógio, display e armazenamento. Preservar. |
| Motor ANALOG | `firmware/src/obv_engine.h`, `obv_dsp.h`, `obv_engine_patch.h`, `obv_patches.h` | Síntese, filtros, envelopes, alocação de oito vozes melódicas compartilhadas e quatro partes A–D. Reutilizar. |
| Supersaw | `firmware/src/obv_supersaw.h`, `obv_supersaw.c` | Variante do oscilador 1, derivada de Clipper; não é uma instância DSP independente. Limite de cinco vozes declarado na release. |
| DRUM-X | `firmware/src/obv_drums.h`, `obv_drumx_core.h`, `obv_drum_kits.h` | Bateria sintética derivada de JIANT; cinco kits, oito instrumentos, vozes de bateria independentes das melódicas. Reutilizar. |
| Roteamento entre motores | `firmware/src/obv_multiengine.h` | Troca por parte, transições e fila de eventos. Base existente para expansões futuras. |
| Efeitos | `firmware/src/obv_fx.h` | Chorus, delay, reverb e processamento de mix/master. Preservar antes de avaliar efeitos externos. |
| Sequenciamento e execução | `firmware/src/obv_seq.h`, `obv_endless.h`, `obv_perf.h`, `obv_keyboard_config.h` | Sequenciador, ENDLESS, favoritos, split/layer e configuração de teclado. Reutilizar formatos e comportamento. |
| Tabelas e fonte do display | `firmware/gen/` | Dados DSP gerados e framebuffer. Já incluídos; não foi necessário regenerar tabelas. |
| Sessão inicial | `web/simulator/factory-session.bin`, `factory.json` | Cinco patterns, oito favoritos, 90 BPM; memória própria do navegador. Preservar compatibilidade. |
| Tradução | `web/site/i18n.js` | A interface espera esse arquivo no diretório pai. Copiado para a árvore local de execução. |
| Compilação e verificações | `tools/build_controls_sim.sh`, `tests/simulator_midi_test.mjs`, `tests/release_demo_wasm_test.mjs` | Compilação C/WASM e testes existentes, reaproveitados pelos scripts locais. |

O DSP utiliza 44.100 Hz, blocos internos de 256 frames e tabelas dessa taxa. O AudioWorklet entrega blocos de 128 frames. Asyncify permite suspender/retomar o loop original a cada milissegundo do relógio de áudio. Não usa Emscripten, backend, servidor de áudio próprio, SharedArrayBuffer ou framework JS.

O fluxo é: SMK-37 Pro → ALSA/Web MIDI → `MidiInputController` → mensagens para AudioWorklet → `Engine` → `sim_midi`/`sim_wheel` → DSP C/WASM → Web Audio → PipeWire → saída analógica. A sessão é armazenada via blobs em localStorage, com importação/exportação; o armazenamento simulado não grava a memória do teclado.

## Licenças e dependências

| Item | Licença/origem | Relevância |
|---|---|---|
| SMKSYNTH/OberVave, simulador e adaptações | GPL-3.0-only; `LICENSE`, `LICENSING.md`, `CREDITS.md` | Preservar autoria e acompanhar distribuições derivadas com fontes correspondentes e avisos. |
| ANALOG e simulador original | zvenson e colaboradores | Autoria mantida no submódulo. |
| Plataforma e port SMK37 | Leo Kuroshita/Hügelton, Dinghy, SLOOP, M. Geisler e colaboradores | Incluídos e creditados no upstream; não é necessário compilar o firmware físico para executar o web. |
| DRUM-X/JIANT | GPL-3.0-only; Juan Ignacio Antonucci e demais autores dos arquivos | Sem samples de terceiros, conforme o upstream. |
| Supersaw/Clipper | GPL-3.0-only; 3dSam e autores precedentes | Avisos e referências preservados. |
| Adaptações e conteúdo de fábrica | Marcus Padrini; assistência de IA descrita em `CREDITS.md` | Manter os créditos completos. |
| Fonte Terminus do display | SIL OFL 1.1; `assets/fonts/Terminus-LICENSE.txt` | Fonte incorporada às tabelas geradas. |
| Elementos gráficos/fontes de outras páginas | URW base35: AGPL-3.0 com exceção de incorporação; Inter: OFL 1.1 | Inventariados em `LICENSING.md`; não copiar outros assets sem seus avisos. |
| Zig 0.15.1 | MIT | Compilador local, baixado via pacote `ziglang`. |
| Binaryen 133 | Apache-2.0 | `wasm-opt --asyncify`; ferramenta de build. |
| Python 3 | Biblioteca padrão | Servidor HTTP local; nenhum pacote Python de runtime. |
| Node.js | Executa os testes originais | Nenhuma dependência npm do sintetizador. |
| Playwright 1.56.1 | Apache-2.0 | Usado apenas na validação desta sessão, com Chrome instalado; não é dependência da aplicação. |
| SDK JieLi | Apache-2.0, segundo o upstream | Pertence ao empacotamento de firmware; não utilizado nesta etapa. |

Não foram invocados instaladores, WebUSB, SysEx, flash ou ferramentas de atualização do teclado. A entrada MIDI original solicita `sysex:false`, usa somente inputs e filtra mensagens não suportadas.

## Execução e evidências

Ambiente observado: Ubuntu 26.04.1, Node 24.21.0, Chrome 157.0.8103.78, PipeWire 1.6.2. O sandbox não expunha `/dev/snd` nem permitia acesso aos sockets de áudio; consultas ao hardware e execução do Chrome/servidor foram feitas com acesso ao host autorizado pela revisão automática.

Compilação executada com Zig 0.15.1 e Binaryen 133, usando o script original e `SIM_VERSION=1.2.0`. Cache, ferramentas e saídas permanecem locais. Não houve compilação ou escrita de firmware físico.

| Artefato | SHA-256 |
|---|---|
| WASM distribuído originalmente | `76e54169a95a1d4f49be8eb799e62012bc55801bc08f31f7a850daca85df28e2` |
| WASM recompilado e servido localmente | `0a84f809933f2f3f9a32e7db8bde45b2af54b071bcbe12cb70b6e0e74c98ee0b` |

Os binários diferem; não foi estabelecida reprodução byte a byte da toolchain usada na distribuição. Os testes existentes de MIDI e sessão musical passaram com o WASM recompilado. Os cinco patterns produziram os mesmos valores de energia reportados pelo teste com o binário distribuído; isso não constitui prova de equivalência de todos os timbres.

Verificações concluídas:

- `scripts/check-upstream.sh`: teste MIDI original com permissões simuladas, hotplug, corrida de seleção, velocity, note-off, canais, sustain, pitch/mod, panic e entrada de notas no sequenciador; teste dos cinco patterns, oito favoritos e ausência de gravações automáticas indevidas, ambos no WASM recompilado.
- `tests/drums_wasm_test.mjs`: passou no binário distribuído, cinco kits/oito instrumentos e áudio não nulo. Esse teste declara não testar a saída física do navegador.
- `tests/midi_mode_wasm_test.mjs`: passou no WASM recompilado após criar seu diretório de screenshots esperado (`build/mm1`). Verifica navegação, perfis persistentes e retorno ao synth. Esse teste trata do modo controlador simulado, separado da entrada Web MIDI externa.
- Chrome com o artefato recompilado: AudioContext `running`, 44.100 Hz, AudioWorklet ativo, tecla virtual com pico `0,07890` e RMS `0,04217`, sem exceções JS. `baseLatency` informada pelo navegador: aproximadamente 10,68 ms; não é medição da latência física total.
- PipeWire: stream do processo separado do Chrome conectado aos canais FL/FR da saída `CX11970 Analog`, ativo. Servidor PulseAudio compatível sobre PipeWire a 48 kHz; navegador continua renderizando a 44,1 kHz, com adaptação na pilha de áudio.
- Web MIDI: porta `SMK-37 Pro-Master` enumerada, aberta e selecionada na interface. O Chrome de teste exigiu concessão das permissões MIDI e MIDI-SysEx pela automação; a aplicação permaneceu solicitando `sysex:false` e sem abrir saídas MIDI.

A captura física ALSA e a produção de áudio pelo navegador foram verificadas separadamente. A confirmação auditiva pelo usuário e uma nova execução física de notas/rodas com a janela do simulador em foco ainda aguardam resposta. A captura Web MIDI dessa janela não havia recebido eventos até o fechamento deste registro; não se declara concluído esse teste integrado.

Evidências brutas locais, ignoradas pelo Git: `.local/validation/` contém capturas ALSA, resumo dos eventos, relatório/screenshot do navegador e rotas PipeWire. Elas servem à validação desta máquina; os resultados relevantes estão consolidados aqui.

## Controlador físico observado

ALSA enumerou `External MIDI`, cliente 24 nesta sessão, com `SMK-37 Pro-Private` (porta 0), `SMK-37 Pro-Master` (porta 1) e `MIDI 2-0-2` (porta 2). IDs numéricos podem mudar após reconexão; selecionar pelo nome. `amidi -l` identificou `hw:2,0,0` e `hw:2,0,1`. Escolher somente Master evita duplicar notas recebidas nas duas portas.

Captura de entrada durante a manipulação física pelo usuário, canais apresentados abaixo em convenção 1–16:

| Entrada observada na Master | Canal | Valores observados | Comportamento web atual |
|---|---|---|---|
| Teclas / note on-off | 1 | Notas 48–81, velocity 32–125; 166 note-ons | Aceitas; OMNI segue parte selecionada/split/layer. |
| Notas compatíveis com pads | 10 | Notas 36–51, velocity 44–127; 59 note-ons | Recebidas como notas MIDI; não acionam automaticamente os botões virtuais dos pads. A atribuição física individual não foi isolada. |
| Pitch bend | 4 | 204 mensagens; −7676 a +8191 | Encaminhado ao WASM; não foi medido desvio acústico em cents. |
| Modulação CC1 | 3 | 42 mensagens; 0–127 | Convertida em `sim_wheel(1, ...)`, reutilizando o caminho ADC simulado do firmware. |
| CC64–67 | 1 | Todos atingiram 0–127 | CC64 vira sustain; CC65–67 são ignorados pelo adaptador JS. |
| CC48–55 | 6 | CC48 atingiu 127; demais faixas parciais | Ignorados pelo adaptador JS. Necessitam mapeamento antes de controlar parâmetros. |

Total na Master: 225 note-ons, 225 note-offs, 1.895 CCs e 204 pitch bends. A captura Private começou depois: recebeu notas e CCs, sem pitch nessa janela; não se conclui que a porta Private nunca transmita pitch. As faixas são as observadas, não especificações máximas do hardware. Os grupos de CC ainda precisam de associação individual a cada knob/fader em uma captura guiada.

O adaptador atual aceita notas, pitch, CC1, CC64, CC120 e CC123. Descarta outros CCs, program change, SysEx e transporte externo. CC120/123 disparam liberação; comandos físicos não capturados não foram considerados testados. A presença de CC64 em uma varredura de controle contínuo exige atenção: atualmente qualquer CC64 recebido é interpretado como pedal.

## Estrutura mínima e primeira expansão proposta

Estrutura atual suficiente:

```text
upstream/SMKSYNTH/       código original fixado, com histórico e licenças
scripts/                preparação, build, verificação e servidor local
docs/auditoria-inicial.md
.tools/                 toolchain local, ignorada
.local/build/           WASM recompilado, ignorado
.local/www/             cópia executável original, ignorada
.local/validation/      evidências desta máquina, ignoradas
```

Primeira expansão recomendada: **perfil MIDI de entrada do SMK-37 Pro no host web**. Antes de criar um editor modular ou novos motores, aproveitar os controles existentes para operar o synth:

1. Capturar um controle por vez para associar fisicamente CC64–67/canal 1 e CC48–55/canal 6 a knobs/faders. Não presumir a numeração física a partir dos números de CC.
2. Acrescentar um adaptador pequeno, fora do upstream, que converta o perfil escolhido em mensagens já existentes de `Engine.input`: `fader`, `enc`, `wheel`, `pad` e controles de interface. Encoders relativos e CCs absolutos precisam de tratamentos distintos; não converter cada valor absoluto em um incremento de encoder.
3. Tornar o remapeamento optativo e persistir o perfil separadamente dos blobs do instrumento. Resolver explicitamente o conflito CC64/sustain e preservar o canal original quando não houver remapeamento. Manter a porta Master como uma única entrada.
4. Validar cada controle, extremos, reversão, canal, desconexão e panic, com áudio em execução. Critério de conclusão: tocar, modular e operar os parâmetros escolhidos pelo teclado sem modificar firmware, DSP, formatos de sessão ou duplicar eventos.

Uma interface modular pode depois compor o `AudioWorkletNode` existente com ganho/medição/efeitos Web Audio no host. O WASM atual entrega apenas uma saída estéreo mixada; saídas individuais por parte exigem uma alteração justificada no contrato C/WASM. Não é uma engine de módulos arbitrários pronta. Trocar a interface, separar o DSP por vozes ou introduzir roteamento modular extenso fica para uma decisão posterior.
