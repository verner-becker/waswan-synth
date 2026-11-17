# WASWAN Studio — onda 3: composição por camadas

Estado: concluída em software, com validação física pendente. Continuidade autorizada no plano das ondas. Branch `feat/studio-waves`, sem integração na main.

## Implementação e decisões

Quatro pistas MIDI correspondem às quatro partes reais A–D. Não há instâncias adicionais de synth, novas vozes, novas cadeias de efeitos ou tracks com timbres independentes além dessas partes. Edit tone seleciona a parte explicitamente pelo controle legado e abre o TONES existente, preservando sua confirmação de descarte e Save/Save as.

Make clip agrupa notas ainda não agrupadas de uma parte, com limites de compasso conforme a métrica. Clipes podem ser selecionados, duplicados, movidos no tempo, transferidos para outra parte e apagados. Duplicações sucessivas selecionam a nova cópia. O comprimento do arranjo cresce quando necessário; notas e clipes são validados antes de alterar o modelo. Limites: quatro pistas, 128 clipes e 4.096 notas.

Mute/solo da sequência seleciona quais notas entram no agendador e no SMF, sem silenciar a execução física por uma flag global. Essas mudanças e operações de clipe são feitas com transporte parado. Volume/pan usam o mixer original da parte e podem ser ajustados durante playback; afetam também notas ao vivo nessa parte. Os valores vivos são mostrados separadamente dos valores guardados no projeto. Apply saved part mixer aplica explicitamente os níveis/pans do projeto. Flags de mute/solo do Legacy permanecem visíveis quando ativas.

Undo MIDI inclui dados de notas, clipes e mute/solo, preservando o volume/pan atualmente aplicado. Nenhuma navegação aplica mixer, troca timbre ou envia release.

## Overdub

Add take to A–D acrescenta notas externas de uma tomada à parte escolhida, com novos IDs, sem substituir as notas anteriores. Overdub A–D inicia uma tomada e o transporte de acompanhamento; Finish overdub encerra os dois e acrescenta o material capturado. Os eventos são alinhados pelo frame de início da tomada e pelo frame do transporte; não são disparados por timers da UI.

Uma nota que começa pouco antes do transporte e continua após seu início é recortada em zero. Em loop, novas notas são posicionadas no ciclo e durações que atravessam o final são recortadas, sem criar ties automaticamente. MIDI/CC originais continuam no log da tomada. O destino da nova camada é explícito; a monitoração ao vivo continua usando o roteamento MIDI/split/layer que o usuário já configurou, sem reassociar controles ou portas.

A gravação de áudio mantém acompanhamento e execução reais como referência. O deslocamento de frames permite alinhar a camada musical, mas não certifica latência acústica ou compensa automaticamente o buffering interno do firmware.

## Timbres e recuperação do projeto

O snapshot agora inclui os 80 bytes de cada patch vivo, além dos parâmetros catalogados, programas, tempo/master e oito valores de mixer por parte. Isso preserva nome, oitava de teclado, engine tag e extensões de patch que não cabiam nos 63 parâmetros. Os formatos de preset e sessão legados não mudam.

O projeto conserva `context` como referência da tomada e pode guardar `sequenceContext` como contexto atual da composição. Save MIDI project e Save project com uma composição atualizam esse segundo contexto quando o synth está disponível. Um projeto já carregado pode ser editado/exportado sem iniciar áudio, conservando o contexto salvo.

Abrir ou recuperar projeto carrega imediatamente suas notas, mesmo sem AudioContext, e não troca sons. Apply saved tones and mixer é uma ação explícita com Cancel/Confirmar: substitui as edições vivas das quatro partes, aplica mixer/tempo/master, mas não escreve slots de preset. O host valida todas as partes antes de alterar qualquer uma e confere um token do estado atual para rejeitar alterações concorrentes. Transporte Studio/Legacy deve estar parado. Save/Save as do TONES continua sendo a operação que escreve um preset.

A restauração reutiliza patches e rotinas existentes; não repõe fases de oscilador, vozes sustentadas, envelopes ou buffers de efeitos. Não promete áudio idêntico à tomada. Projetos anteriores sem patch completo continuam abrindo áudio/MIDI, mas a interface informa que não podem usar essa restauração integral.

## Validação e evidências

Evidências em `.local/validation/studio-wave-3/`. Build completo e referência de UI reconstruídos. Nenhum dispositivo físico ou perfil pessoal foi usado.

- Node: 16 suites passaram, incluindo agrupamento/movimentação/duplicação/exclusão, limites métricos, mute/solo, alinhamento de overdub e validação de clipes.
- O teste de contexto verifica roundtrip de patches completos, DRUM-X, rejeição atômica de parte inválida, token antigo recusado, controles por parte e todos os 99 tokens de slots de preset inalterados após aplicar contexto.
- As comparações de áudio da UI e do DSP Monitor continuam idênticas à referência com os novos recursos inativos.
- O fluxo Chrome próprio passou clipes, pista de destino, mixer vivo, Cancel/Confirmar, notas abertas sem iniciar áudio, overdub sem panic e projeto com patches completos; desktop e 390 px sem overflow.
- As oito suites Chrome de integração/regressão passaram: arranjo, sequência, gravador, UI Foundation, UI Foundation v2, tone selector, tone editor e 256 vozes. Resumo em `browser-baseline.json`.

## Registro de fechamento

- **Implementado:** quatro pistas MIDI, clipes, duplicação/movimentação/exclusão e troca de parte, mute/solo da sequência, volume/pan do mixer original, novas camadas e overdub; snapshots completos e restauração explícita de timbres/mixer com guardas de concorrência.
- **Efetivamente testado:** 16 suites Node e oito Chrome, incluindo overdub real no navegador com MIDI sintético, arquivos de projeto, contexto DRUM-X/ANALOG, cancelamento/confirmação, preservação de slots e regressões anteriores.
- **Limitado:** quatro partes compartilham 256 vozes/FX; mute/solo/clipes são editados com transporte parado; não há time stretch, edição de áudio ou ties automáticos entre ciclos. Roteamento físico continua o existente. Sem validação física, alinhamento acústico garantido ou restauração de estado transitório do DSP. Recuperação automática de tomada não substitui Save project para conservar edições de arranjo.
- **Decisões:** limites reais do motor, mixer compartilhado explicitamente, nenhum remapeamento MIDI automático, sequência independente do áudio de referência, dois contextos de projeto e restauração confirmada sem escrever presets.
- **Próximo passo:** onda 4 — automação por IDs/escala originais, registro de controles, finalização e MP3 codificado localmente em Worker com dependência fixada e licença/fonte disponíveis.
