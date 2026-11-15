# Polifonia — etapa de 32 vozes

O usuário autorizou 16 → 32 e delegou os testes ao agente, sem depender do limite de teclas simultâneas do SMK-37 Pro. A etapa técnica de 16 está preservada em `main` e na tag pública `v0.4.0`. A implementação atual está em `feat/polyphony-32`. As etapas de 64 e 128 não foram iniciadas.

## Revisão e mudanças

O patch `patches/polyphony-32.patch` é aplicado somente à cópia descartável `.local/build/source-32/`. O submódulo original permanece intacto. O patch tem zero contexto; linhas removidas são conferidas pelo patch com fuzz zero contra a revisão upstream fixada, e sua reprodução foi comparada por hash com as fontes testadas.

| Área | Decisão |
|---|---|
| Pool `NV` | Passa a 32. Arrays por voz de filtros, osciladores, envelopes, grupos, medição e estado SUPER acompanham o tamanho. |
| Máscara de grupos | `uint32_t taken` comporta índices 0–31; `1u << 31` é unsigned. Quatro grupos UNISON de oito ocupam todos os slots e exercitam o bit 31. O limite compilado continua impedindo ultrapassar 32 com essa máscara. |
| Lista `NHELD` | Passa de 16 para 32 para reter o acorde completo e aplicar sustain, arpejo e prioridade mono. Os índices uint8 ainda comportam a capacidade. |
| Fila DSP `NQ` | Passa de 64 para 128, com margem sobre o lote de 32 note-ons/off e eventos de roteamento/transição. |
| Fila MIDI host | Passa de 64 para 128. A capacidade passa a ser compartilhada por leitor, escritor e simulador, evitando módulos antigos de 64 em um buffer maior. |
| Buffers de áudio | Mantidos: bloco interno de 256, quanta de 128 no worklet e máximo de 1024 frames no adaptador WASM. O tamanho depende do bloco, não do número de vozes. |
| Mix/DSP | Algoritmos, envelopes e efeitos preservados, com acumulação/clamps/softclip existentes. A margem foi medida no saw sem impor normalização nova. |
| Voice cards | `NCARD=8` preservado, com tabelas/modulação e LEDs originais agregados por módulo 8. O indicador WASWAN mostra 32 posições reais. |
| Restrições especiais | SUPER continua com cinco vozes globais. UNISON mantém até oito vozes por nota; partes distintas compartilham o pool maior. |

Foram alteradas na cópia apenas `firmware/src/obv_engine.h`, `tests/host.c` e `web/sim/sim.c`. Os novos limites não alteram os formatos de presets, favoritos, patterns, sessão ou perfil MIDI. Nenhuma alteração de firmware físico.

O build preserva os binários de 8, 16 e 32. Scripts aceitam somente essas etapas, e as asserções verificam capacidade de filas e de notas retidas, limite de máscara e teto SUPER. Não existe um seletor oculto de 64/128.

## Verificações executadas pelo agente

```sh
sh scripts/build-simulator.sh
node tests/polyphony-32.test.mjs
node tests/polyphony-16.test.mjs
node tests/polyphony.test.mjs
node tests/midi-profile.test.mjs
sh scripts/check-upstream.sh
```

Passaram: acordes de todos os tamanhos de 1 a 32, identificação de cada nota/slot, note-off e release; 33ª nota, roubo da mais antiga/liberada e note-off da nota roubada sem cortar sua substituta; quatro lotes sustentados de oito, sustain além do pool e liberação do pedal; DUAL de 16 notas, MONO e quatro grupos UNISON; limite SUPER de cinco; MIDI com perfil ativo, desconexão/panic e preservação dos mapeamentos.

Dois casos exercitam a nova fila: 96 mensagens no parser, com note-offs no final, e lote de 66 mensagens contendo acorde completo, sustain e note-offs. Não restaram notas presas. Rajadas arbitrárias acima de 128 continuam fora dessa garantia.

Os presets dos testes compartilhados incluem um arpejador na parte B e um pad com release longo na C. O teste de máscara desliga o arpejador pela função MIDI original apenas naquela fixture, verifica gates zerados após panic e permite a cauda longa terminar. Isso evita confundir o comportamento musical do preset com erro de alocação; os presets do usuário não são modificados.

As primeiras 16 vozes, alocadas com o pool inicialmente livre, produziram áudio estéreo idêntico amostra por amostra à etapa de 16; os parâmetros e blobs de sessão também coincidiram. Com sobreposições adicionais, menos voice stealing naturalmente muda o resultado de mix. Os testes originais de MIDI, cinco patterns e oito favoritos passaram sobre o WASM de 32.

## Custo e saída de áudio

Medição local de dez segundos de áudio, com número de notas igual ao limite:

| Métrica | 16 vozes | 32 vozes |
|---|---|---|
| Loop Node, incluindo inspeção de amostras | 176 ms | 274 ms |
| p99 de render(128) | 0,0997 ms | 0,1620 ms |
| Orçamento de 128 frames a 44,1 kHz | 2,9025 ms | 2,9025 ms |
| Pico do acorde saw | 0,4473 | 0,4473 |
| Amostras no teto de saída | 0 | 0 |
| Arrays de estado por voz auditados | 5.344 bytes | 10.688 bytes |
| Estado de notas retidas/pendentes | 640 bytes | 1.280 bytes |
| Arrays das filas DSP/MIDI | 576 bytes | 1.152 bytes |
| Memória linear WASM alocada | 1.245.184 bytes | 1.245.184 bytes |

Sem NaN/Inf no cenário medido. A memória linear permanece no mesmo número de páginas por ainda haver espaço na alocação existente; os arrays auditados crescem 6.560 bytes no total. Números locais, sem garantia universal de latência ou carga máxima de todos os patches.

## Teste no navegador

O teste mantido `tests/browser-polyphony-32.mjs` usa uma entrada MIDI de software em contexto isolado, exercitando a classe original, o perfil, o worklet e o DSP real. Não envia nada ao teclado e não depende de sua captura física.

Com o servidor local em execução, a dependência opcional de teste pode ser instalada em `.tools/browser` com `npm install --prefix .tools/browser --no-audit --no-fund playwright@1.56.1`. Execute `node tests/browser-polyphony-32.mjs`, usando o Chrome instalado em `/usr/bin/google-chrome`.

No Chrome: indicador 32/32 com áudio não nulo, relógio do motor avançando durante três segundos sustentados, pico 0,4413 e RMS 0,1900 na janela amostrada, sem valores não finitos; 33ª nota, sustain externo/da interface, release, quatro modos, UNISON de oito e preservação do perfil. Nenhuma exceção JS, layout inspecionado em 1440/390 px. Isso verifica execução e sinal; não é uma afirmação de avaliação auditiva subjetiva pelo usuário.

Evidências locais ignoradas: `.local/validation/polyphony-32-*`.

## Executar e voltar à referência

O servidor usa `http://localhost:8737/simulator/`. Recarregue, inicie e selecione POLY; a sessão de fábrica ainda abre em MONO. Para tocar pelo SMK, conecte a porta Master. O sustain da interface permite acumular grupos menores de notas.

Para servir 16 sem recompilar: `WASWAN_VOICES=16 sh scripts/stage-simulator.sh` e recarregar. Para voltar a 32: `sh scripts/stage-simulator.sh`.

**Estado:** etapa de 32 implementada e testada por software conforme a delegação do usuário. Aumento 32 → 64 requer nova autorização. Antes dele, substituir/revisar a máscara de 32 bits, ampliar/rever retenção de notas e capacidade das filas, conferir índices/buffers e repetir regressões de áudio/memória/custo. Nenhuma dessas ampliações foi implementada antecipadamente.
