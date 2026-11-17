# WASWAN Studio — onda 4: automação e finalização

Estado: concluída em software; 17 suites Node, nove Chrome e MP3 de 20 minutos passaram. Branch `feat/studio-waves`, sem integração na main.

## Implementação e decisões

Automação usa IDs musicais estáveis, independentes de `enc:*`, `fader:*`, CCs ou dispositivos. Catálogo: cutoff, ressonância, filter envelope, amp release, nível/pan/envios por parte, master, bend MIDI, modulação, pitch wheel e sustain de notas Studio. São os controles existentes, sem novos algoritmos DSP ou ampliação de polifonia.

Os valores seguem as escalas originais: cutoff continua usando sua tabela nativa; master tem 0–1023 e bend tem 14 bits assinados. Curvas não inventam resolução extra para parâmetros limitados pelo motor. Mínimo/máximo e alcance compartilhado aparecem no editor. Até 16 lanes e 2.048 pontos por lane, com interpolação linear ou step; sustain usa steps.

Curvas são lidas pelo relógio do áudio, com busca binária dos pontos e aplicação nos limites de quantum. Após Stop, o valor aplicado permanece no instrumento. Ao término natural de uma passagem, o ponto final é aplicado exatamente. Automação de parte respeita mute/solo da sequência; controles globais continuam globais. Editar/ativar/desativar lanes exige transporte parado.

O registro agora distingue três objetos: MIDI recebido, comando observado e mudança de valor efetivamente observada após processar o motor. O observador compara arrays fixos reutilizados de valores, sem criar um snapshot completo por bloco. Só funciona durante a captura. Um CC esperando pickup continua no log de entrada/comandos, mas não gera um falso ponto aplicado. A observação tem resolução de bloco, não de início acústico da nota.

Use take applied controls importa somente mudanças reais do alvo escolhido, com baseline do contexto. Overdub guarda o deslocamento de frame para alinhamento da importação; posições em loop são dobradas para o ciclo. Os dados originais da tomada permanecem disponíveis. Formatos antigos sem esse registro não são adivinhados a partir de CCs.

## Expressão e finalização

MIDI de input importado reproduz bend, modulação, sustain e all-notes-off. Bend segue o escopo compartilhado original; modulação e pitch wheel seguem a parte viva selecionada. Não foi implementado bend independente por parte. Sustain do sequenciador adia apenas seus próprios note-offs, sem alterar o pedal físico, e mantém a ordem temporal de eventos que caem no mesmo quantum. Outros CCs ficam no SMF; controles mapeados podem ser reproduzidos por lanes de valores aplicados.

Record arrangement captura uma passagem e uma cauda escolhida (0–30 s), mesmo com Loop marcado. A captura para por um frame absoluto no processador, não por timer gráfico. Inclui a entrada ao vivo e o estado atual dos efeitos; não cria uma instância de render offline nem reseta vozes/FX. Mute de monitoração e metrônomo ficam fora da gravação. Há um pequeno lead-in de preparação; a soma de lead-in, passagem e cauda deve caber em 20 minutos.

WAV continua PCM16 estéreo, 44,1 kHz. A conversão agora preserva exatamente todos os valores Q15 possíveis da saída do instrumento, incluindo a metade positiva da escala. Exportar/codificar não modifica o áudio original do projeto.

SMF conserva notas, tempo/métrica e mensagens MIDI registradas. Curvas nativas de parâmetros não são apresentadas como automação universal de outro synth: seu formato completo permanece no `.wsproj` e seu resultado sonoro no WAV/MP3.

## MP3 local e dependência

As sondagens do navegador não oferecem MP3 em MediaRecorder. WebCodecs também não fornece um alvo MP3 amplamente disponível, conforme a [documentação de codecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection). Foi escolhida uma dependência específica para esse requisito, sem framework ou CDN.

LAME/lamejs 1.2.1, commit [`582bbba6a12f981b984d8fb9e1874499fed85675`](https://github.com/zhuker/lamejs/tree/582bbba6a12f981b984d8fb9e1874499fed85675), é distribuído como arquivo separado, legível e não modificado. O [package metadata upstream](https://github.com/zhuker/lamejs/blob/582bbba6a12f981b984d8fb9e1874499fed85675/package.json) declara LGPL-3.0. Fonte e scripts correspondentes, aviso original e textos LGPL/GPL são servidos junto da aplicação em `web/vendor/lamejs/`, com atribuição e links no rodapé. Nenhuma dependência npm é instalada no runtime.

Integridade dos arquivos vendorizados:

| Arquivo | SHA-256 |
|---|---|
| `lame.all.js` | `026bd88846040f357a937cd85821a48492a362eff0812cda734f23fca55fea3b` |
| `source-582bbba6.tar.gz` | `1372e088038e2a8d86840fb85d2114830f14c7da00952f2272254e9d3644f432` |

O Worker recebe somente um WAV canônico validado, lê blocos de ~576 KiB e codifica estéreo a 192 kbps. Saída MP3 cresce até cerca de 29 MB em 20 minutos, em vez de carregar todo o PCM em um array. Há progresso e cancelamento, sem parar o synth. Converter é uma operação separada: WAV/projeto permanecem íntegros. O encoder não recebe código/URLs de projetos nem transmite áudio. Seu bundle foi inspecionado sem `eval`, construtor dinâmico ou requisições de rede.

## Validação efetivamente realizada

Evidências em `.local/validation/studio-wave-4/`.

- PASS teste de automação: interpolação, master acima de 127, limites, importação aplicada, endpoint e ordem sustain/note-off dentro de quantum. Wrapper real + WASM real observaram três tentativas de pickup e somente uma mudança para cutoff 41.
- PASS teste de PCM: roundtrip exato de todos os 65.535 valores Q15 produzíveis pelo instrumento. PASS limite de captura e parada em frame 177, com flush parcial.
- PASS browser próprio: importação de controle aplicado, curva master 500→900, captura com número exato de frames/cauda, MP3 decodificável e não nulo, WAV com mesmo SHA após MP3, cancelamento, nota física/perfil/contexto preservados e nenhuma requisição fora do servidor local. Desktop e mobile sem overflow.
- PASS MP3 longo: 1.200 segundos de PCM gerado, codificados em aproximadamente 40 s de parede, 28.800.940 bytes e todos os 45.939 frames MPEG inspecionados. Duração MPEG de 1.200,039 s. O synth real manteve quatro notas, contexto ativo e amostras finitas/não nulas durante a codificação. Heap JS da página não cresceu progressivamente; não inclui toda a memória nativa/Blob/Worker. Sem medição física de underruns.
- PASS 17 suites Node, incluindo áudio de referência, perfis/pickup, DSP Monitor e timbres. PASS nove suites Chrome: Studio, sequência, arranjo, automação, UI Foundation v1/v2, seletor, editor de timbres e 256 vozes. Decodificação MP3 introduz padding/atraso de codec; não é referência de edição com precisão de amostra.

## Registro de fechamento

- Implementado: curvas editáveis, observação de valores aplicados, render por captura com cauda e MP3 local cancelável.
- Testado: 17 suites Node, nove Chrome, MP3 longo, frames exatos e preservação de WAV/contexto/MIDI.
- Limitações: controles compartilhados seguem o motor; automação em quantum; sem ensaio físico de latência/underruns ou controlador. MP3 tem padding de codec.
- Decisões: manter um instrumento e escalas nativas, registrar mudanças aplicadas, distribuir encoder separado com fontes/licenças e não alterar presets.
- Próximo passo, onda 5: pistas de áudio com importação limitada, posicionamento, corte não destrutivo, ganho/pan e reprodução sincronizada, mantendo um instrumento.
