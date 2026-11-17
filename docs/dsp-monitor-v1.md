# WASWAN DSP Monitor v1

Evolução Studio (2026-11-17): quando o transporte MIDI Studio está ativo, a janela medida também inclui seu agendador de notas antes do render original. O campo de escopo passa a `host-process-including-studio-scheduling-copy-frame-store`. As limitações do relógio, dos percentis e da inferência de underruns permanecem; sem transporte Studio, o caminho de áudio foi comparado com a referência e continua idêntico.

## Decisões anteriores à implementação

Base verificada: `experiment/polyphony-256`, commit `5edc7449942703b8e893bb112657f7a024354648`, limpa e igual ao remoto. Branch isolada: `feat/dsp-monitor`. Upstream, firmware, presets e DSP permanecem intactos.

A auditoria do worklet fixado encontrou `process()` com render WASM, cópia estéreo, frame a 25 Hz e persistência a 1 Hz. O monitor envolverá esse callback completo, incluindo os custos periódicos originais; não medirá apenas o núcleo DSP. Mensagens de controle passam pela porta existente; o motor e seu reboot continuam originais. O worker silencioso não representa execução de áudio e não será instrumentado.

`currentTime`/`currentFrame` são relógios de transporte, inadequados para medir duração síncrona. Usar somente `performance.now()` quando disponível no escopo AudioWorklet; caso contrário informar indisponibilidade, valores de duração nulos e nenhum diagnóstico de deadline. Não adicionar relógio artificial, SharedArrayBuffer, headers de isolamento ou backend. A disponibilidade será verificada no Chrome real.

Histogramas fixos de 1024 bins de 0,025 ms, com overflow explícito, serão agregados fora do callback para percentis aproximados. Sem ordenação por bloco. Comunicação a aproximadamente 1 segundo de áudio, buffers de tamanho fixo; logs limitados a 3600 janelas por captura. Contagem de vozes amostrada na janela, não por bloco: pico amostrado pode perder transientes. Gate não significa tecla pressionada; release não prova audibilidade. Violações medidas do orçamento não comprovam underruns.

## Resultado da sondagem e ajuste da decisão

Sondagem no Chrome instalado: `performance` undefined, `Date` function, `SharedArrayBuffer` undefined no AudioWorklet. Antes de implementar o fallback, decide-se usar `Date.now()` quando não houver `performance.now()`. Isso fornece duração de relógio civil, quantizada em 1 ms (possivelmente ainda mais reduzida pelo navegador), não monotônica. Valores negativos serão rejeitados e contados. Média de muitas amostras pode ser útil, mas percentis e classificação de orçamento de blocos individuais têm erro de quantização e possíveis ajustes do relógio. A qualidade será `coarse-wall-clock`, explicitamente. Sem ambos os relógios, durações serão nulas. Não se inferem underruns desses valores.

## Arquitetura implementada

- `dsp-worklet.js`: subclasse do processador fixado. O empacotamento exporta a classe original em uma cópia derivada e registra o wrapper; o corpo original de `process` permanece idêntico. WASM, buffers de áudio, algoritmos DSP e controles originais não são modificados.
- `dsp-stats.js`: acumuladores numéricos e histograma fixo. Callback habilitado: duas leituras de relógio, atualização O(1) por bloco; consulta de vozes aproximadamente a 25 Hz; mensagem agregada aproximadamente a cada segundo de áudio. O histograma é reiniciado por janela; alocações e serialização adicionais acontecem nas cadências periódicas, não em cada bloco. As alocações preexistentes no upstream são preservadas.
- `dsp-monitor.js` e CSS: extensão discreta, oculta/desligada por padrão, montada pelo controlador existente. Gancho no receptor da aplicação encaminha as mensagens; não substitui `onmessage` da interface. Capturar força a instrumentação mesmo com painel oculto. Ocultar sem captura desliga a instrumentação. Não altera armazenamento de presets/perfis.
- `stage-simulator.sh`: empacota os módulos, valida âncoras do código original e gera `dsp-version.js` com HEAD, estado dirty e base. É preciso reempacotar após commits para atualizar os metadados; nenhum hash autorreferente é versionado.

Iniciar captura reinicia os agregados e cria UUID aleatório sem relação com dispositivos. Encerrar recebe a janela parcial e consolida os histogramas. Reboot e erro encerram a captura com motivo. Se o callback não responder ao encerramento em dois segundos, o resumo indica `stop-timeout-incomplete` e contém somente janelas recebidas. `pagehide-incomplete` também não promete incluir a última janela. O modo worker silencioso não oferece captura. Silenciar a saída ou parar o sequenciador não para o processador: a captura continua medindo os callbacks.

## Definições e precisão

Para um bloco com `F` frames e sample rate `R`, orçamento `B = 1000 F / R` ms. Duração `d = relógio_depois - relógio_antes` envolve o callback original inteiro, sem incluir a contabilização do monitor. Não é tempo exclusivo de CPU e pode incluir interrupções do escalonador. Não mede latência MIDI, saída física nem PipeWire.

`blocks` conta todos os callbacks habilitados; `measuredBlocks` conta durações válidas. Média = soma das durações válidas / quantidade válida; máximo = maior duração válida. `overBudget` conta `d > B`, ou é null quando não existe medição válida. `budgetMs` é a média dos orçamentos de todos os blocos da janela, `budgetUsedPercent = 100 média / budgetMs`. São registrados frames atuais e faixa min/max, sem presumir que todo navegador sempre usará 128. No Chrome validado são 128 / 44100 Hz, orçamento de aproximadamente 2,902 ms.

O histograma possui 1024 bins de 0,025 ms, com último bin aberto. Percentil é o limite superior do bin onde a soma acumulada atinge `ceil(q N)`. Se cair no último bin (a partir de 25,575 ms), retorna null, em vez de inventar um limite superior; `histogramOverflow` conta valores a partir de 25,600 ms. A resolução do histograma NÃO é a resolução do relógio. No Chrome instalado, `Date.now` é quantizado nominalmente em 1 ms e não monotônico; o navegador pode aplicar redução adicional de precisão. p95/p99 frequentemente se concentram em 1,025/2,025 ms; não significam precisão de microssegundos. Durações negativas ou não finitas são rejeitadas e contadas em `invalidDurationBlocks`; mudanças positivas no relógio podem inflar o máximo. Sem relógio, tempos e violações são null e contagem de blocos/orçamento/vozes continuam disponíveis.

Resumo da sessão soma contagens e somas e mescla histogramas; calcula percentis novamente sobre a distribuição consolidada, nunca pela média de percentis das janelas. As janelas usam tempo de áudio para cadência e timestamp ISO de recebimento na UI; suspensão do contexto ou atraso da UI pode deixar intervalos maiores no relógio civil.

Voz ativa significa `gate || envelope != IDLE` no pool ANALOG, conforme a telemetria já existente. Gate inclui sustain, não significa tecla física pressionada; sem gate com envelope ativo é release. Esses números não provam audibilidade e não contam vozes internas de DRUM-X. Pico é o maior valor amostrado a aproximadamente 25 Hz e pode perder transientes entre amostras. A capacidade é consultada no WASM, não alterada pelo monitor.

## Memória e privacidade

Não se retêm amostras de áudio, eventos MIDI ou durações individuais. Histograma de 4 KiB por acumulador; janela periódica transfere estatística fixa para a UI. Logs retêm no máximo 3600 janelas, além de início e resumo; depois a captura encerra automaticamente, sem descartar silenciosamente os primeiros registros. A UI retém uma única sessão; iniciar ou limpar substitui os registros anteriores. Histogramas das janelas não são retidos nos logs, apenas acumulados no histograma total.

Logs exportam UUID da sessão, métricas, hashes públicos e ambiente genérico de áudio; nenhum nome/ID de dispositivo, caminho local, evento MIDI, nota ou conteúdo musical. Não há backend, escrita de arquivo no callback, mensagem por bloco ou log de console por bloco.

## Operação

1. `sh scripts/stage-simulator.sh`; iniciar `python3 scripts/serve-simulator.py` se ainda não estiver ativo.
2. Abrir `http://localhost:8737/simulator/`, recarregar e iniciar o instrumento.
3. Clicar **Mostrar WASWAN DSP Monitor**. Sem captura, atualiza as métricas da última janela; não guarda histórico.
4. Clicar **Iniciar captura**, tocar normalmente e depois **Encerrar captura**.
5. Clicar **Exportar JSONL** e salvar o arquivo `waswan-dsp-YYYYMMDD-HHMMSS.jsonl` (nome usa UTC). Exportação fica disponível após encerramento. **Limpar sessão** remove o histórico da memória do navegador.

Ocultar o painel mantém uma captura em andamento. Ao encerrar com painel oculto, a instrumentação é desativada. Para comparar cenários, aguardar estabilização, usar a mesma sessão/preset, a mesma entrada e carga de outras aplicações; evitar benchmarks concorrentes. Uma CPU lógica ocupada por um processo de teste não identifica a thread de áudio de outra aba e não caracteriza falha do sintetizador. Métricas de callback e consumo global de CPU respondem perguntas diferentes.

## Reprodução dos testes

Compilação de base já disponível, sem alteração de C/WASM nesta fase:

```sh
sh scripts/build-simulator.sh  # somente se os artefatos anteriores não estiverem disponíveis
sh scripts/stage-simulator.sh
node tests/dsp-monitor.test.mjs
node tests/midi-profile.test.mjs
node tests/polyphony.test.mjs
node tests/polyphony-16.test.mjs
node tests/polyphony-32.test.mjs
node tests/polyphony-64.test.mjs
node tests/polyphony-128.test.mjs
node tests/polyphony-256.test.mjs
sh scripts/check-upstream.sh
node tests/browser-dsp-monitor.mjs
node tests/browser-polyphony-256.mjs
```

Testes de navegador usam o Playwright/Chrome já existentes em `.tools/browser` e `/usr/bin/google-chrome`, sem novas dependências. Executar benchmarks isoladamente, não junto das regressões. O harness Node executa o wrapper e o callback originais reais com WASM de 256, mesmo áudio por cenário, aquecimento e cinco rodadas em ordem alternada. O benchmark Chrome mede consumo agregado dos processos renderer via CDP em três rodadas de dez segundos por cenário; inclui a UI e não deve ser descrito como tempo exclusivo do DSP. A captura prolongada dura três minutos reais com 256 vozes; o limite de uma hora é exercitado separadamente com 3610 janelas sintéticas.

## Exemplo sintético de JSONL

Valores ilustrativos; não são evidência de benchmark. O arquivo real inclui metadados adicionais, faixa de frames, orçamento e contadores de qualidade.

```jsonl
{"type":"start","timestamp":"2026-11-15T12:00:00.000Z","session":"example","instrument":"WASWAN Synth DSP Monitor v1","build":{"referenceCommit":"example","dirty":false}}
{"type":"window","timestamp":"2026-11-15T12:00:01.000Z","session":"example","sampleRate":44100,"frames":128,"poolCapacity":256,"voices":{"active":32,"gate":16,"release":16,"capacity":256},"peakVoices":40,"meanMs":0.2,"p95Ms":1.025,"p99Ms":1.025,"maxMs":2,"blocks":345,"measuredBlocks":345,"overBudget":0,"measurement":{"state":"available","clock":"Date.now","quality":"coarse-wall-clock","nominalResolutionMs":1}}
{"type":"summary","timestamp":"2026-11-15T12:00:01.050Z","session":"example","reason":"user","sampleRate":44100,"frames":128,"poolCapacity":256,"peakVoices":40,"meanMs":0.2,"p95Ms":1.025,"p99Ms":1.025,"maxMs":2,"blocks":345,"measuredBlocks":345,"overBudget":0,"measurement":{"state":"available","clock":"Date.now","quality":"coarse-wall-clock"}}
```

## Resultados medidos nesta fase

Chrome `157.0.8103.78`, máquina local, mesma sessão INIT saw com 256 vozes alocadas. Estes valores foram medidos nesta fase; não foram reutilizados os benchmarks históricos.

### Callback original + wrapper em harness Node

Cinco rodadas alternadas, 3446 blocos de 128 frames por rodada (10,002 segundos de áudio), após aquecimento. Relógio externo de alta resolução do Node; não confundir com a precisão disponível no worklet do Chrome.

| Cenário | Mediana para 10,002 s de áudio | Diferença relativa |
| --- | ---: | ---: |
| Desativado | 1914,109 ms | referência |
| Visível, sem captura | 1921,914 ms | +0,408% |
| Captura ativa | 1921,858 ms | +0,405% |

O custo adicional do wrapper foi pequeno nessa carga. A diferença entre os dois cenários habilitados está dentro da variação entre rodadas; não indica vantagem de capturar. Não é garantia para todos os presets, máquinas ou carga concorrente.

### Chrome real: CPU agregada dos renderer

Três rodadas alternadas de dez segundos por cenário; mediana de CPU-segundos / segundo civil. O valor 1 significa um núcleo lógico ocupado em média, somando todos os renderer desse Chrome de teste. Inclui UI, GC e comunicação, não identifica uma thread e não é percentual de orçamento de áudio.

| Cenário | Núcleos lógicos equivalentes | Diferença relativa à referência |
| --- | ---: | ---: |
| Desativado | 0,861 | referência |
| Visível, sem captura | 0,880 | +2,21% |
| Captura ativa | 0,887 | +3,02% |

Acréscimo absoluto de aproximadamente 0,019 / 0,026 núcleo. Os timestamps da captura musical fornecida se sobrepõem a parte da captura prolongada automatizada. Não controlamos a carga global das outras aplicações; os resultados não representam uma máquina garantidamente ociosa ou CPU exclusiva. O Chrome automatizado é um processo separado; o contador CDP soma somente seus renderer. A ordem alternada reduz viés de aquecimento, mas não elimina variação do sistema.

### Captura prolongada

Passou com 256 gates ativos: 180 janelas, 62072 blocos, progresso de áudio de 180134 ms. Média coarse de 0,763 ms; p95 2,025 ms; p99 3,025 ms; máximo 4 ms; 879 valores acima do orçamento de 2,902 ms. Esses valores têm resolução real nominal de 1 ms e não comprovam 879 underruns. O teste constatou progresso do áudio em tempo real e amostras finitas/não nulas no AnalyserNode, sem exceções; não mediu xruns do dispositivo físico.

Sete leituras do heap da UI após GC ficaram entre 2859048 e 3081384 bytes, começando em 3013940 e terminando em 2905904 bytes. Não se observou crescimento persistente nos três minutos. Essa medição de heap CDP é da UI; não é prova de ausência de qualquer vazamento em toda a memória nativa do navegador ou no worklet. O worklet usa apenas acumulador/histograma da janela, sem coleção de amostras. Separadamente, 3610 mensagens sintéticas confirmaram encerramento automático em 3600 janelas, com rejeição de mensagens excedentes.

### Captura musical fornecida pelo usuário

Arquivo avaliado localmente, sem versionar o arquivo, identificador de sessão ou caminho. Duração de áudio 79,015 s, 79 janelas e 27223 blocos; início, janelas e resumo consistentes, mesma sessão, somas de blocos/violações e média ponderada conferem. Média 0,296 ms (10,197% do orçamento), p95 1,025 ms, p99 2,025 ms, máximo 3 ms, 6 violações medidas (0,022%). Pico amostrado 256. Nas quatro janelas cuja amostra final mostrou 256 gates, média ponderada 0,741 ms (~25,5% do orçamento); isso não garante que essas janelas inteiras tiveram 256 vozes constantes.

Essa captura usa o protótipo identificado pelo commit de auditoria com `dirty: true`, antes do commit de implementação. Não permite medir overhead sem uma captura comparável com monitor desligado. Tempos refletem o callback original, não o uso global de CPU. Os percentis consolidados não podem ser recalculados somente pelos percentis de janela exportados; a implementação faz o cálculo pelo histograma total e o teste estatístico verifica essa regra.

### Validações concluídas

- Teste estatístico: soma, percentis consolidados, overflow, orçamento variável e ausência/invalidez de relógio.
- Comparação determinística: 384000 valores escalares de áudio (192000 frames estéreo) idênticos entre desligado/visível/captura, incluindo sustain, note-off, pitch bend, release, nova entrada e panic.
- Wrapper real: 256 gates, flush parcial ao parar, reboot, caminho sem relógio.
- Regressões Node das etapas 8, 16, 32, 64, 128 e 256: passaram, incluindo alocação/roubo de vozes, sustain/release, MIDI/perfil aprendido, presets/sessões e regressão estéreo.
- MIDI/profile e testes originais MIDI/demo: passaram; favoritos/padrões preservados, sem gravações automáticas extras.
- Chrome monitor: início antes/depois do boot, encerramento, JSONL válido/consistente, download real, nova sessão, limpeza, captura oculta, largura mobile 334 px em viewport 390 px e ausência de exceções: passaram.

Evidências ignoradas em `.local/validation/`: `dsp-monitor-native.json`, `dsp-monitor-native.log`, `dsp-monitor-browser.json`, `dsp-monitor-browser.log`, `dsp-monitor-regressions.log`, `dsp-monitor-mobile.png`, logs JSONL exportados, reinício e limite sintético. Nenhuma validação de firmware físico foi executada nesta fase.

- Chrome polifonia completa de 256 com a extensão integrada e desligada: passou em POLY A/B (128 + 128), DUAL 128 notas, 257ª alocação, note-off antigo, sustain/release, MONO/UNISON8 e perfil preservado; progresso de áudio 4998 ms em espera de 5000 ms, áudio finito/não nulo, sem exceções. Evidência: `dsp-monitor-browser-polyphony.log`.

## Rastreabilidade e arquivos

Branch `feat/dsp-monitor`, base de 256 `5edc744`, auditoria anterior à implementação `5f136e2`, implementação `baae464`; testes e documentação em commits separados. `main`, `feat/polyphony-128`, `experiment/polyphony-256`, tags e submódulo permanecem preservados. Publicação somente dessa branch, sem merge e sem tag. Nenhuma alteração de cutoff ou WASWAN Layer.

Arquivos: `web/dsp-worklet.js`, `web/dsp-stats.js`, `web/dsp-monitor.js`, `web/dsp-monitor.css`, integração em `web/midi.js` e `scripts/stage-simulator.sh`; testes `tests/dsp-monitor.test.mjs` e `tests/browser-dsp-monitor.mjs`; `README.md` e este relatório.

Limitações conhecidas: relógio civil coarse no Chrome; picos de vozes amostrados; histórico limitado a uma sessão e aproximadamente uma hora; exportação somente após encerrar; fechamento da página não baixa arquivo automaticamente e pode perder a janela parcial; memória nativa do navegador e xruns físicos não foram medidos. Não foi conduzido teste manual de todos os presets nem validação auditiva humana sistemática; a regressão sonora é determinística e automatizada. Instrumentação é optativa, com overhead pequeno na carga medida e sem garantia universal para futuros timbres multicamadas.
