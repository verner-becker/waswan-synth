# WASWAN Studio — onda 5: clipes de áudio

Estado: concluída em software; 18 suites Node e onze Chrome passaram na branch `feat/studio-waves`, sem integração na main.

## O que foi implementado

Importar WAV, reaproveitar uma tomada gravada como fonte, posicionar em beats, cortar início/fim sem alterar a fonte, duplicar/apagar regiões, ganho, balanço estéreo e mute por clipe. A visão de regiões mostra duração e os picos da importação; a lista e os campos permitem edição sem depender do canvas. O Undo da composição também cobre regiões. Remover fontes sem uso limpa o histórico para não ressuscitar referências removidas.

Os clipes acompanham o mesmo transporte MIDI, em passagem única ou loop. Record arrangement inclui synth + clipes de áudio, preservando a exclusão do metrônomo e do mute de monitoração. Ganho de clipe é independente do master do synth. WAV/MP3 da composição são o resultado dessa captura; SMF contém somente MIDI.

Projeto `.wsproj` v2 inclui fontes PCM em binário, com manifesto validado e regiões não destrutivas. Não usa base64 de áudio nem caminhos externos. A leitura de v1 permanece disponível. Abrir/recuperar projeto não aplica timbres, mixer ou mapeamentos ao instrumento.

Save browser composition grava uma cópia completa em OPFS, com troca ao fechar o writer. Recover browser composition reabre essa cópia, incluindo fontes e regiões. É salvamento explícito, separado de Recover local take, que recupera a gravação progressiva. Exportar um projeto fornece a cópia portátil; OPFS depende do perfil/origem do navegador e pode ser apagado pelo usuário/browser.

## Decisões e limites

- PCM16 WAV, mono ou estéreo, 44,1 kHz. Mono é duplicado para estéreo; WAV estéreo conserva cada amostra. Sem decoder genérico, resampling, MP3 importado ou extensões WAV executáveis.
- Até quatro fontes, total de 120 segundos; até 32 regiões e 240 segundos somados antes de considerar sobreposição. Arranjos contendo áudio também têm até 120 segundos. MIDI/tomada sem regiões de áudio conserva o limite anterior de 20 minutos.
- Posição segue beats; offset e duração da fonte seguem frames. Mudar BPM reposiciona o início sem esticar a fonte. Uma região que ultrapassa o fim faz a edição ser recusada. Balanço central preserva os dois canais; extremos atenuam o lado oposto. Sobreposições podem saturar: reduzir ganho é uma decisão musical do usuário.
- Importação e mistura preparatória ocorrem em Worker. Com esses limites, foi escolhida uma mistura limitada em buffer, em vez de acrescentar agora streaming de disco e cache de decodificação. O buffer estéreo máximo tem cerca de 42,3 MB; fontes PCM totalizam cerca de 21,2 MB, além de cópias temporárias, memória do navegador e do synth. Não há promessa de memória total abaixo desses dois números.
- AudioBufferSourceNode agenda uma mistura no mesmo AudioContext e frame absoluto do transporte. Não usa timers gráficos para disparar regiões. Com áudio, o ciclo MIDI usa a duração inteira de frames do buffer; a diferença para o tempo musical ideal é menor que uma amostra por ciclo. Sem áudio, preserva o relógio fracionário anterior.
- O bus de captura soma synth e clipes em paralelo ao caminho de escuta existente. Há um instrumento/WASM/AudioContext. Navegar workspaces não muda conexões, presets ou notas. Stop cancela apenas fontes/vozes Studio; cancelar a preparação termina o Worker.
- Importados são tratados como dados: limites antes da alocação, RIFF e chunks conferidos, no máximo 256 chunks, um fmt/data, PCM/layout/duração válidos. Projeto verifica nomes/IDs, referências, limites das regiões, tamanhos e cabeçalhos das fontes; truncamento e bytes extras são recusados. Sem rede ou dependências adicionais.
- Sem time stretch, plugins, gravação de microfone, fades/crossfades, mixer de grupos ou automação dos próprios clipes. Picos de waveform são uma ajuda visual da importação, não parte necessária do arquivo; após reabrir, a visão conserva as regiões e suas durações.

## Formato v2

A assinatura ASCII é `WASWAN-STUDIO-2\n`, seguida de uint32 little-endian com o tamanho do JSON UTF-8 (até 16 MiB), o JSON, o WAV canônico da tomada (44 + frames × 4 bytes) e os WAVs das fontes na ordem de `assets`. Não há padding entre esses objetos. A assinatura v1 e seu layout sem fontes continuam aceitos. A versão da assinatura deve coincidir com `project.version`.

`project.assets` contém `{id, name, frames, bytes}`. `sequence.audioClips` contém `{id, asset, start, offset, frames, gain, pan, mute}`: `start` em ticks PPQ 960, `offset` e `frames` em frames da fonte; `asset` referencia o ID no manifesto. Ganho varia de 0 a 2, balanço de −1 a 1. Todo áudio binário do projeto é WAV PCM16 estéreo em 44,1 kHz. Há rejeição de referências ausentes, clipes fora dos limites, duração excessiva e arquivo truncado ou com sobra. Fontes e tomada não são reescritas por edições nas regiões.

## O que foi efetivamente testado

Evidências em `.local/validation/studio-wave-5/`.

- PASS 18 suites Node: WAV mono/estéreo e formatos rejeitados, limites, posição/corte/mistura por amostra, sobreposição, manifesto v2, fontes idênticas, truncamento, versões anteriores e regressões MIDI, pickup, timbres, 256 vozes, DSP Monitor e áudio de referência.
- PASS ensaio Chrome inicial: pulso importado/cortado em 1.000 frames, ganho 0,5 e balanço direito produziram exatamente 64 frames com valor 4.096 no canal direito e zero no esquerdo, no deslocamento esperado. Todo o restante da captura ficou em zero, mesmo com metrônomo ativo. Deadline e tamanho exatos. Projeto conservou o WAV fonte byte a byte.
- PASS ensaio inicial de loop, início comum áudio/relógio MIDI, navegação sem comandos, projeto v2, falha de importação preservando a composição e recuperação OPFS após reload. Desktop e mobile sem overflow.
- PASS rodada final com camada MIDI simultânea, nota de entrada simulada preservada após Stop, e onze suites Chrome: áudio, carga, automação, arranjo, sequência, gravação, UI Foundation v1/v2, timbres e 256 vozes.
- PASS carga: quatro fontes somando 120 s, oito regiões somando 240 s, mistura de 5.292.000 frames, validação de amostras finitas e recusa de orçamento excedido. Importação/mistura em aproximadamente 394 ms; intervalo máximo observado do timer da página de 18 ms. O synth manteve quatro notas e contexto running. Isso não mede toda a memória nem certifica underruns físicos.
- Nenhuma validação de controlador, interface ou saída de áudio físicos.

## Registro de fechamento

- Implementado: regiões de áudio, reprodução/captura sincronizadas, projeto v2 com fontes e cópia local recuperável.
- Testado: 18 suites Node, onze Chrome, carga nos limites, comparação de cada amostra do pulso e recuperação após reload.
- Limitado: PCM16/44,1 kHz e orçamentos explícitos; sem recursos de áudio avançados; validação física pendente.
- Decisões: manter um instrumento, usar Worker e buffers limitados, preservar fontes, manter leitura v1 e salvamento local explícito.
- Próximo passo: avaliação musical física pelo usuário com o [roteiro de uso](studio-guide.md); corrigir eventuais achados e só integrar na main mediante aprovação explícita.
