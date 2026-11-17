# WASWAN Studio — onda 2: sequenciador MIDI editável

Estado: concluída em software, com limitações abaixo e validação física pendente. Continuidade autorizada pelo usuário após o fechamento da onda 1. Branch `feat/studio-waves`, sem merge na main.

## Implementação e decisões

SEQ agora contém um piano roll funcional, com notas em quatro partes do instrumento, edição de pitch, início, duração e velocity, quantização explícita a 1/16 e Undo limitado a 16 estados. Os campos e a lista de notas permitem editar sem depender do canvas. A rolagem do piano roll é interna; não alarga a página em viewport de 390 px.

Transporte Studio tem BPM de 40–240, métrica 4/4, 3/4 ou 6/8, posição em compassos/batidas/ticks, comprimento, loop e metrônomo. O tempo musical usa 960 ticks por semínima. Máximo de 4.096 notas e 10.000 mensagens de expressão importadas. A duração máxima de uma passagem é 20 minutos; loop pode continuar até Stop.

`studio-clock.js` agenda por `currentFrame` no AudioWorklet do instrumento. Eventos são compilados e ordenados antes de tocar; o callback não depende de timers da UI. O comprimento fracionário do loop é preservado para evitar acumular arredondamento a cada repetição. O processamento entrega eventos no limite de um quantum (128 frames no ambiente testado), e o host mantém seu buffering de 256 frames. Isto não promete início acústico por amostra nem elimina envelopes/latência da saída.

As novas funções do host chamam as rotinas de notas já existentes com tag de propriedade Studio distinta de notas ao vivo e do sequenciador Legacy. Stop libera apenas notas Studio. Não foram alterados algoritmos DSP, limite de vozes ou submódulo. MONO/UNISON continuam compartilhando a semântica musical da parte; testes verificam retorno à nota física mantida.

O metrônomo é um nó de áudio separado, no mesmo contexto e ganho de monitoração; não entra na captura do synth. Navegar entre workspaces não inicia/para nenhum transporte. Studio recusa Play MIDI se o Legacy já estiver tocando; iniciar o Legacy explicitamente durante o Studio encerra apenas as notas Studio. O arp pode continuar respondendo à execução física; as notas programadas Studio vão diretamente ao som da parte, sem reaplicar arp.

## Projetos, importação e SMF

Projeto v1 aceita agora uma sequência opcional e áudio de zero frames quando há uma sequência válida. Save MIDI project guarda contexto e notas sem exigir uma gravação de áudio anterior. Projeto sem áudio não habilita Listen/Export WAV. Abrir outro projeto válido encerra a reprodução MIDI anterior, sem panic ou troca automática de timbre. Arquivos inválidos preservam o material atual.

Use take input notes extrai notas externas do log, com velocity e duração física de tecla, para a parte selecionada no início da gravação (ou A em projetos antigos). Não infere split/layer, alterações de parte durante a tomada, notas virtuais ou notas geradas pelo Legacy. A lista original mantém canais e dados recebidos; a importação para o editor é uma decisão musical separada e pode ser desfeita. Se não houver notas externas, a sequência atual é preservada e a interface explica a limitação.

Pitch bend e CCs importados são retidos para exportação SMF e remapeados ao destino da importação. A reprodução de expressão no browser fica para a onda 4; nesta onda, playback é de notas com os timbres vivos atuais. Pedal não é convertido em duração acústica estendida no piano roll, mas seus CCs seguem no MIDI exportado. O áudio registrado continua sendo a referência da performance.

Export MIDI produz SMF tipo 1, PPQ 960, track de tempo/métrica e quatro tracks de partes, com note-off antes de note-on no mesmo instante e comprimento final preservado. Não traduz programas WASWAN para General MIDI nem promete que um player externo tenha os mesmos timbres. Não usa biblioteca externa de MIDI.

## Testes e evidências

Evidências: `.local/validation/studio-wave-2/`. Upstream permanece fixado. Build completo executado com `scripts/build-simulator.sh`; referência pré-UI reconstruída com `tests/build-ui-reference.sh`.

- Testes de sequência verificam escalas temporais, posições musicais, limites, extração de notas/expressão e parsing independente dos tracks/eventos do SMF exportado.
- Testes do relógio verificam disparos com erro de quantização menor que um quantum no agendador, loops, não acumulação de arredondamento fracionário, liberação e rejeição de eventos inválidos/instrumento indisponível.
- Testes do host verificam quatro partes, nota ao vivo de mesma altura preservada e retorno MONO/UNISON, com rejeição de entradas fora dos limites.
- Browser próprio passou criação por clique, edição, quantização/Undo, sinal real do metrônomo, loop, navegação sem comandos, preservação de nota ao vivo, exportação SMF, projeto sem áudio e roundtrip, com uma instância de AudioContext e sem overflow mobile.
- Node: 14 suites passaram, incluindo comparações de áudio com a referência e DSP Monitor off/live/capture. Chrome: sete suites passaram — sequenciador, gravador da onda 1, UI Foundation, UI Foundation v2, tone selector, tone editor e 256 vozes. Resumos em `node-baseline.json` e `browser-baseline.json`.

## Registro de fechamento

- **Implementado:** piano roll com quatro partes, criação/edição/quantização/Undo de notas, relógio musical, BPM/métrica, loop, metrônomo, SMF e projeto com sequência opcional, inclusive sem áudio.
- **Efetivamente testado:** 14 suites Node e sete Chrome; clique real no canvas, sinal do metrônomo, notas Studio separadas de notas físicas, loop, roundtrip, limites, áudio idêntico com transporte inativo e regressões do gravador/timbres/MIDI. Corrigida a altura do piano roll que herdava o estilo global do canvas legado.
- **Limitado:** sem validação física ou garantia de início acústico por amostra; reprodução MIDI usa timbres atuais e não aplica contexto automaticamente; importação de notas externas em uma parte de destino, sem reconstruir roteamento/split/layer/arp; expressão permanece no SMF mas ainda não toca no browser. Não há editor de clipes/arranjo nesta onda.
- **Decisões:** um instrumento, propriedade de notas Studio separada, relógio de áudio, loop sem acumulação de arredondamento, metrônomo fora da captura, transporte Legacy e Studio sem concorrência e abertura de projeto sem troca de timbre.
- **Próximo passo:** onda 3 — compor por camadas com clipes, overdub e quatro pistas relacionadas às quatro partes; volume/pan serão controles compartilhados da parte, não novos motores ou efeitos independentes.
