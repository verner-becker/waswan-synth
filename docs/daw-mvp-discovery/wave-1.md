# DAW — fase 1: sessão e provas técnicas

Branch `feat/daw-wave-1-session`, pai `1ca4830`. Escopo autorizado: contratos mínimos e provas de dono único, saídas por parte/FX e mídia longa. Sem integração na main. Estado: concluída como fundação e provas limitadas; expansão instrumental ainda tem gate próprio na fase 3.

## Contratos adotados

- **Host:** um documento possui AudioContext/WASM enquanto mantém `waswan-audio-owner-v1` em modo exclusivo, por origem/perfil Chrome. A aquisição ocorre antes de criar qualquer contexto. Suspender o contexto não libera a posse. Falha de startup fecha contexto antes de liberar. Se o fechamento falhar, reter a posse e orientar fechar a aba, pois liberar poderia permitir outro contexto enquanto o anterior ainda existe. Fechar o documento termina o áudio; outra página só inicia por gesto explícito. Não há transferência transparente nem eleição por heartbeat.
- **Vistas:** status por BroadcastChannel versionado, com ID do publicador e revisão monotônica daquele host. Sem framebuffer, PCM ou comandos arbitrários no canal de observação. Estado publicado é apenas apresentação, não relógio musical. O domínio de projeto será a autoridade de comandos/mutações a partir da fase 2.
- **Instrumento:** trilha lógica terá ID independente do slot; uma instância mantém pool global256. Slots/patches não pertencem à vista. Mais de quatro instrumentos ainda exige prova própria; quatro saídas não certificam essa capacidade.
- **Saída seca:** tap por parte, pré-mixer/FX/master do instrumento, Q17 convertido a Float32 sem clip adicional. Hook opcional na cópia de `sim.c`, amostra no mesmo `blk_pos` da saída estéreo. A rota original permanece. DSP worklet copia saídas adicionais só quando `processorOptions.dawOutputs` é explícito e o node foi criado com cinco saídas estéreo. O app Synth normal usa apenas a saída original.
- **Mídia:** fonte imutável separada da instância de clipe. Ensaio de capacidade inicial com AudioBuffer por fonte; não trocar só as constantes do pré-mix atual. A fase 2 deve impor orçamento antes de decode/alocação e preservar assets referenciados por Undo.
- **Comando futuro:** `{id, expectedRevision, type, payload}` → resultado com revisão ou erro de validação/conflito. Uma transação de gesto = uma entrada Undo. Não aceitar JavaScript de projeto nem listeners DOM como única API de edição.

## Escolhas e limites

O host continua sendo página Chrome; SharedWorker não foi usado como hospedeiro de AudioContext. A política atual de foco/hidden de MIDI e gravação é preservada até o desenho deliberado de janelas na fase 8; o canal de observação não promete performance musical em background.

A primeira prova de mídia aloca cinco fontes de cinco minutos (529.200.000 bytes de PCM Float32), três partes instrumentais e um grafo mínimo independente por parte. Isto explicita custo substancial, não promete memória total equivalente ao PCM. Um arquivo completo é persistido/reaberto em OPFS e decodificado; reprodução é uma janela curta incluindo seek ao final. Não é ensaio real de cinco minutos, crash recovery ou benchmark de underrun.

Assessment adicional do Sol 6.1 xhigh: manter `NTRK=4` para sequenciador/formato; possíveis slots adicionais de execução precisam de inicialização explícita, guardas em MIDI/seq e separação de expressão. A expansão ingênua altera DRUM-X e RNG Legacy. Investigar antes da integração instrumental, preservando bateria e SUPER atuais.

## Validação

Evidências e comandos efetivamente executados serão consolidados no fechamento desta fase. Sondagens novas: `tests/daw-session.test.mjs`, `tests/daw-outputs.test.mjs`, `tests/browser-daw-session.mjs`, `tests/browser-daw-media-probe.mjs`. Relatórios em `.local/validation/daw-mvp-wave-1/`. Nenhuma sondagem representa validação física ou Windows/macOS.

## Fechamento — 18/11/2026

- **Implementado:** posse exclusiva no startup normal e Legacy, aviso claro ao perder aquisição, canal somente leitura, taps secos opcionais e provas reproduzíveis. Não foram implementados painéis destacados nem edição remota.
- **Node/build:** build completo e referência pré-UI recompilados; 21 suites Node passaram (as 18 do baseline da análise, UI Foundation e as duas novas DAW). Verificação upstream passou. Saída estéreo foi idêntica com taps habilitados/desabilitados e à referência de UI. Testados isolamento de partes e alinhamento com renders de 1 a 1024 frames.
- **Chrome:** passaram UI Foundation v1/v2, tone editor, áudio Studio e 256 vozes; também as duas sondagens DAW. Concorrência de Start gerou exatamente um contexto; vista secundária recebeu status; suspensão reteve posse; fechar host permitiu início explícito; falha antes da criação liberou lock; falha injetada de close reteve lock, impedindo um segundo contexto. Esta última decisão privilegia exclusividade até o usuário fechar a página defeituosa.
- **Mídia:** cinco fontes de 300 s alocadas, 529.200.000 bytes de PCM Float32; três partes com energia não nula através de filtros/ganhos independentes. Um WAV de 52.920.044 bytes persistido em OPFS, lido e decodificado em 13.230.000 frames, com amostras de início/fim conferidas. Preparação observada ~9,6 s; reprodução observada ~8,53 s, incluindo fontes iniciadas perto do final. Contexto running, amostras finitas e zero erros reportados. Isto não certifica playback contínuo por cinco minutos nem memória nativa total.
- **Decoder:** MP3 local de um segundo decodificou em 46.080 frames; WAV de 48 kHz/um segundo foi reamostrado em 44.099 frames no contexto 44,1 kHz. A primeira expectativa de tamanho exato falhou e foi investigada; a prova final aceita até um frame de arredondamento no WAV e padding MPEG limitado, verificando sinal do MP3. Importação futura deve conservar o comprimento decodificado real.
- **Limites:** quatro saídas instrumentais, sem prova de seis instrumentos, sem recuperação de crash/quota, seletor nativo interativo, métricas de underrun físico ou continuidade ao fechar host. AudioBuffers inteiros consomem memória substancial; a próxima fase deve impor orçamento explícito. Não confundir esse ensaio com o antigo pré-mix limitado a120 s, que foi preservado.
- **Decisão:** continuar com projeto/arquivos e histórico de assets; validar a ampliação runtime na fase 3 antes de anunciar mais de quatro instrumentos. Não criar múltiplas instâncias nem ampliar pools para contornar o gate.
- **Próximo passo:** fase 2, modelo/persistência/comandos com testes de integridade e leitura de projetos antigos.
