# DAW — fase 7: mixagem, FX, automação e exportações

Branch `feat/daw-wave-7-mix-export`, pai `6ea5dff20a89300e0eb0ae6e8afae6a3d7e34669`. A entrega de madrugada foi registrada em `cd9d306`. A retomada completou os caminhos de exportação de áudio e presets.

## Escopo e resultado

SPEC9/10/11: sete FX independentes com reordenação/bypass/parâmetros e persistência, Master L/R/clipping, automação Volume/Pan desenhada/Undo e exportações de mix, intervalo, clipes e trilha em WAV ou MP3, além de stems WAV e exportação SMF.

Implementadas cadeias independentes em cada trilha e no Master: EQ três bandas, compressor, reverb, delay, chorus, limiter e saturation. Parâmetros, ordem e bypass pertencem ao projeto e passam por Undo/Save/Open. Reordenar ou aplicar bypass durante playback conserva notas e a instância. Parâmetros e orçamento são validados antes de alterar o grafo; máximo estrutural global64 FX, sem afirmar que toda combinação opera em tempo real. Dados antigos desconhecidos permanecem preservados: reprodução exige configuração suportada e a UI permite remoção incremental para reparar uma cadeia inválida.

Todos os FX usam o AudioContext existente. Compressor estéreo ligado e limiter usam worklet próprio sem lookahead, evitando a latência fixa do DynamicsCompressor nativo entre trilhas. EQ/reverb/delay/chorus/saturation usam nós Web Audio; IR determinístico, cache limitado por contexto e efeitos independentes. Ganhos iniciais são aplicados imediatamente; atualizações usam rampas5ms. Saturation não usa oversampling. Limiter é de sample peak; não há alegação de true peak ou LUFS. Entradas não finitas são silenciadas pelo medidor e sinalizadas.

Caminho DAW: gate da fonte → FX da trilha → volume/pan/automação → soma → volume Master → FX Master → medidor → saída existente. Legacy Synth conserva sua saída original e não passa pela cadeia Master DAW. Indicador L/R mede sample peak pós-FX Master, mantém clipping/invalid até reset e mostra se há limiter ativo no grafo. **DSP Monitor mede o host Synth/WASM; não inclui estes nós FX nem os novos worklets.** Não se pode usar o percentual dele como orçamento total da DAW.

Stop fecha fontes, restaura volume/pan base e permite caudas dos FX já em processamento; o retorno ao fader base pode afetar a cauda. Reset/New elimina cadeias; rebind do instrumento limpa estado dos efeitos. Não há promessa de bounce determinístico de chorus/fase dos LFOs, nem persistência de buffers de reverb/delay.

Automação desenhada Volume/Pan da trilha, enable/clear, modos linear/step, inserir/arrastar/remover pontos, colisões ordenadas com o ponto movido prevalecendo e um Undo por gesto. Usa o clock/worklet comum já existente para áudio e instrumentos. Gestos são cancelados se projeto, trilha, lane ou seus pontos mudarem durante a captura. Sem gravação de knobs nem automação de parâmetros FX (roadmap).

Exportação SMF1 da composição ou seleção MIDI, com BPM/compasso e nomes de trilhas, notas/velocity/duração/canais, pitch bend e modulação. Materializa loops/janelas e chase, mantém origem da composição ou alinha seleção ao início. Orçamentos são verificados; gravação por File System Access, com abort em erro. Exportar não altera revisão nem marca projeto como salvo. Timbres, mix e FX continuam no projeto WS e precisam ser escolhidos no destino.

### Exportação e presets

A exportação renderiza em tempo real com o mesmo AudioContext e instrumento. Mix e seleção usam o Master da DAW e respeitam Mute/Solo. O volume de saída do simulador e o click ficam fora do arquivo. Trilha isolada e stems saem após os efeitos e faders da trilha, antes do Master, incluindo trilhas mutadas. Todos os stems começam no frame zero e têm a mesma duração. São gravados em uma subpasta nova, com ordem e nome de trilha no arquivo. A trilha isolada tem a mesma duração do mix. Stems compartilham o pool de vozes durante a passagem.

O intervalo começa em Range in/out. A seleção de clipes usa apenas os clipes selecionados e o intervalo entre suas extremidades. O render lê a partir do início para preservar efeitos e notas que antecedem o intervalo. O áudio é cortado no ponto de saída e a opção de cauda acrescenta 0, 2, 4 ou 8 segundos. As notas são soltas na saída, a expressão MIDI permanece durante o release e a automação mantém o valor do último frame. Caudas mais longas terminam no limite escolhido. O limite é 20 minutos por arquivo, incluindo cauda. WAV usa PCM16 estéreo a 44,1 kHz. MP3 usa o encoder LAME local a 192 kbps e pode ter padding de codificação.

A captura exige transporte parado, entradas da DAW desligadas e instrumento em repouso. Durante o render o host reserva a instância, ignora entrada musical e não publica o timbre temporário. Ao terminar ou cancelar, restaura patches, slots, marcações de edição e a altura anterior de glide. Os FX começam com buffers vazios. A fase do chorus, LFOs do Synth e detalhes de agendamento em quanta podem variar entre passes. A captura grava blocos contínuos em OPFS com memória limitada e verifica quantidade de frames antes de publicar. O cancelamento aborta a gravação e mantém o conteúdo anterior do arquivo. A coleta antes de um novo export remove temporários órfãos enquanto mantém os renders com lock ativo. Um seletor de arquivo nativo pode criar uma entrada vazia quando o destino ainda não existe.

O Browser oferece presets portáteis `.wspreset`. Salvar instrumento registra timbre e parâmetros. Salvar trilha leva também efeitos, volume, pan, monitor, nome, ícone e cor. Carregar aplica ao tipo de trilha compatível em um único Undo, preservando clipes, fontes e Arm/Mute/Solo.

## Validação executada

Evidência em `.local/validation/daw-mvp-wave-7/`. **50 suítes Node aprovadas**: inclui fases DAW, SMF roundtrip, sete catálogos e parâmetros, rejeição de65FX antes de revisar projeto, dinâmica/limiter estéreo, NaN/Inf, encerramento de processador, além de polifonia8–256, DSP Monitor, MIDI/pickup, presets, tone editor e Studio. Resultados completos em `node-regressions.json`. UI reference foi reconstruída na fase6; nenhum código WASM mudou na7.

Chrome: **nove suítes aprovadas**: instrumentos DAW, transporte, Monitor, gravação, UI Foundation, UI Foundation v2, efeitos, editores/importação e gestos de clipes (`browser-regressions.json` e logs específicos). UI Foundation confirmou notas sustentadas, navegação sem comandos musicais, MIDI learn/pickup, Save e sessão Export/Import, sem overflow mobile. Teste novo `browser-daw-effects.mjs` aprovado com sete efeitos numa trilha e limiter Master independente, reordenação/bypass durante playback sem perder notas, desenho/movimento/Undo de Volume/Pan e colisões nas duas direções, export MIDI sem mutação e Save/Open de FX/curvas. Um único AudioContext de instrumento, pool256. Gravação conserva teste88200frames, recuperação e Undo de bytes; não houve nova medição física.

Medições por impulso no Chrome: EQ neutro0,1 desde frame0, sem ganho dobrado; reverb wet com primeiro sinal no frame0, sem latência adicional observada neste Chrome; delay wet10ms com primeiro sinal em441, amplitude1 e nenhum vazamento no frame0. Screenshot de automação inspecionado. Estes casos não certificam ausência de dropout sob carga máxima, qualidade perceptual ou todos os navegadores.

### Rodada de fechamento

Build do simulador para 8–256 vozes e referência de UI recompilados. As 50 suítes Node passaram, incluindo a rejeição de fila MIDI pendente, sustain sem nota e restauração de patches e slots no runtime. A suíte de falhas passou ao ser repetida com a capacidade de criar subprocesso Node. A referência de áudio continuou idêntica nas 256.000 amostras verificadas.

No Chrome, o teste de exportação decodificou o resultado de mix (22.050 frames), range (6.615), seleção de clipe (8.820), trilha (22.050) e dois stems (110.250 cada). Conferiu ganho e automação amostra a amostra, silêncio fora dos clipes com click habilitado, WAV com volume global mudo, MP3 audível dentro do padding esperado, cauda de delay após o fim, timbre MIDI, bloqueio por nota externa já ativa e uma instância de AudioContext. O range curto foi exportado mesmo com um projeto de mais de 20 minutos e instrumento pendente fora do trecho. Também passaram os casos de cancelamento sobre arquivo existente, coleta OPFS com lock ativo e preset de trilha carregado com Undo e bytes intactos. A suíte substitui o seletor nativo por handles do Chrome, sem medir interação de sistema com o seletor. Evidências em `browser-audio-export.json`, `export-node-regressions.json` e `export-browser-regressions.json`.

## Próxima fase

A fase 8 parte deste fechamento e cobre painéis destacados, atalhos, foco e perfis locais por dispositivo e contexto. A fase 9 cobre estabilidade prolongada, memória, limpeza OPFS, troca de AudioContext, regressões finais e manual. Validação física do hardware e dos sistemas alvo é registrada separadamente.

O assessment da madrugada em Sol 6.1 xhigh encontrou e ajudou a corrigir o canal MIDI de notas desenhadas. O assessment na retomada em Astra 6.2 high apontou casos de pedal/fila pendente, expressão durante a cauda, restauração de glide e taps, limite do range, colisões de nomes de stems e órfãos OPFS. A implementação e as verificações pertencem ao agente principal.
