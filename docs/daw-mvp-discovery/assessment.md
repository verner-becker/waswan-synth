# WASWAN DAW — análise e faseamento proposto

Base: `8575f766`, upstream `3f751bc2be066414f204cf44e1aa05d9c7467d7f`. Nenhuma mudança funcional nesta entrega. [Escopo e autorizações](README.md). Relatório de inspeção e baseline dirigido; as provas da arquitetura futura ainda precisam ser executadas.

## Parecer

O navegador continua uma direção razoável. Há captura em blocos, relógio no áudio, projeto binário e exportadores reutilizáveis. Entretanto, o MVP solicitado representa uma evolução substancial do motor, do modelo de projeto e do tratamento de mídia. Reformar só a tela conservaria os principais limites atuais.

Recomendo provar primeiro sessão única, separação sonora e orçamento de mídia. Depois entregar fatias utilizáveis, com persistência e Undo desde a fundação. Não é responsável prometer todo este escopo em uma noite: podemos pactuar execução autônoma de fases aprovadas, com parada nos pontos de decisão. Não reduzir silenciosamente os requisitos para caber no período.

## Inventário frente à SPEC

“Existente” descreve código atual e baseline dirigido, não certificação das jornadas futuras.

| SPEC | Estado atual e diferença para o MVP |
|---|---|
| 1–2, Synth/DAW | Workspaces na mesma página compartilham instrumento. Não há posse única entre páginas; URL DAW e protocolo de vistas ausentes. |
| 3, UX | Shell, painéis e piano roll rolável existem. Falta Arrangement central completo, zoom independente, divisórias, layout persistido e destaque. Ícone musical não comprova instrumento disponível. |
| 4, transporte | StudioClock em frames, BPM/métrica/loop e metrônomo existem. Legacy é outro transporte; UI bloqueia coexistência. Faltam seek/intervalo global, marcadores e count-in completo. |
| 5, trilhas | Quatro partes fixas, volume/pan/mute/solo. Não são trilhas tipadas arbitrárias com instrumento e FX próprios. Presets de instrumento e MIDI Learn existem; perfis por contexto/dispositivo e presets completos de trilha são parciais/ausentes. |
| 6, clipes/áudio | Clipes MIDI movidos/duplicados/excluídos; regiões de áudio com offset, duração, ganho/balanço/mute e fonte preservada. Faltam edição gestual completa, split/fades/crossfade, multisseleção, loop de clipe/consolidação e âncora absoluta selecionável. |
| 6.5, importação | Apenas WAV PCM16 mono/estéreo 44,1 kHz; sem decoder WAV genérico/MP3 nem leitor SMF. |
| 7, piano roll | Desenhar/selecionar nota única, campos, setas, Delete e quantização explícita integral. Faltam seleção múltipla, drag/resize, velocity visual, quantização parcial e conjunto completo de atalhos/zoom/audition. |
| 8, gravação | Captura interna estéreo e entrada MIDI, overdub por parte e exclusão de eventos de playback na reconstrução. Não há entrada microfone/interface, modelo Arm/Monitor, count-in completo nem compensação manual por dispositivo. Captura atual adiciona notas; substituição com Undo deve ser implementada. |
| 9, mixer/FX | Mixer e FX do instrumento; sends e retornos compartilhados. Não equivalem a cadeia reordenável independente por trilha e Master da DAW. |
| 10, automação | Lanes lineares/step de parâmetros e mixer das partes, com aplicação no worklet. Reaproveitar interpolação; faltam lanes por ID de trilha e integração à timeline/Undo completo. |
| 11, exportação | SMF escritor; WAV/MP3 da tomada e captura do arranjo em tempo real com cauda. Não há render completo de seleção/trilha/stems e isolamento independente de FX. |
| 12, arquivos | `.wsproj` v1/v2 validado, fontes binárias, recuperação de tomada e cópia explícita OPFS. Save é download; faltam handles de arquivo, Save As, autosave completo versionado e proteção contra escritores concorrentes. Abrir preserva synth vivo; restauração de timbres é ação explícita. |
| 13, atalhos | Controles acessíveis e alguns atalhos locais; falta roteador por foco/seleção e ajuda completa. |
| 14, engenharia | ES modules, wrappers host, testes e diagnósticos. Boa parte da lógica ainda reside em classes de UI; comandos reutilizáveis devem sair gradualmente dos listeners. Sem MCP/LLM no MVP. |
| 15–16, J1–J7 | Não certificadas; dependem das capacidades acima e de testes físicos/multiplataforma. |

## Evidências de arquitetura

- **Entrada/build:** [build-simulator.sh](../../scripts/build-simulator.sh) compila cópias isoladas, com 256 vozes como padrão; [stage-simulator.sh:35](../../scripts/stage-simulator.sh#L35) encaminha timestamp MIDI e monta a shell pelo bridge `send/getAudio`. Fontes geradas ficam em `.local/`; não editar essas cópias.
- **Dono atual:** [app.js:44](../../upstream/SMKSYNTH/web/simulator/app.js#L44) cria AudioContext 44,1 kHz na página; [worklet.js:4](../../upstream/SMKSYNTH/web/simulator/worklet.js#L4) cria um Engine/WASM. Outra página pode repetir esse caminho. Não há lock/autoridade de sessão entre abas.
- **Foco é risco musical:** [app.js:51](../../upstream/SMKSYNTH/web/simulator/app.js#L51) libera notas em blur/hidden; [app.js:13](../../upstream/SMKSYNTH/web/simulator/app.js#L13) ignora MIDI com página oculta; [studio-recorder.js:10](../../web/studio-recorder.js#L10) encerra captura ao ocultar/sair. Clicar em um Mixer destacado pode, portanto, afetar a execução com o contrato atual.
- **Relógio:** [dsp-worklet.js:70](../../web/dsp-worklet.js#L70) chama StudioClock antes de renderizar o quantum. [studio-clock.js:8](../../web/studio-clock.js#L8) valida agenda, densidade e comprimento; [ui-studio-sequence.js:142](../../web/ui-studio-sequence.js#L142) bloqueia Legacy e programa áudio/MIDI no mesmo frame futuro. Isto não significa precisão acústica por amostra: há quanta e buffering interno.
- **Instrumentação:** [dsp-worklet.js:63](../../web/dsp-worklet.js#L63) publica métricas e informa qualidade do relógio. Date.now é fallback grosseiro, não medição de underruns físicos nem latência de ponta a ponta. Preservar esse aviso ao analisar p95/p99.
- **Instrumentos/saídas:** [studio-sequence.js:13](../../web/studio-sequence.js#L13) restringe partes a 0–3, assim como [studio-arrangement.js:4](../../web/studio-arrangement.js#L4). O DSP já tem [bus por parte](../../upstream/SMKSYNTH/firmware/src/obv_engine.h#L942), mas [sim.c:93](../../upstream/SMKSYNTH/web/sim/sim.c#L93) expõe só estéreo final. [obv_engine.h:1048](../../upstream/SMKSYNTH/firmware/src/obv_engine.h#L1048) soma partes e sends; FX/drive/master são compartilhados. Não existe separação pós-mix que devolva trilhas originais.
- **Projeto/áudio:** [studio-audio.js:3](../../web/studio-audio.js#L3) limita a quatro fontes/120 s e 32 regiões, com 240 s somados; arranjo com áudio também tem 120 s. [ui-studio-audio.js:39](../../web/ui-studio-audio.js#L39) prepara uma mistura inteira em AudioBuffer. Trocar só constantes pode multiplicar cópias/memória e não cria mixer em tempo real por trilha.
- **Arquivo:** [studio-format.js:61](../../web/studio-format.js#L61) concatena manifesto + tomada + WAVs; leitura valida tamanhos, versões e referências. Bom ponto de partida, mas o formato v3 precisa modelar trilhas/FX/âncoras e separar fonte de instância.
- **Undo/dados:** [ui-studio-sequence.js:33](../../web/ui-studio-sequence.js#L33) faz Undo sem restaurar níveis/pans vivos; [linha 128](../../web/ui-studio-sequence.js#L128) guarda 16 versões da sequência. Sem Redo. [ui-studio-audio.js:10](../../web/ui-studio-audio.js#L10) elimina histórico ao remover fontes sem uso. O MVP precisa reter bytes referenciados pelo histórico, além do estado gráfico.
- **Perfis:** [midi-profile.js:13](../../web/midi-profile.js#L13) identifica binding por nome de porta/canal/CC; há contexto e pickup. Evoluir identificação/seleção de perfil com migração; não reaplicar assignments automaticamente por mudar de tela.

O manual PDF foi lido via extração de texto. Confirma quatro partes, limites de áudio e ausência de Redo. Sua referência funcional `04dc1c8` é histórica; o HEAD atual inclui manual e integração posteriores. A auditoria confrontou fontes atuais, não fez checkout desse SHA.

Licenças: GPL-3.0-only na base e adaptações; [LICENSING](../../upstream/SMKSYNTH/LICENSING.md) e [CREDITS](../../upstream/SMKSYNTH/CREDITS.md) preservados; lamejs 1.2.1 separado, fonte fixada e LGPL-3.0 conforme [NOTICE](../../web/vendor/lamejs/NOTICE.md). Ferramentas Zig/Binaryen e fontes possuem licenças próprias. Não mudar licenciamento, firmware nem revisão do submódulo.

## Decisões técnicas que precedem a construção

| Risco | Opções e recomendação | Prova/decisão necessária |
|---|---|---|
| Sessão e várias janelas | Host de áudio em uma página, vistas via mensagens e posse exclusiva; alternativa é uma janela hospedeira dedicada. Recomendo host explícito com identidade/revisão de sessão e lock, sem criar um segundo motor em caso de heartbeat atrasado. | Abrir duas URLs, recuperar vista, perda de conexão, reload e fechamento do host. Fechar host inicialmente pode parar áudio com recuperação explícita; continuidade sem interrupção não está provada e depende de acordo. SharedWorker pode coordenar, mas não assumir que hospeda AudioContext. |
| Independência instrumental | Provar saídas secas por parte na instância atual; depois avaliar expansão de partes preservando pool global. Alternativa: várias instâncias sob um host, exigindo alteração explícita da regra atual e benchmark. | Aprovação para adaptar host/DSP, ponto do tap, compatibilidade timbral/FX e carga. Saída por parte sozinha conserva quatro instrumentos; não atende escalabilidade completa. Não adotar multi-instância silenciosamente. |
| FX de trilha | Grafo Web Audio com nós nativos e worklets pequenos onde necessário; alternativa é DSP dedicado integrado ao WASM. Recomendo avaliar grafo simples antes de portar toda a cadeia. | Provar isolamento, ordem, bypass, suavização, clipping, caudas e persistência; não há implementação pronta equivalente aos sete efeitos exigidos. Evitar somar FX Legacy sem intenção musical. |
| Áudio longo | Cache por fonte/blocos e agendamento com orçamento; alternativa inicial é AudioBuffer por fonte com limite medido. Recomendo escolher o caminho mais simples que passe na carga acordada. | Duração/trilhas alvo, memória real, decode MP3, resampling, import cancel, seek/loop e ausência de perdas. Streaming não deve ser antecipado como obrigação nem decodificação longa tratada como grátis. |
| Projeto e Undo | Manifesto versionado com assets imutáveis, histórico de transações e coleta só quando nenhuma referência existir. Escritor único; autosave com gerações e recuperação. | Roundtrip v1/v2→novo, edição após migração, interrupção, quota/permissão e arquivo truncado. Rejeitar versão desconhecida sem destruir o projeto aberto. |
| Exportar stems | Recomendo pós-FX/fader/pan da trilha e antes de FX Master, todos com mesma origem e duração/cauda definida; export da trilha igual a esse ponto. Alternativa inclui Master em cada solo. | Aprovar semântica. Com Master não linear, soma dos stems não equivale à mixagem masterizada. Export não pode modificar o projeto nem capturar entrada viva acidentalmente. |

Contrato mínimo: um controlador de sessão recebe comando com ID, revisão esperada e dados validados; aplica transação; retorna resultado/erro e revisão. Vistas guardam seleção/foco/layout, não cópias independentes da música. Relógio de áudio continua autoridade; snapshots servem à exibição. Operações como criar trilha, inserir notas e exportar intervalo devem ser testáveis sem DOM. Sem barramento corporativo, servidor MCP ou framework novo.

## Ondas propostas e branches empilhadas

Cada linha só começa depois dos critérios da dependência. Nomes propostos; criar somente ao começar. A branch da fase seguinte parte do SHA final da anterior, sem integrar na main.

| Onda/branch | Entrega e dependência | Critério de saída e retorno seguro |
|---|---|---|
| 0 `docs/daw-mvp-wave-0` | Este diagnóstico, decisões e escopo | Plano discutido; riscos ainda não provados identificados. Só documentação, sem comportamento novo. |
| 1 `feat/daw-wave-1-session` | Primeiro contratos mínimos de sessão/trilha/instrumento/asset/comando; depois provas curtas de autoridade entre vistas, bus por parte, FX mínimo e carga de mídia | Um host entre duas vistas, isolamento sonoro demonstrado e carga medida. Conferir alinhamento do tap com os blocos internos de 256 frames. Sem prova, preservar ensaio e pedir decisão; não construir layout sobre hipótese. Mudanças experimentais não substituem caminho atual. |
| 2 `feat/daw-wave-2-project` | Modelo tipado, assets/tempo musical e absoluto, comandos/Undo/Redo, formato e arquivo local; depende de 1 | Save/Open/Save As + recuperação; migração v1/v2 e Undo restauram bytes. Carga musical acordada cabe no orçamento. Conservar arquivos antigos e leitores. |
| 3 `feat/daw-wave-3-instruments` | Instrumentos independentes e grafo básico por trilha, medição e autoridade de transporte | Piano/baixo/terceira trilha simultâneos sem vazamento de patch/FX; salvar → fechar → reabrir → ouvir com timbres/mixagem preservados, usando UI mínima real. Escalabilidade além de quatro avaliada; regressão do synth. Manter rota Legacy de referência. |
| 4 `feat/daw-wave-4-arrangement` | Arrangement central, cabeçalhos tipados, transporte/seek/intervalo, marcadores e painéis na mesma janela | Compor e salvar arranjo básico; zoom/scroll/foco separados em notebook/1080p/ultra-wide. Reset Layout preserva som/projeto. Sem UI musical fictícia. |
| 5 `feat/daw-wave-5-recording` | Record único, Arm/Monitor, MIDI e dispositivo de áudio, count-in, compensação e substituição | Gravar ouvindo acompanhamento; Undo/Redo restaura tomada/bytes; click excluído; sem recapturar playback. Entrada/permissão ausente gera erro recuperável. |
| 6 `feat/daw-wave-6-editors` | Gestos e multisseleção, split/trim/loop/consolidate, piano roll/velocity/quantização parcial, WAV/MP3/MID e fades | J2/J6 parciais com edição completa e roundtrip; atalhos respeitam foco; fontes intactas. Cada conjunto de operações pode ser subfase/commit antes de avançar. |
| 7 `feat/daw-wave-7-mix-export` | Cadeias completas, Master, automação Volume/Pan, presets de trilha e export mix/seleção/trilha/stems | Arquivos alinhados e audíveis, sem click; caudas definidas, parâmetros/ordem/bypass recuperáveis. Export cancelado não altera composição. |
| 8 `feat/daw-wave-8-windows-midi` | Painéis destacados, recuperação/reintegração e perfis locais por dispositivo/contexto | J3/J4; uma autoridade, vistas sincronizadas e perda de foco sem liberar notas/parar gravação. Testar fechamento/reabertura e conflitos de arquivo. |
| 9 `test/daw-wave-9-stabilization` | J1–J7, carga prolongada, falhas, documentação e manual | Matriz executada com resultados e limites; validação física/Windows/macOS identificada separadamente. Entrega para revisão, sem merge automático. |

A onda 1 testa cedo o que a onda 8 só transforma em experiência completa. Mixer básico acompanha instrumentos, salvamento acompanha modelo, testes acompanham cada onda; nenhum deles fica para o fim. Se uma onda ficar grande, dividir a branch em subfases aprovadas e documentar a dependência, sem mudar o escopo por conveniência.

## Validação e limites

Evidências desta análise: `.local/validation/daw-mvp-wave-0/`. Resultados finais de build e suites são registrados no fechamento abaixo. Sondagem Chrome 157.0.8103.78/Linux headless: ambas as páginas iniciaram um AudioContext próprio a 44,1 kHz. Confirma ausência atual de posse única entre páginas. Cada página expôs File System Access pickers, OPFS, Web Locks, BroadcastChannel, SharedWorker e getUserMedia. Exposição não prova seletor nativo, permissão persistida, atomicidade, captura física nem hospedagem do contexto em worker.

Para implementar: build e check-upstream; suites Node de MIDI/profile/pickup, presets/tone editor, 256 vozes, DSP e Studio; checks Chrome dirigidos. UI exige as quatro verificações de AGENTS.md e tom exige os dois testes adicionais. Alocação alterada exige etapas anteriores de vozes. J1/J5 focam alinhamento e Undo de mídia; J2/J6 import/export e integridade; J3/J4 foco/janelas/dispositivos; J7 carga e recuperação.

Carga proposta para negociar: música de cinco minutos, oito trilhas totais (começar com três MIDI e cinco áudio), FX representativos, e ensaio separado de captura de 20 minutos. São alvos de validação, não capacidade certificada. Registrar configuração, taxa, memória de página/worker quando observável, tempo de decode/export, contagem de blocos/perdas e distribuição DSP com qualidade do relógio explícita. Não certificar underruns físicos a partir de timers de UI. Só fixar limite suportado depois da medição.

Testes obrigatórios de falha: dono encerrado/suspenso, vista desatualizada, comando duplicado/fora de revisão, duas abas salvando, permissão revogada, quota cheia, gravação interrompida e versões corrompidas. Testar o seletor nativo com interação real antes de declarar File System Access resolvido.

Inspeção das quatro imagens: prioridade à timeline, régua e painel inferior contextual. As anotações e layouts com vários painéis/Arm ativos não são especificação de tela final. Não houve nesta entrega uma auditoria visual completa do produto nem execução das jornadas futuras.

## Decisões para a conversa de aprovação

1. Aprovar esta ordem e o primeiro bloco de execução autônoma, com critérios de parada; não prometer MVP completo durante a noite.
2. Autorizar explicitamente a investigação/alteração de host/DSP necessária para saídas e instrumentos independentes, preservando upstream e pool de 256; multi-instância continuaria sendo uma decisão separada.
3. Acordar o comportamento ao fechar o host: interrupção/recuperação explícita inicialmente, ou continuidade obrigatória como bloqueio de arquitetura. Não prometer transferência transparente.
4. Acordar carga de validação e ponto de export dos stems; casos de hardware físico e Windows/macOS exigem participação/ambiente disponível.

Registrar a decisão aprovada neste controle. Nenhum item do roadmap nem mudança de polifonia está embutido na proposta.

## Assessment independente

Consultado GPT-6.1 Sol com esforço `xhigh`, em inspeção somente leitura. Confirmou priorizar fundações antes do layout e destacou duas correções adotadas: contratos mínimos precedem provas; uma fatia musical com Save → fechar → reabrir → ouvir precisa anteceder o editor completo. Também confirmou que saída separada por parte não amplia o número de instrumentos e que várias instâncias poderiam multiplicar pools/custo, contrariando a regra atual. Não executou testes; os resultados de validação deste relatório pertencem ao agente principal.

## Fechamento desta análise

- **Entregue:** cópia fiel do Discovery, inspeção de fontes/manual/imagens, inventário, alternativas, plano de branches e registro das orientações. Nenhum código de produção foi alterado.
- **Executado:** `sh scripts/build-simulator.sh` passou com ferramentas já instaladas; não foi necessário setup. Após o build, passaram 18 suites Node: midi-profile, midi-diagnostic, knob-pickup, studio-arrangement, studio-audio, studio-automation, studio-capture, studio-clock, studio-context, studio-format, studio-live-notes, studio-notes, studio-sequence, tone-editor, tone-selector, polyphony-256, dsp-monitor e voice-mode-action. `sh scripts/check-upstream.sh` também passou.
- **Chrome:** `node tests/browser-studio-audio.mjs` passou: pulso/mistura por amostra, exclusão do click, início MIDI/áudio, fonte preservada, roundtrip v2, recuperação OPFS e um contexto durante navegação interna. A sondagem separada de duas páginas/API passou e registrou dois contextos independentes. Resultados/logs desta execução em `.local/validation/daw-mvp-wave-0/`; a suíte existente também escreve seu relatório em `.local/validation/studio-wave-5/`.
- **Integridade:** upstream permanece fixado; nove arquivos do ZIP idênticos; links locais do relatório conferidos. WASM 256 reconstruído SHA-256 `1700699f6b868d4b7a8ec63e023c184b209c4ab4bc5b5bbc7914a18f6c944c8f`. Não houve alteração de alocação/DSP.
- **Limites:** sem benchmark novo de mídia longa/FX/instrumentos independentes, prova de host futuro, testes completos de UI ou J1–J7, seletor nativo interativo, novo ensaio de 20 minutos, validação física, Windows ou macOS. Proposta ainda não é certificação de viabilidade integral.
- **Próximo passo:** discutir as quatro decisões acima e autorizar o bloco de implementação/provas. Até lá, nenhuma fase funcional iniciada ou integrada.
