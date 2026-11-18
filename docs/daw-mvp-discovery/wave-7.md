# DAW — fase 7: mixagem, FX, automação e exportações

Branch `feat/daw-wave-7-mix-export`, pai `6ea5dff20a89300e0eb0ae6e8afae6a3d7e34669`. **Entrega parcial ao término da sessão de 18/11/2026, limite07:30 America/Sao_Paulo/10:30UTC. Não declarar a fase concluída.** Implementação principal em `fb634ea`; o commit que atualiza este documento encerra a entrega parcial. Sem integração à main.

## Escopo e resultado

SPEC9/10/11: sete FX independentes com reordenação/bypass/parâmetros e persistência, Master L/R/clipping, automação Volume/Pan desenhada/Undo e exportações mix/range/track/stems WAV/MP3/SMF. **WAV, MP3 e stems de áudio ainda não foram implementados.** A UI oferece somente as exportações MIDI disponíveis.

Implementadas cadeias independentes em cada trilha e no Master: EQ três bandas, compressor, reverb, delay, chorus, limiter e saturation. Parâmetros, ordem e bypass pertencem ao projeto e passam por Undo/Save/Open. Reordenar ou aplicar bypass durante playback conserva notas e a instância. Parâmetros e orçamento são validados antes de alterar o grafo; máximo estrutural global64 FX, sem afirmar que toda combinação opera em tempo real. Dados antigos desconhecidos permanecem preservados: reprodução exige configuração suportada e a UI permite remoção incremental para reparar uma cadeia inválida.

Todos os FX usam o AudioContext existente. Compressor estéreo ligado e limiter usam worklet próprio sem lookahead, evitando a latência fixa do DynamicsCompressor nativo entre trilhas. EQ/reverb/delay/chorus/saturation usam nós Web Audio; IR determinístico, cache limitado por contexto e efeitos independentes. Ganhos iniciais são aplicados imediatamente; atualizações usam rampas5ms. Saturation não usa oversampling. Limiter é de sample peak; não há alegação de true peak ou LUFS. Entradas não finitas são silenciadas pelo medidor e sinalizadas.

Caminho DAW: gate da fonte → FX da trilha → volume/pan/automação → soma → volume Master → FX Master → medidor → saída existente. Legacy Synth conserva sua saída original e não passa pela cadeia Master DAW. Indicador L/R mede sample peak pós-FX Master, mantém clipping/invalid até reset e mostra se há limiter ativo no grafo. **DSP Monitor mede o host Synth/WASM; não inclui estes nós FX nem os novos worklets.** Não se pode usar o percentual dele como orçamento total da DAW.

Stop fecha fontes, restaura volume/pan base e permite caudas dos FX já em processamento; o retorno ao fader base pode afetar a cauda. Reset/New elimina cadeias; rebind do instrumento limpa estado dos efeitos. Não há promessa de bounce determinístico de chorus/fase dos LFOs, nem persistência de buffers de reverb/delay.

Automação desenhada Volume/Pan da trilha, enable/clear, modos linear/step, inserir/arrastar/remover pontos, colisões ordenadas com o ponto movido prevalecendo e um Undo por gesto. Usa o clock/worklet comum já existente para áudio e instrumentos. Gestos são cancelados se projeto, trilha, lane ou seus pontos mudarem durante a captura. Sem gravação de knobs nem automação de parâmetros FX (roadmap).

Exportação SMF1 da composição ou seleção MIDI, com BPM/compasso e nomes de trilhas, notas/velocity/duração/canais, pitch bend e modulação. Materializa loops/janelas e chase, mantém origem da composição ou alinha seleção ao início. Orçamentos são verificados; gravação por File System Access, com abort em erro. Exportar não altera revisão nem marca projeto como salvo. Timbres, mix e FX continuam no projeto WS e precisam ser escolhidos no destino.

## Validação executada

Evidência em `.local/validation/daw-mvp-wave-7/`. **50 suítes Node aprovadas**: inclui fases DAW, SMF roundtrip, sete catálogos e parâmetros, rejeição de65FX antes de revisar projeto, dinâmica/limiter estéreo, NaN/Inf, encerramento de processador, além de polifonia8–256, DSP Monitor, MIDI/pickup, presets, tone editor e Studio. Resultados completos em `node-regressions.json`. UI reference foi reconstruída na fase6; nenhum código WASM mudou na7.

Chrome: **nove suítes aprovadas**: instrumentos DAW, transporte, Monitor, gravação, UI Foundation, UI Foundation v2, efeitos, editores/importação e gestos de clipes (`browser-regressions.json` e logs específicos). UI Foundation confirmou notas sustentadas, navegação sem comandos musicais, MIDI learn/pickup, Save e sessão Export/Import, sem overflow mobile. Teste novo `browser-daw-effects.mjs` aprovado com sete efeitos numa trilha e limiter Master independente, reordenação/bypass durante playback sem perder notas, desenho/movimento/Undo de Volume/Pan e colisões nas duas direções, export MIDI sem mutação e Save/Open de FX/curvas. Um único AudioContext de instrumento, pool256. Gravação conserva teste88200frames, recuperação e Undo de bytes; não houve nova medição física.

Medições por impulso no Chrome: EQ neutro0,1 desde frame0, sem ganho dobrado; reverb wet com primeiro sinal no frame0, sem latência adicional observada neste Chrome; delay wet10ms com primeiro sinal em441, amplitude1 e nenhum vazamento no frame0. Screenshot de automação inspecionado. Estes casos não certificam ausência de dropout sob carga máxima, qualidade perceptual ou todos os navegadores.

## Pendências e retomada

1. Completar exportação **WAV/MP3** de mix/range/trilha/stems, pós-FX/fader/pan e pré-Master nos stems conforme proposta registrada. Projetar render usando uma instância, exclusão de input externo/vozes alheias, cancelamento, limites de duração/memória, reposição do estado do instrumento, reset de buffers e política explícita de caudas. Não acrescentar uma segunda instância silenciosamente nem simular conclusão.
2. Provar fidelidade musical, automação e níveis dos arquivos exportados, silêncio/reverb/delay, clipping, range, stems e cancelamento sem projeto parcial. Validar a interação do ganho global de saída existente com export.
3. Gate de estabilidade: substituição real de AudioContext/node pode deixar referências de trilhas do grafo anterior; exercício de reboot no contexto existente não certifica troca de contexto. Verificar lifecycle/teardown antes de certificar fase9.
4. Fases8/9 continuam pendentes: janelas/foco/perfis, carga longa/20min, coleta OPFS por referências, desempenho com FX, recuperação sob falha física, manual e regressões finais. Windows/macOS e hardware não foram validados.

Não houve bloqueio repetitivo nem decisão externa aguardando resposta nesta entrega; o limite de horário encerra a sessão com trabalho parcial preservado. Retomar aqui e fechar integralmente a7 antes de abrir uma branch8. Main, upstream, formatos de presets originais e pool global256 preservados.

Assessment final Sol6.1 xhigh somente leitura não identificou impedimento crítico de FX/automação para publicar a entrega parcial. Identificou e foi corrigido, com regressão, o canal fallback de notas desenhadas: agora acompanha o canal já presente nas notas/expressão da trilha exportada, em vez de separar uma nota nova de seu pitch bend. Canais explícitos continuam preservados; a DAW toca expressão por trilha, portanto arquivos com múltiplos canais explícitos não equivalem a uma emulação multitimbral do destino. Nenhuma implementação foi delegada.

Conferência final: todas as branches publicadas, pai de cada fase igual ao fechamento anterior, main/upstream intactos e nove fontes do ZIP byte a byte idênticas. Os testes de editores e gestos aceitam `DAW_VALIDATION_ROOT`, assim como Monitor/gravação, para conservar evidência histórica ao revalidar fases posteriores. A rodada final repetiu importação WAV/MP3/SMF, Piano Roll, audition, Save/Open, trim/loop/crossfade/Undo e manipulação direta de clipes com os novos painéis presentes; ambos passaram.
