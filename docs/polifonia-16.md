# Polifonia — etapa de 16 vozes

O usuário autorizou 8 → 16 após confirmar POLY no SMK-37 Pro. A etapa de oito foi incorporada a `main` e preservada na tag pública `v0.3.0`. A etapa atual está isolada em `feat/polyphony-16`, com testes técnicos concluídos e validação musical pelo usuário pendente. Não foram iniciadas 32, 64 ou 128 vozes.

## Revisão antes da expansão

| Área | Verificação e decisão |
|---|---|
| Alocação | `vc[NV]`, `grp_v[NPART][NV]`, `obv_voice_engine[NV]`, estado SUPER e medidores acompanham `NV`. Algoritmo e prioridades de voice stealing preservados. |
| Máscaras/índices | `group_pick` usa `uint32_t taken` e `1u << pick`; índices 0–15 cabem. `grp_v` usa uint8, também suficiente. O teste de dois grupos UNISON ocupa posições 8–15. |
| Notas retidas | `NHELD=16` comporta o pool atual. A 17ª nota e sustain além da capacidade foram testados sem notas presas. O limite não foi aumentado e precisa de revisão antes de 32. |
| Filas | `NQ=64` e fila MIDI host de 64 mensagens mantidas. Cabem 16 note-ons + 16 note-offs. Não se garante entrega sem perdas para rajadas arbitrárias acima da capacidade. |
| Buffers | Bus por parte, sends e bloco interno são dimensionados para 256 frames; saída WASM aceita até 1024. Não dependem do número de vozes. AudioWorklet continua em quanta de 128. |
| Envelopes | Cada voice_t possui envelopes de filtro/amplitude próprios. O array passa a ter 16 estados; release e liberação final foram testados além dos gates. |
| Voice cards | `NCARD=8` preservado. Pan/calibração usam módulo 8; LFO SPREAD repete as oito fases por aritmética unsigned. Display original agrega com módulo 8; indicador WASWAN mostra os 16 slots. |
| SUPER/UNISON | `SUPER_LIMIT=5` preservado. UNISON mantém máximo de oito vozes por nota, compatível com presets; dois grupos podem compartilhar as 16. |
| Mix/DSP | Mix mantém int32, intermediários int64 e clamps/softclip originais antes dos efeitos/master. Sem normalização nova ou alteração de oscilador, filtro, envelopes e efeitos. Margem medida no saw. |

As asserções da extensão verificam limite selecionado, capacidade da máscara, notas retidas e preservação de SUPER. Scripts e extensão aceitam somente 8 ou 16.

## Modificação isolada

`patches/polyphony-16.patch` altera somente `NV` de 8 para 16 em `firmware/src/obv_engine.h`. `scripts/prepare-wasm-source.py` aplica o patch com fuzz zero em `.local/build/source-16/`, cópia descartável das fontes necessárias. A comparação das cópias confirmou apenas essa diferença. O submódulo original permanece intacto.

O build gera a referência original e as extensões host de oito e 16. Esta branch serve 16 por padrão. O indicador consulta o limite real do WASM, sem presumir oito. O novo **Sustain MIDI** usa o mesmo estado e função de aplicação do CC64 original, permitindo acumular notas sem pressionar todas simultaneamente. A opção acompanha CC64 externo e é liberada pelos caminhos existentes de Soltar tudo, troca de modo, perda de foco e desconexão.

| Modo | Limite com pool livre |
|---|---|
| POLY / ANALOG comum | 16 notas, uma voz por nota |
| DUAL | 8 notas, duas vozes por nota |
| MONO | Uma nota |
| UNISON | Uma nota por parte, até oito vozes sobrepostas |
| SUPER | Cinco vozes globais, incluindo release |

O pool é compartilhado entre A–D. Presets, sessão de fábrica e perfil MIDI mantêm formato e chaves. O saw da sessão de fábrica ainda inicia em MONO: selecione POLY. Todos os parâmetros/blobs foram comparados entre oito e 16, assim como áudio idêntico nas primeiras oito vozes alocadas com pool inicialmente livre. Com notas/caudas adicionais, há menos roubo de vozes e o áudio pode diferir. Os cinco patterns continuam funcionando, com energias diferentes da versão de oito nesses cenários.

## Testes e custo

```sh
sh scripts/build-simulator.sh
node tests/polyphony-16.test.mjs
node tests/polyphony.test.mjs
node tests/midi-profile.test.mjs
sh scripts/check-upstream.sh
python3 scripts/serve-simulator.py
```

O novo teste cobre 1–16 notas, 17ª nota, prioridade da mais antiga/liberada, note-off de nota roubada, dois lotes sustentados de oito, pedal-up, retriggers, slots superiores, grupos compartilhados, DUAL/MONO/UNISON, teto SUPER, áudio/presets/sessão e desconexão com perfil MIDI ativo. Os testes anteriores e os testes MIDI/musicais originais também passaram.

Medição local de dez segundos, com número de notas igual ao limite e blocos de 128 frames:

| Métrica | 8 vozes | 16 vozes |
|---|---|---|
| Loop Node, incluindo inspeção de amostras | 129 ms | 174 ms |
| p99 de render(128) | 0,0747 ms | 0,0998 ms |
| Orçamento de 128 frames a 44,1 kHz | 2,9025 ms | 2,9025 ms |
| Pico do acorde saw | 0,4456 | 0,4473 |
| Amostras no teto de saída | 0 | 0 |
| Arrays de estado por voz auditados | 2.672 bytes | 5.344 bytes |
| Memória linear WASM alocada | 1.245.184 bytes | 1.245.184 bytes |

O estado cresce 2.672 bytes; a memória linear permanece no mesmo número de páginas WASM. Números locais desse cenário, sem garantia de latência física ou ausência de xruns sob qualquer carga.

No Chrome, fonte MIDI sintética validou 16/16, 17ª nota, sustain externo/da interface, release, modos, UNISON de oito e preservação do mapeamento. Áudio ativo a 44,1 kHz, sem exceções JS; layout inspecionado em 1440/390 px. Evidências locais: `.local/validation/polyphony-16-*`, ignoradas pelo Git.

## Validação musical no SMK-37 Pro

1. Recarregue `http://localhost:8737/simulator/`, inicie, conecte Master e selecione POLY na parte A, com a janela em foco. Sequenciador parado, sem LAYER e MIDI CH em OMNI simplificam o teste.
2. Marque **Sustain MIDI**. Toque oito notas, solte as teclas e toque outras oito diferentes; grupos menores também servem. O indicador deve atingir 16/16 com som estável.
3. Uma 17ª nota deve substituir uma antiga, mantendo 16/16. Desmarque sustain; deve retornar a zero após o release. A reverb pode continuar sem ocupar vozes.
4. Compare os modos e confira o saw e os knobs. Repita perda de foco, Soltar tudo e desconexão durante sustain; não devem restar notas presas.

O limite de captura física do SMK não foi medido. O usuário levantou essa possibilidade; não foi encontrado número explícito nas [notas oficiais consultadas](https://yms-file-store.oss-cn-hongkong.aliyuncs.com/software/firmware/SMK-37Pro/SMK37Pro.txt). Captura física, polifonia interna do teclado e polifonia do WASWAN no computador são limites distintos. O sustain da interface contorna uma eventual restrição de teclas simultâneas. Uma captura MIDI pura pode investigar o hardware posteriormente, sem alterar firmware.

Para servir oito sem recompilar: `WASWAN_VOICES=8 sh scripts/stage-simulator.sh` e recarregar. Para retornar a 16: `sh scripts/stage-simulator.sh`. A tag `v0.3.0` preserva a entrega de oito validada.

**Estado:** teste musical adiado pelo usuário; simulador de 16 iniciado e aberto para teste a pedido dele. Testes técnicos feitos por software, sem depender da captura simultânea do teclado. A etapa 16 → 32 requer nova autorização explícita após validação.
