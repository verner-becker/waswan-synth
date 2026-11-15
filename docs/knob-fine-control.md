# Controle fino de knobs v1

## Auditoria e decisão técnica

Base limpa e igual ao remoto: `feat/dsp-monitor`, `b2a25e5994761564f79be734ac0a5d68d3dbe353`. Branch nova: `feat/knob-fine-control`. Referências preservadas, nenhum arquivo do submódulo alterado.

O perfil distingue por porta/canal/CC e formato aprendido: absoluto usa diferença de posições; relativo offset interpreta 65/63 como +1/-1 (64 e 0 neutros); complemento de dois interpreta 1/127 como +1/-1 (0 neutro). K8 absoluto mantém conversão para passos de 24 do master. Faders usam valores absolutos, com JUMP/CATCH original.

O caminho normal envia `enc` ao `sim_enc`, que acumula eventos até o loop do firmware. Em `panel_encoders`, K1–K4 multiplicam deltas de módulo >1 por 3; parâmetros com máximo >=100 usam passo 2. Agrupamentos podem portanto produzir aceleração mesmo quando os CC chegaram separados. Controles virtuais seguem esse mesmo caminho. Cutoff interno é inteiro 0–127; `CUT_HZ[(v+8)%137]` apresenta Hz não lineares. Não alterar tabela nem filtro.

Decisão anterior à implementação: adicionar API host isolada para parâmetros diretos K1–K4. O modo fino usa o setter `set_param` original, limites e auto-record originais; não passa pela fila de encoders acelerados. Uma mensagem por gesto MIDI, sem repetição artificial de eventos. O modo normal e knobs virtuais permanecem originais. Fine em menus especiais sem parâmetro direto será recusado e indicado na UI, sem fallback acelerado. Navegação K5–K7 e master K8 continuam normais; fine não é aplicável a faders.

O contexto usa o token original `smk_fader_context` (inclui epoch de recall, página, parte, camada e foco, sem cursor móvel do sequenciador). UI redefine a referência absoluta fina quando muda o contexto e envia o token junto do delta; o host recusa token antigo e entradas enquanto navegação está pendente. Isso evita editar outro parâmetro usando referência da página anterior. Perfis v1 existentes são carregados com comportamento Normal como padrão, mantendo chave e identidade dos mapeamentos.

## Contrato do adaptador host

`waswan_knob_param(k)` retorna o parâmetro direto da tela para K1–K4, ou -1 quando a operação não se aplica. `waswan_knob_value(k)` lê o valor na mesma patch usada pelo editor (efeitos globais pertencem à parte A). `waswan_knob_context()` retorna o fingerprint original do contexto; JavaScript converte o resultado WASM i32 para uint32 (`>>> 0`), inclusive quando o bit alto está ligado.

`waswan_knob_fine(k, delta, context)` aceita inteiros entre -127 e +127, com token atual e destino válido. Chama `set_param`/`auto_rec`, invalida os mesmos elementos da UI e preserva o foco visual original. O setter mantém os limites específicos do parâmetro, incluindo limites contextuais de engine. Sem acesso direto às tabelas de frequência ou estruturas DSP.

Entradas normais continuam passando por `sim_enc`. Não se divide delta em uma série de mensagens artificiais. O host recusa fine quando há navegação/botões/pads pendentes ou Program Change MIDI ainda não processado; um gesto pode ser descartado durante transição, em vez de editar o destino anterior. A telemetria de contexto chega pela mensagem de frame existente, a aproximadamente 25 Hz. Até o novo frame chegar, tokens antigos são recusados. O cursor de transporte não faz parte desse token: tocar com sequenciador não deve reiniciar a referência absoluta a cada passo.

Telas com parâmetros diretos incluem PERFORM, osciladores, filtros, envelopes, LFO, voz, saída, arpejador e páginas de parâmetros de efeitos. K3/K4 de PART SETUP também podem ser parâmetros diretos. Menus de preset/save, camadas temporárias, sequenciador, split/layer, mixer/global/drive/super e edição especial de lanes DRUM não usam o fine v1. O painel mostra os knobs disponíveis; não faz fallback acelerado silencioso. K5–K8 permanecem Normais. Não é mudança do firmware físico: somente o wrapper host WASM recebe exports adicionais.

## Perfil e interface

Mantida a chave `waswan-midi-profile-v1`, versão 1 e os campos porta/canal/CC/destino/formato. Acrescentado `behavior: normal|fine`. Perfis anteriores sem esse campo entram em Normal; comportamento inválido ou fine em destino incompatível também usa Normal. Carregar o perfil não o regrava automaticamente. A escolha por knob é persistida quando o usuário altera a seleção.

O painel oferece comportamento ao aprender e em cada linha existente da tabela. Assim, não é necessário reaprender ou perder os mapeamentos pessoais para ativar Fino. Alterar somente o comportamento limpa a referência desse knob, sem panic de notas. O aprendizado, ativação/desativação e liberação mantêm os fluxos anteriores. Reset por desconexão/foco limpa as referências. Relativos não dependem de posição inicial absoluta: após reset, um +1 válido continua sendo +1.

## Caso reproduzido do cutoff

Cada linha começa novamente em cutoff interno 40, em PERFORM/K1:

| Delta lógico | Normal | Fino |
| ---: | ---: | ---: |
| +1 | 42 | 41 |
| +2 | 52 | 42 |
| +3 | 58 | 43 |
| -1 | 38 | 39 |
| -2 | 28 | 38 |
| -3 | 22 | 37 |

O modo fino percorre os 128 valores internos originais, sem criar valores intermediários. Passos em Hz continuam diferentes ao longo da escala; essa característica musical não é aceleração e não foi alterada. CC absoluto 40→42 significa delta +2, não uma ordem de ajustar cutoff para 42: o resultado depende do valor atual do parâmetro.

## Reproduzir

```sh
sh scripts/build-simulator.sh
node tests/knob-fine-control.test.mjs
node tests/midi-profile.test.mjs
node tests/polyphony-256.test.mjs
node tests/dsp-monitor.test.mjs
sh scripts/check-upstream.sh
# Com o servidor local ativo:
node tests/browser-knob-fine.mjs
node tests/browser-polyphony-256.mjs
node tests/browser-dsp-monitor.mjs
```

Os testes de áudio usam uma referência do wrapper da base `b2a25e5`. Se `.local/validation/knob-base-256.wasm` não existir, o teste executa `tests/build-knob-reference.sh`, que extrai somente esse wrapper do Git e recompila com o submódulo fixado e patch de 256 inalterados. Exige histórico contendo a base (clones rasos devem buscá-la). O helper não troca branches nem escreve no upstream. Também pode ser executado explicitamente para renovar a referência. Playwright/Chrome e toolchain já existentes são reutilizados; nenhuma nova dependência foi adicionada.

Os testes de navegador usam contexto separado, entrada sintética e perfil de teste. Não acessam nem modificam o localStorage do navegador pessoal, não abrem saída MIDI nem enviam SysEx. Evidências permanecem em `.local/validation/knob-fine-*`, ignoradas no Git.

## Validar no SMK-37 Pro

1. Recarregar `http://localhost:8737/simulator/`, iniciar e conectar a entrada Master habitual.
2. Abrir o perfil MIDI. Na linha do knob que controla K1, mudar **Normal → Fino**. Não precisa reaprender. Manter o formato MIDI já validado para esse knob; outros controles podem usar formatos diferentes.
3. Em PERFORM, mover um pouco para estabelecer a referência absoluta e depois avançar/recuar lentamente. Cutoff deve percorrer valores adjacentes da escala original; os Hz não terão diferença constante.
4. Fazer movimentos mais rápidos, inverter a direção e alcançar os extremos. Trocar de página/preset: o primeiro novo valor absoluto não altera o parâmetro. Repetir após desconectar/reconectar e sair/retornar à janela.
5. Voltar a Normal para comparar. Notas, pitch bend, sustain e faders devem continuar funcionando; DSP Monitor permanece disponível.

A frequência/agrupamento real de CC, reversão mecânica, sensação do knob e expressividade no teclado físico dependem dessa validação manual. Testes sintéticos não demonstram qual formato cada knob físico transmite. Não foi pressuposto que os knobs usem mensagens iguais.

## Resultados dos testes nativos

Build completo realizado com as etapas 8/16/32/64/128/256 e referência upstream, sem alteração rastreada no submódulo. O helper recompilou a referência de `b2a25e5`; referência antiga não contém a API fine e continua com pool 256.

- Perfil: varredura absoluta completa 0→127→0; +1/-1, saltos, repetição do mesmo valor, relativo 65/63 e 1/127, neutros e extremos +63/-64; faders, notas, pitch e CC64 não mapeados preservados; perfis anteriores em Normal e fine persistido.
- Host: tabela de cutoff acima, clamps 0/127, 100 incrementos e 200 decrementos sem render entre gestos, rejeição de argumentos inválidos, token antigo, contexto uint32 com bit alto, preset/página e navegação pendente por encoder, pad ou Program Change.
- Áudio: 128000 valores escalares (64000 frames estéreo) idênticos à base DSP Monitor sem edição. Outros 51200 valores escalares idênticos quando Normal +1 e Fino +2 chegam ao mesmo cutoff 42 antes da nota. Formatos/tamanhos de blobs e parâmetros iniciais conferem com a base.
- MIDI e regressões de polifonia 8/16/32/64/128/256 passaram: alocação e roubo, note-off antigo, sustain/release, pitch/modulação, perfil aprendido, presets e sessões. Na regressão nativa de 256 desta fase, dez segundos de áudio renderizaram em 1896 ms; p99 dos quanta foi 1,123 ms para orçamento 2,902 ms. Isso é um benchmark específico de Node nesta máquina, não medida de latência física.
- DSP Monitor nativo passou: agregação estatística, indisponibilidade de relógio, reboot/encerramento, comparação de 384000 valores escalares entre desligado/visível/captura. Benchmark da suíte executado sem testes de navegador/compilação concorrentes.
- Testes originais MIDI e demo passaram: cinco padrões, oito favoritos, recalls íntegros e sem gravações automáticas extras.

Evidências: `knob-fine-build.log`, `knob-reference-build.log`, `knob-fine-native.json`, `knob-fine-native.log`, `knob-fine-regressions.log` e `knob-fine-dsp-native.log` em `.local/validation/`.

## Limitações e validação física pendente

Ainda é necessário tocar com o SMK-37 Pro real para avaliar sensação e expressividade. A instrumentação de teste simula as mensagens corretas, mas não demonstra resolução mecânica, debounce ou agrupamento produzido pelo hardware. Um knob absoluto MIDI de 7 bits continua limitado aos valores que efetivamente transmite: se pular de 40 para 43, Fino recebe delta 3 e altera três unidades, sem a multiplicação do Normal. Não se interpolam movimentos inexistentes.

A proteção de contexto prefere descartar gestos durante transições. Pode ser necessário um movimento adicional para estabelecer a nova referência; a latência de atualização da UI é de aproximadamente 40 ms. Em telas indisponíveis o modo fino não altera valores: selecionar Normal para usar os controles especiais originais. O máximo do cutoff permanece 127 e os passos em Hz continuam não lineares. Não há suavização, aumento de resolução DSP, modo fine para master/faders nem alteração dos controles virtuais.

## Resultados no Chrome e entrega

Chrome 157.0.8103.78, mensagens sintéticas em contexto isolado:

- Controle fino: passou a migração Normal de perfil antigo, Normal 40 +2 =52, Fino 40 +1 =41 e depois +2 =43; decrementos, burst rápido, formatos relativos, troca de página/preset com nova referência, reconexão, blur, notas/panic, perfil fine após reload e exportação do DSP Monitor. Nenhuma exceção JS/worklet. Screenshot em 390 px inspecionado: seleção Fino visível na tabela, com rolagem horizontal da tabela preservada.
- Polifonia 256: POLY A/B 128+128, DUAL 128 notas, 257ª alocação/roubo, note-off antigo, sustain/release, MONO, UNISON8 e mapeamento preservado passaram. Progresso de áudio 4998 ms em 5000 ms, saída finita/não nula e sem exceções.
- DSP Monitor completo: início/encerramento, download JSONL, consolidação, reinício, captura oculta, limpeza e limite de 3600 janelas passaram. Captura de três minutos com 256 gates: 180 janelas, 62073 blocos, progresso de áudio 180134 ms e áudio finito/não nulo. Heap da UI após GC oscilou entre 2882728 e 3099176 bytes, terminando abaixo do valor inicial, sem crescimento persistente observado. Não é medida de toda a memória nativa do navegador.
- Benchmark do monitor repetido nesta fase, sem compilação/regressões concorrentes: consumo mediano agregado dos renderer 0,883 / 0,892 / 0,897 núcleo equivalente para desligado / visível / captura. Inclui UI; não é tempo exclusivo do DSP. Relógio do worklet permanece Date.now de resolução nominal 1 ms; violações medidas do orçamento não comprovam underruns. Não se fez nova medição física de PipeWire/latência MIDI.

Evidências adicionais: `knob-fine-browser.json`, `knob-fine-browser.log`, `knob-fine-mobile.png`, `knob-fine-poly-browser.log`, `knob-fine-monitor-browser.log`, `knob-fine-dsp.jsonl` e relatórios `dsp-monitor-*` gerados novamente pela suíte, todos em `.local/validation/`.

Git: base `b2a25e5`, implementação `7d7c449`, testes `6681d4b`, documentação em commit separado. Publicar somente `feat/knob-fine-control`, sem merge nem tag. Preservadas `main`, `feat/dsp-monitor`, `experiment/polyphony-256` e o upstream fixado. Nenhuma fase Layer ou outra expansão iniciada.

Arquivos de produção alterados: `wasm/waswan-sim.c`, `web/engine.js`, `web/midi-profile.js`, `web/midi-profile-panel.js`, `scripts/stage-simulator.sh`. Testes novos: `tests/knob-fine-control.test.mjs`, `tests/browser-knob-fine.mjs`, `tests/build-knob-reference.sh`. Documentação: este arquivo, `docs/perfil-midi.md`, `README.md`.
