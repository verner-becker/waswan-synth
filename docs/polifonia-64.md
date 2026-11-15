# Polifonia — etapa de 64 vozes

O usuário aprovou 32 → 64, mantendo os testes sob responsabilidade do agente e solicitando o ciclo Git em todas as fases. A entrega de 32 foi incorporada a `main` e preservada na tag pública `v0.5.0`. Esta etapa está isolada em `feat/polyphony-64`. Não foi iniciada a etapa de 128.

## Revisão e implementação

| Área | Decisão nesta etapa |
|---|---|
| Pool | `NV=64`; arrays de estado por voz acompanham o limite. |
| Máscara de alocação | A máscara original de 32 bits foi substituída, somente no estágio de 64, por `voice_mask_t` do tipo uint64. O bit é formado por `(voice_mask_t)1u << pick`, e a asserção verifica que a largura cobre o pool. Isso evita deslocamentos inválidos nos slots 32–63. |
| Notas retidas | `NHELD=64`, abrangendo acordes, sustain, prioridade mono e ordenação do arpejador. Os índices uint8 comportam 0–63. |
| Filas | Fila DSP `NQ=256` e MIDI host de 256, com leitura e escrita usando a mesma capacidade. As asserções exigem espaço para um lote completo de note-ons/offs e controles. |
| Buffers | Mantidos blocos internos de 256 frames, worklet de 128 e máximo WASM de 1024; não dependem do número de vozes. |
| Envelopes/DSP | Estado independente por voz, com os mesmos osciladores, filtros, envelopes, mix, efeitos e clamps/softclip. Nenhuma normalização nova. |
| Restrições especiais | SUPER mantém cinco vozes globais; UNISON mantém até oito sobre a mesma nota. DUAL permite 32 notas no pool livre. |
| Voice cards | Oito perfis originais de pan/vintage/LFO continuam repetidos por módulo 8. LEDs originais agregados; indicador WASWAN mostra 64 posições. |

`patches/polyphony-64.patch` altera somente a cópia de compilação de `firmware/src/obv_engine.h`, `tests/host.c` e `web/sim/sim.c`. O submódulo de referência não foi editado. O novo tipo da máscara existe apenas nessa cópia; os binários de referência de 8/16/32 preservam suas implementações.

Formatos de presets, sessão, favoritos, patterns e perfil MIDI não mudaram. Não houve alteração de firmware físico. O build gera referências das etapas anteriores para regressão e serve 64 por padrão nesta branch. Scripts só aceitam 8, 16, 32 ou 64; 128 continua bloqueado.

## Verificações concluídas

```sh
sh scripts/build-simulator.sh
node tests/polyphony-64.test.mjs
node tests/polyphony-32.test.mjs
node tests/polyphony-16.test.mjs
node tests/polyphony.test.mjs
node tests/midi-profile.test.mjs
sh scripts/check-upstream.sh
```

Passaram:

- Acordes de cada tamanho entre 1 e 64, slots/notas distintos, note-offs e liberação dos envelopes.
- 65ª nota, roubo da mais antiga/liberada e note-off da nota roubada preservando sua substituta.
- Oito lotes de oito com sustain, liberação do pedal, contagem retida completa e fim das caudas.
- Lote de 192 mensagens com note-offs no final e lote de 130 contendo acorde completo, pedal e note-offs. Nenhuma nota presa.
- Bit 63: ocupação inicial de 32 vozes POLY e quatro grupos UNISON de oito nas posições superiores, totalizando 64 sem colisões de alocação. Gates liberados após panic e caudas longas terminando conforme os presets.
- DUAL com 32 notas, MONO com prioridade/retorno de nota e teto SUPER preservado em cinco.
- Arpejador original com 64 notas retidas e quatro oitavas, alcançando a nota 123 e liberando tudo ao soltar as teclas.
- Áudio estéreo idêntico à referência de 32 nas primeiras 32 vozes alocadas com pool livre, mesmos parâmetros e blobs de sessão.
- 64 notas pelo perfil MIDI, pitch bend e modulação sob carga, desconexão/panic com sustain e preservação dos mapeamentos.

Os testes das etapas anteriores e os testes MIDI/musicais originais também passaram sobre os binários correspondentes. Patterns podem soar diferentes com mais sobreposição de vozes/caudas, por haver menos voice stealing; seus dados não são reescritos.

## Processamento e memória

Medição local de dez segundos, com número de notas igual ao limite; outros testes também estavam em execução nesta sessão:

| Métrica | 32 vozes | 64 vozes |
|---|---|---|
| Loop Node, incluindo inspeção de amostras | 307 ms | 545 ms |
| p99 de render(128) | 0,2545 ms | 0,4805 ms |
| Orçamento de 128 frames a 44,1 kHz | 2,9025 ms | 2,9025 ms |
| Pico do saw | 0,4473 | 0,4473 |
| Amostras no teto de saída | 0 | 0 |
| Arrays por voz auditados | 10.688 bytes | 21.376 bytes |
| Notas retidas/pendentes | 1.280 bytes | 2.560 bytes |
| Arrays das filas DSP/MIDI | 1.152 bytes | 2.304 bytes |
| Memória linear WASM | 1.245.184 bytes | 1.310.720 bytes |

Os arrays auditados crescem 13.120 bytes. A memória linear aumenta uma página de 65.536 bytes, considerando o arredondamento da alocação WASM. Sem NaN/Inf ou saturação de saída no saw medido. Os números não são uma garantia de latência física ou custo máximo de todo preset.

## Navegador e reprodução

O teste de navegador foi compartilhado em `tests/browser-polyphony.mjs`, mantendo `tests/browser-polyphony-32.mjs` como entrada compatível e acrescentando a de 64. Usa MIDI de software em contexto isolado; não depende de teclas físicas nem altera o perfil real do usuário.

Com o servidor ativo e Playwright instalado localmente conforme a etapa anterior, execute `node tests/browser-polyphony-64.mjs`. O Chrome confirmou 64/64, relógio do motor avançando durante três segundos sustentados, áudio finito/não nulo a 44,1 kHz, pico 0,4473 e RMS 0,2057 na janela amostrada. Também passaram 65ª nota, sustain/release, modos, UNISON de oito e preservação do perfil. Nenhuma exceção JS; interface inspecionada em 1440/390 px. Evidências locais ignoradas em `.local/validation/polyphony-64-*`.

O servidor local serve `http://localhost:8737/simulator/`. Recarregue, inicie e selecione POLY. Os testes técnicos/musicais de sinal foram feitos por software, conforme a delegação do usuário; não se afirma uma avaliação auditiva subjetiva dele para esta etapa.

Para retornar à referência de 32 sem recompilar: `WASWAN_VOICES=32 sh scripts/stage-simulator.sh` e recarregar. Para servir 64 novamente: `sh scripts/stage-simulator.sh`.

## Ciclo Git e limite da fase

A aprovação de uma fase fecha sua entrega em main/tag, e a próxima autorização abre uma branch isolada. Implementação, testes e relatório são registrados em commits descritivos e publicados; esse ciclo passa a integrar todas as etapas, sem nova solicitação do usuário.

**Estado:** 64 implementadas e validadas por software, sem 128. Antes de 64 → 128 será necessário revisar a máscara novamente, pois uint64 não cobre 128 posições, além de notas retidas, filas, índices, limites de notas MIDI, memória e custo de DSP. O aumento exige nova autorização explícita.
