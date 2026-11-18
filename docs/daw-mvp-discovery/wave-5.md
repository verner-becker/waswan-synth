# DAW — fase 5: gravação sequencial e Monitor

Branch `feat/daw-wave-5-recording`, pai `aa6f21f`. Estado: concluída; não integrada à main.

## Implementação

- Um Record global e uma trilha armada, preservada no projeto. Arm independe da seleção para tocar. MIDI externo passa depois do consumo pelo perfil; teclado/pads originais continuam Synth e não são recapturados. Input e Arm são ações explícitas, sem mudança por navegação.
- Monitor In/Auto/Off: In contínuo; Auto parado ou na trilha realmente em gravação; Off só fecha a entrada, preservando playback. Saídas separadas no mesmo WASM, sem eco no estéreo Legacy, pool global de 256 e 32 hits DRUM-X preservados. Owners3 playback,4–19 canais da entrada física; note-off, pedal, pitch bend/mod, MONO/UNISON e tails têm posse própria. Stop/loop DAW não apagam entrada monitorada. Transportes Studio/Legacy e aplicação do contexto Studio ficam bloqueados enquanto a entrada DAW está habilitada; desligá-la permite voltar aos fluxos originais.
- MIDI conserva pitch, velocity, canal, tempo em ticks de resolução960, sustain materializado nas durações e PB/mod; sem quantização em grid na captura. Expressão de vários canais é preservada no arquivo, mas na reprodução do instrumento é uma expressão por trilha, não MPE. Ledger grava só mensagens externas após o perfil, nunca eventos do acompanhamento.
- Áudio externo: MediaStream → worklet de captura separado → Worker com SyncAccessHandle OPFS, WAV estéreo PCM16/44,1kHz. Resampling/decodificação do dispositivo fica no AudioContext existente; mono duplica nos dois canais. DSP, acompanhamento, FX e click não entram nesse arquivo. Navegação não cria contexto nem instância.
- Count-in0/1/2/4 compassos e metrônomo em worklet próprio, no relógio compartilhado e fora da captura. Uma passagem de Range in/out se Loop está habilitado; gravação linear a partir do cursor em caso contrário, até o limite existente de20min/8192 quarter beats. Não há comping nem punch automático.
- `Replace selected clip` substitui o clipe inteiro escolhido só depois da validação da nova tomada; desligado cria um clipe no cursor. Acompanhamento exclui apenas o destino escolhido. Um batch de Undo restaura notas ou fonte/bytes anteriores, Redo reaplica; sem ripple. Offsets manuais MIDI/áudio −2000…2000ms, separados por ID do dispositivo quando disponível, em armazenamento local. Positivo move mais cedo; não há calibração automática nem medição física certificada.

## Recuperação e limites

Cada preparação grava uma cópia fixa `base.wsproj` e o novo PCM/journal em `waswan-daw-takes-v1/UUID`, com Web Lock de posse. Isto custa **uma cópia integral do projeto por take**, além do áudio novo; falha de escrita impede começar ou preserva a tomada anterior. Não há promessa de gravação se a quota acabar.

O Worker valida sequência/continuidade e escrita completa; pool8×4096 frames, limites antes de inserir eventos, checkpoints por volta de1s e duas gerações alternadas de metadata. Timeline/seed são checkpointados e reconhecidos **antes** de armar o transporte. Uma metadata rasgada permite usar a geração anterior; header WAV mais recente é reconstruído num arquivo novo a partir do prefixo PCM confirmado. Interrupções, overrun, suspensão, perda de input e erro de armazenamento nunca substituem automaticamente o destino; `Recover interrupted take` abre a cópia fixa e aplica explicitamente o prefixo válido. Preparações comprovadamente vazias são removidas; fontes commitadas não são apagadas pois projeto/Undo ainda as referenciam. Backups completos/incompletos permanecem locais; limpeza orientada pelas referências é pendência da estabilidade, sem apagar bytes automaticamente agora.

Uma interrupção pode perder o último intervalo ainda não checkpointado. Não foi certificado desligamento abrupto do SO, nem durabilidade física do dispositivo. A rota interna instrumento→Audio Track foi avaliada: os taps próprios já permitem uma fonte interna futura, mas neste fechamento Input Audio oferece interface/microfone; não adicionamos outra instância ou export fingido como gravação.

## Validação real

Evidência em `.local/validation/daw-mvp-wave-5/`:

- Build completo8/16/32/64/128/256, UI reference reconstruída e fault harness recompilado com Monitor; upstream preservado.44 suítes Node, incluindo todos os estágios de vozes, som equivalente à referência, presets/tones, MIDI/profile/pickup, DSP Monitor, Studio e DAW. Fault harness precisou execução fora do sandbox por `spawnSync EPERM`; passou com a mesma asserção e timeout, sem mudança funcional.
-19 suítes Chrome distintas: UI Foundation v1/v2, Tone Editor/selector, MIDI diagnostics, knobs, DAW instruments/Arrangement/transport/Monitor/files/recording, Studio/sequence/SEQ workflow/audio/automation e256voices. O teste de drag foi estabilizado com drop no cabeçalho real e scroll vertical explícito antes de outra interação; asserções de reorder/Undo e extensão de clipe continuam intactas.
- MIDI: duas notas/canais no mesmo pitch, Off no destino original após seleção, pedal atravessando loops/Stop, CC120 por canal, hotplug sem global panic, navegação sem comandos, MONO/UNISON, patches com ARP e restauração de tecla física0. DRUM-X conserva tail do outro canal/owner; panic limpa ledger sem ressuscitar nota. In/Auto/Off e tokens obsoletos também verificados no source gate.
- Captura: notas tocadas no count-in não aparecem; sustain/PB são gravados; acompanhamento Bass não vira nota nova. Com stream sintético constante0,125, click e acompanhamento ligados, foram88200 frames,352844 bytes de WAV, **todos** os samples0,125. Fronteira não alinhada177 frames e pool esgotado/descontinuidade/NaN cobertos em Node. Click1/2/4 compassos segue relógio, sem timer UI.
- Substituição áudio e MIDI/Undo/Redo conservam bytes, offset recorta início antes de zero, transação inválida não muda revisão. Save/Open pela UI e roundtrip preservam projeto/fontes. Permissão negada, cancelamento durante count-in ou durante último await da preparação mantêm o projeto anterior; nada começa depois do Stop. Desconexão conserva o destino e recuperação explícita aplica o prefixo. Corrupção da metadata mais recente recupera geração anterior com WAV consistente.
- Node DSP Monitor:5×10s por modo,256voices, off/live/capture bit a bit iguais; medianas2127/2120/2143ms para10s renderizados, overhead observado−0,36%/+0,73%. Não representa latência física nem garantia de ausência de underruns. Repetição prolongada sob carga da DAW fica para estabilidade.
- Screenshots inspecionados de gravação e Arrangement1366/1920/3440. Em1366×768, Arrangement305px e painel inferior recolhido; sem overflow horizontal da página. Um AudioContext/host por fluxo.

Sem validação de interface/microfone/controlador físico, escuta humana certificada, Windows/macOS, 20min contínuos ou recuperação por power loss. Input MIDI ainda segue a política de foco do app original; trabalho em janelas/foco é fase8. FX, editores diretos/importação, exportações e estabilidade do MVP permanecem fases seguintes; esta fase não declara o MVP pronto.

## Assessment e próximo passo

Sol6.1 `xhigh`, consultivo somente leitura, identificou as janelas de cancelamento e metadata/PCM entre checkpoints e o corte de expressão antes do offset. Correções e testes descritos acima. Sem delegação da implementação. Não houve bloqueio sem hipótese nova nem decisão de produto além do escopo autorizado.

Checks concluídos e branch publicada; o SHA de fechamento é o commit que contém este documento. Abrir fase6 em cima dela: operações diretas de clipes, importação WAV/MP3/SMF, Piano Roll e editor de áudio. Não integrar à main automaticamente.
