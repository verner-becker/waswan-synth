# Music Lab · W0

A base conferida com `origin/main` foi `58212fd4784ddd5ff29d2fbabbc3ad277e8e7097`, com SMKSYNTH em `3f751bc2`. O manifesto conferiu os 67 arquivos extraídos em `.local/waswan-music-lab-spec-v1`. O auditor reproduziu 364 verificações musicais e 111 de dados, UX e engenharia. A auditoria XML verifica bem-formação e correspondência semântica. A validação XSD segue pendente.

## Mapa de integração

| Origem | Caminho atual | Notas, pedal e liberação |
| --- | --- | --- |
| MIDI físico | O host montado em `scripts/stage-simulator.sh` entrega dados e timestamp à única `MidiInputController`. `web/midi.js` avisa `studio-events`, verifica execução e posse da aba e consulta os perfis, Fusion e DAW. | Prioridade perfil → Fusion → DAW → rota original. A rota original normaliza Note On com velocity zero para Note Off, mantém teclas por canal/altura e usa `bridge.send`. O pedal atua globalmente nos canais aceitos pelo Synth. CC120/123 nessa rota aciona o panic do instrumento. |
| DAW | `daw-input-events.js` publica uma cópia com `consumed`, `routed`, `deviceId` e `deviceName`. O gravador DAW assina para takes MIDI. | `daw-input.js` retém o destino de cada ataque por canal e altura. O pedal é por canal. CC120/123 libera o canal quando a rota está protegida. O Sampler também pode receber comandos nessa parte monitorada. |
| Fusion e Sampler ao vivo | `sampler-fusion-input.js` trata o fluxo após os perfis. Sem Fusion e DAW, a rota de origem leva a nota ao Synth ou à camada ao vivo do Sampler. Expressão do Sampler tem comandos próprios. | Fusion libera por origem e canal. Na troca ou perda do dispositivo, `MidiInputController.release()` delega à Fusion ativa, à DAW protegida ou à liberação original. Na rota original, solta pedais, recentraliza controles e envia panic. |
| Teclado, QWERTY e pads | Os manipuladores originais passam pelo host montado, com handoff das teclas virtuais à Fusion quando ativa. Pads podem atingir o sampler no worklet. | `blur` e aba oculta soltam apenas teclas virtuais. A entrada física continua ligada à aba proprietária do áudio. O panic explícito usa `releaseAll()`. |
| Studio, DAW e sequenciador original | O `AudioWorklet` compartilhado recebe comandos do host. Studio usa `StudioClock` e `waswan_studio_note`. A DAW usa relógio e domínios próprios. A interface silenciosa usa worker. | Notas de sequência têm propriedade distinta das vozes interativas. Gravadores podem captar áudio do barramento mesmo sem evento MIDI correspondente. |

`ui-foundation.js` monta os workspaces e reutiliza as teclas e pads. `ui-primitives.js` fornece navegação com teclado, painéis e ações. `ui-foundation.css` define tokens e regras responsivas. O fallback de `focusMidiContext()` escolhe `performance`. O Lab deverá conservar o contexto efetivo para preservar o pickup. `daw-project.js` mantém formato v4 com PPQ 960 e áudio a 44.100 Hz. As lições Lab usam PPQ 480. Exportar uma cópia para DAW exigirá conversão de ticks ×2.

## Assessment Astra 6.2 extra high

A revisão independente confirmou que `DawAudition` prepara instrumentos de projeto e que iniciar uma sequência via comandos do Studio afetaria o transporte da composição. A prévia deve usar `waswan_studio_note` com seu próprio relógio e identificador no mesmo worklet. A parada libera somente essas notas. DAW, Studio, exportação, Fusion, Legacy e panic mantêm prioridade.

A sonda usou WASM real e CC64 simulado. POLY e DUAL tocaram a tríade e mantiveram o Dó físico até pedal-up. MONO e UNISON tocaram apenas a última nota da tríade e retomaram o Dó ao final. A sessão de fábrica tem partes A e D MONO, B DUAL e C POLY. A prévia deve escolher uma parte polifônica audível com margem no pool, respeitar a transposição de sequência e evitar a camada ao vivo da parte A.

## Plano W1

- Adicionar Music Lab ao shell com Melody Lab, Harmony Lab e Technique & Expression. Oferecer as duas escalas de Dó e a tríade. Usar o JSON autoral para alturas, posição rítmica e dedilhado da pauta, do teclado de referência e do áudio.
- Fixar VexFlow 4.2.5 com glifos Bravura. O spike isolado no Chrome desenhou clave de sol e fá agrupadas, armadura de Sol, sustenido, pausa e tríade vertical. Confirmou a associação de dedo e o destaque de evento. Captura em `.local/validation/music-lab/w0-vexflow-spike.png`.
- Usar um `StudioClock` dedicado à prévia no mesmo worklet. Validar a disponibilidade na abertura e durante a prévia. Preservar MIDI, presets, seleção de parte e o pool de 256 vozes.
- Testar a navegação com nota física simulada mantida, três gates simultâneos, áudio audível, interrupção de demonstrações, zoom, teclado e larguras de desktop e mobile. A validação física fica pendente.
- Tratar observação, avaliação e persistência em W2. `subscribeDawInput` é o ponto candidato para um observador de eventos, com distinção de dispositivo, canal, consumo e propriedade.

## Referências executadas

`tests/build-ui-reference.sh`, `tests/ui-foundation.test.mjs`, `tests/daw-input.test.mjs`, `tests/daw-midi-take.test.mjs`, `tests/studio-notes.test.mjs`, `tests/daw-monitor.test.mjs` e `tests/daw-audition.test.mjs` verificaram a base. W0 encerra com diagnóstico e spike. A implementação começa na branch empilhada `feat/music-lab-w1`.
