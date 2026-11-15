# Experimento — 256 vozes

O usuário autorizou tentar 256 vozes e executar os testes, admitindo a possibilidade de falha. O experimento está em `experiment/polyphony-256`, derivada de `00293b3`. A referência de 128 permanece em `feat/polyphony-128`; main/tag `v0.6.0` continuam preservando 64. Não houve incorporação do experimento a main.

**Resultado:** passou nos testes automatizados e no Chrome local. Há 256 slots de voz utilizáveis, incluindo o índice 255. Isso não cria notas MIDI acima de 127 nem 256 alturas distintas por parte.

## Revisão e decisões

| Área | Decisão experimental |
|---|---|
| Pool | `NV=256`; arrays por voz acompanham o limite. |
| Máscara | Oito palavras uint32, totalizando 256 bits; deslocamentos continuam limitados a 0–31 por palavra. |
| Índices | `grp_v` uint8 ainda cobre 0–255. Asserção impede um pool acima de 256 sem nova revisão do tipo. Contadores de alocação e laços usam uint32/unsigned. |
| Teclas retidas | `NHELD=128` por parte: existem 128 alturas MIDI e a lista elimina repetições. O pool maior é compartilhado por quatro partes e por camadas/caudas. Não há motivo para aumentar a lista para 256 e provocar overflow nos contadores uint8 de liberação e notas pendentes. Asserções separam capacidade de teclas e capacidade de vozes. |
| Filas | DSP e MIDI host passam a 1024 eventos; leitura/escrita usam a mesma capacidade. Asserções verificam espaço para on/off do pool e pedal. |
| Áudio | Blocos internos de 256 frames, worklet de 128 e render máximo de 1024 preservados. Envelopes, osciladores, filtros, mix e efeitos originais. Acumulação em int32 e multiplicações largas existentes preservadas; nenhuma normalização nova. |
| Limites especiais | UNISON continua em oito vozes por nota, SUPER em cinco globais; DUAL permite 128 notas no pool livre. |
| Persistência | Formatos de presets, sessão, patterns, favoritos e perfil MIDI intactos. A interface limita a descrição de alturas por parte a 128, mesmo quando há 256 slots. |

`patches/polyphony-256.patch` altera somente a cópia de compilação de três arquivos: `firmware/src/obv_engine.h`, `tests/host.c` e `web/sim/sim.c`. O submódulo fixado e o firmware físico permanecem intactos. Os binários de 8/16/32/64/128 são reconstruídos separadamente.

O caminho original de entrada do painel libera a dona anterior de uma tecla repetida. Repetir 128 note-ons pela entrada OMNI não é um teste válido de 256 gates POLY. Os testes usam a configuração original GLOBAL → MIDI CH = 1: canal 1 na parte A, canal 2 diretamente na parte B, ambas com o INIT saw. Assim são 128 notas em cada parte, sem alterar o roteamento do motor. Esses ajustes existem apenas nas sessões isoladas dos testes; não alteram o armazenamento pessoal do usuário.

O formato do sequenciador continua com quatro notas por passo e zero reservado para vazio. As 128 alturas, incluindo zero, continuam válidas na entrada MIDI ao vivo.

## Testes executados

```sh
sh scripts/build-simulator.sh
node tests/polyphony-256.test.mjs
node tests/polyphony-128.test.mjs
node tests/polyphony-64.test.mjs
node tests/polyphony-32.test.mjs
node tests/polyphony-16.test.mjs
node tests/polyphony.test.mjs
node tests/midi-profile.test.mjs
sh scripts/check-upstream.sh
# Com servidor ativo e Playwright local, conforme a etapa de 32:
node tests/browser-polyphony-256.mjs
```

Todos passaram:

- Ocupação progressiva de 1 a 256 em POLY, duas partes com 128 notas, slots e sequências distintos, note-off e release de todo o pool.
- 257ª alocação efetiva por canal B, roubo da mais antiga e note-off da nota roubada sem desligar sua substituta; vozes em release são reutilizadas antes das sustentadas.
- 128 notas DUAL ocupando 256 vozes; nova nota em outra parte força dois roubos. Sustain acumulado em grupos de oito, pedal-up e desconexão sem notas presas.
- Note-off na parte B preservando as mesmas alturas na parte A.
- Grupos UNISON cruzando 31/32, 63/64, 95/96, 127/128, 159/160, 191/192, 223/224 e ocupando 248–255. Quatro grupos nas 32 posições superiores, sem colisões e com panic/release completos.
- Lote de 768 mensagens com note-offs no final; lote de 514 eventos de acorde/pedal/note-off. Transição de 256 vozes para SUPER mantém cinco globais.
- Primeiras 128 vozes com áudio estéreo idêntico, amostra por amostra, à referência de 128, mesmos parâmetros e blobs de sessão.
- Pitch bend, modulação, perfil aprendido e desconexão/panic com 256 vozes DUAL.
- Regressões das etapas anteriores, incluindo MONO e arpejador; testes MIDI e musicais originais executados sobre o WASM experimental, preservando cinco patterns, oito favoritos e ausência de gravação automática.

O teste de navegador é separado das entradas das etapas anteriores. Usa MIDI de software em contexto isolado, sem abrir saída MIDI nem acessar o teclado físico. Confirmou POLY 128+128, DUAL 128, roubo efetivo em ambos, note-off antigo, sustain/release, MONO, UNISON de oito e perfil preservado. O relógio do motor avançou 4.998 ms durante espera de 5.000 ms. Áudio a 44,1 kHz, pico 0,4473, RMS 0,2828, amostras finitas e não nulas; nenhuma exceção JavaScript ou erro reportado pelo worklet. Capturas em 1440 e 390 px; painel com 362 px no viewport de 390.

## Custo medido

Dez segundos de saw sustentado; 128 na parte A versus 128+128 em A/B:

| Métrica | 128 vozes | 256 vozes |
|---|---|---|
| Loop Node, incluindo inspeção das amostras | 919 ms | 1.810 ms |
| p99 de render(128) | 0,5582 ms | 1,1346 ms |
| Orçamento de 128 frames a 44,1 kHz | 2,9025 ms | 2,9025 ms |
| Pico do saw | 0,4473 | 0,4473 |
| Amostras no teto de saída | 0 | 0 |
| Arrays por voz auditados | 42.752 bytes | 85.504 bytes |
| Notas retidas/pendentes | 5.120 bytes | 5.120 bytes |
| Arrays das filas DSP/MIDI | 4.608 bytes | 9.216 bytes |
| Memória linear WASM | 1.310.720 bytes | 1.376.256 bytes |

Os arrays auditados crescem 47.360 bytes; a memória linear cresce uma página de 65.536 bytes. A medição indica margem de processamento nesta máquina para o saw testado. Não mede latência física, underruns do PipeWire nem o pior caso de todos os presets. A maior soma de vozes pode acionar mais o softclip original; nenhum ganho ou limitador foi alterado para mascarar o custo ou mudar o timbre. A avaliação auditiva subjetiva do usuário nesta etapa ainda não foi registrada.

Evidências locais ignoradas pelo Git: `.local/validation/polyphony-256-native.log`, `polyphony-256-benchmark.json`, `polyphony-256-browser.json` e capturas `polyphony-256-*.png`.

## Executar e retornar à referência

O servidor local continua em **http://localhost:8737/simulator/**. Recarregue, inicie e selecione POLY para o teste normal no SMK-37 Pro; mantenha OMNI se estiver tocando somente a parte selecionada. O indicador mostra o pool de 256 e conta também release. Para preencher todo o pool com notas sustentadas, os testes de software acima usam duas partes POLY ou DUAL com 128 alturas.

Para servir novamente a referência de 128 sem recompilar:

```sh
WASWAN_VOICES=128 sh scripts/stage-simulator.sh
```

Para retornar ao experimento: `sh scripts/stage-simulator.sh` e recarregar. O build desta branch serve 256 por padrão. Nenhuma expansão acima de 256 está implementada ou autorizada; exigiria, entre outras revisões, ampliar os índices de grupo além de uint8.
