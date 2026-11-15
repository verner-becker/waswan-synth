# Polifonia — etapa de 128 vozes

A etapa de 64 foi aprovada e preservada em `main` e na tag `v0.6.0`. A autorização seguinte abriu `feat/polyphony-128`, mantendo os testes sob responsabilidade do agente. Esta entrega alcança o limite alvo de 128; não inicia outra expansão.

## Revisão e implementação

| Área | Decisão |
|---|---|
| Pool e notas retidas | `NV=128` e `NHELD=128`. Arrays por voz acompanham o limite; índices uint8 cobrem 0–127 e contadores comportam 128. Revisados sustain, notas pendentes, prioridade mono e ordenação do arpejador. |
| Máscara de alocação | `voice_mask_t` contém quatro palavras uint32. A seleção consulta `word[v >> 5]` e desloca somente por `v & 31`, evitando deslocamentos acima da largura da palavra. |
| Filas | `NQ=512` e capacidade MIDI host de 512, com leitura/escrita coerentes e asserções de capacidade para acordes completos, controles e note-offs. |
| Buffers e envelopes | Mantidos blocos internos de 256 frames, worklet de 128 e máximo WASM de 1024. Osciladores, filtros, envelopes, efeitos e mistura originais preservados. |
| Limites especiais | DUAL oferece até 64 notas no pool livre; UNISON continua limitado a oito vozes por nota e SUPER a cinco globais, incluindo a transição de um pool cheio. |
| Formatos | Presets, sessão, favoritos, patterns e perfil MIDI preservados. Os oito perfis originais de pan/vintage/LFO continuam repetidos por módulo 8. |

`patches/polyphony-128.patch` altera apenas a cópia de compilação de `firmware/src/obv_engine.h`, `tests/host.c` e `web/sim/sim.c`. O submódulo original e o firmware físico permanecem intactos. As referências de 8/16/32/64 são compiladas separadamente para regressão.

MIDI ao vivo aceita todas as 128 notas, inclusive 0 e 127. O sequenciador mantém seu formato original de quatro notas por passo e reserva zero como vazio. A ampliação do pool não altera esse formato nem os limites de UNISON/SUPER. O indicador WASWAN acompanha os 128 slots reais do WASM.

## Verificações concluídas

```sh
sh scripts/build-simulator.sh
node tests/polyphony-128.test.mjs
node tests/polyphony-64.test.mjs
node tests/polyphony-32.test.mjs
node tests/polyphony-16.test.mjs
node tests/polyphony.test.mjs
node tests/midi-profile.test.mjs
sh scripts/check-upstream.sh
```

Todos passaram, incluindo:

- Acordes de 1 a 128, notas 0–127 simultâneas, note-offs e término dos envelopes.
- Retocar uma nota com POLY cheio e forçar alocações adicionais com DUAL: 64 notas ocupam 128 vozes; uma 65ª nota válida rouba duas. Note-off antigo não desliga a substituta. Não se inventa uma nota MIDI 128.
- Sustain acumulado em 16 grupos de oito, liberação integral de 128 notas, lotes de 384 mensagens e sequência de 258 eventos contendo acorde, pedal e note-offs, sem notas presas.
- Grupos UNISON atravessando as fronteiras 31/32, 63/64 e 95/96 e atingindo o slot 127; quatro grupos superiores simultâneos sem colisões.
- MONO com 128 notas retidas e retorno de prioridade; arpejador com 128 notas e quatro oitavas alcançando 0 e 127; SUPER limitado a cinco, inclusive após POLY cheio.
- Primeiras 64 alocações com pool livre produzindo áudio idêntico, amostra por amostra, à referência de 64; parâmetros e blobs de sessão iguais.
- Perfil MIDI, pitch bend e modulação sob 128 vozes, desconexão/panic com sustain e preservação dos mapeamentos.

As regressões das etapas anteriores e os testes MIDI/musicais originais também passaram. A maior sobreposição de caudas pode mudar a execução de patterns por reduzir o voice stealing; seus dados continuam preservados.

## Processamento e memória

Última medição local de dez segundos com tantas notas quanto o limite:

| Métrica | 64 vozes | 128 vozes |
|---|---|---|
| Loop Node, incluindo inspeção de amostras | 478 ms | 920 ms |
| p99 de render(128) | 0,2892 ms | 0,6411 ms |
| Orçamento de 128 frames a 44,1 kHz | 2,9025 ms | 2,9025 ms |
| Pico do saw | 0,4473 | 0,4473 |
| Amostras no teto de saída | 0 | 0 |
| Arrays por voz auditados | 21.376 bytes | 42.752 bytes |
| Notas retidas/pendentes | 2.560 bytes | 5.120 bytes |
| Arrays das filas DSP/MIDI | 2.304 bytes | 4.608 bytes |
| Memória linear WASM | 1.310.720 bytes | 1.310.720 bytes |

Os arrays auditados crescem 26.240 bytes, absorvidos pela folga existente nas páginas de memória WASM. Sem NaN/Inf ou saturação de saída no saw medido. Estes números descrevem esta máquina e este teste; não medem latência física nem o pior custo de todo preset.

## Navegador e execução local

Com o servidor ativo e Playwright preparado conforme a etapa de 32, execute `node tests/browser-polyphony-128.mjs`. O teste usa uma fonte MIDI de software em contexto isolado e não altera o armazenamento do navegador pessoal.

Chrome confirmou 128/128, relógio avançando durante três segundos sustentados, áudio finito/não nulo a 44,1 kHz, pico 0,4473 e RMS 0,2478. Passaram voice stealing em DUAL cheio, sustain/release, os quatro modos, UNISON de oito e preservação do perfil. Nenhuma exceção JavaScript; painel comportado em telas de 1440 e 390 px. Evidências locais ficam em `.local/validation/polyphony-128-*`, ignoradas pelo Git.

O servidor foi conferido em **http://localhost:8737/simulator/**: o WASM servido informa 128 vozes, máscara de 128 bits e fila MIDI de 512. Recarregue, inicie, conecte SMK-37 Pro-Master e selecione POLY. Para experimentar sem pressionar 128 teclas, use Sustain MIDI e acumule notas diferentes. A validação técnica foi feita por software conforme autorizado; a avaliação auditiva subjetiva do usuário nesta etapa ainda não foi registrada.

Para servir a referência de 64 sem recompilar: `WASWAN_VOICES=64 sh scripts/stage-simulator.sh`. Para voltar a 128: `sh scripts/stage-simulator.sh` e recarregar.

## Ciclo Git

Implementação e testes publicados no commit `1ee840b`, seguido pelo relatório desta etapa na mesma branch. A entrega de 64 continua preservada em `main`/`v0.6.0`; a etapa de 128 fica disponível para aprovação antes de incorporá-la a main/tag. Não há alterações acima de 128 nem infraestrutura nova de CI/CD.
