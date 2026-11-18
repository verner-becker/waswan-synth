# DAW fase 9 · estabilidade, jornadas e manual

A branch `test/daw-wave-9-stabilization` parte do fechamento da fase 8 em `40d5009`. O escopo inclui recuperação de fontes, ciclo do grafo de áudio, jornadas de composição e documentação. O upstream e o pool global de 256 vozes continuam como na referência do projeto.

## Ajustes

A DAW desmonta o grafo antigo quando AudioContext, nó do instrumento ou saída muda. Portas de mensagens, caches PCM, efeitos e conexões da DAW são liberados junto do grafo. Uma nova reprodução prepara os seus próprios nós e volta a receber o estado do transporte. Uma tomada interrompida conserva o relógio da instância antiga, inclusive quando o novo contexto tem um playhead de áudio menor. O microfone é reaberto no contexto atual quando necessário. A UI atualiza os segundos durante a captura.

O cache de importação fica em OPFS sob lease enquanto o projeto, Undo/Redo ou a área de transferência precisar dos blobs. Ao trocar de ID de projeto, a área de transferência é esvaziada. A coleta revalida as referências antes de remover cada pasta. O snapshot de recuperação grava e verifica a nova geração, conserva a anterior válida e remove fontes ausentes das duas. Um erro transitório de leitura adia a poda. A recuperação de tomada prepara e valida o novo estado antes de substituir o controlador. Checkpoints com áudio ou eventos são preservados. O namespace `waswan-daw-audio-v1` das versões intermediárias fica fora da coleta porque essas versões não mantinham lease depois da importação.

Os kits DRUM-X de fábrica ficaram disponíveis no seletor de instrumentos da DAW. O host faz cópia pelo código original do kit e a seleção não edita a parte viva do Synth. O percurso de piano, baixo e bateria pode acontecer inteiro na DAW.

O [manual em português](../../MANUAL-WASWAN-SYNTH.pdf) recebeu cinco capítulos e uma captura real do Arrangement. O PDF A4 com 49 páginas tem links internos, texto extraível e marcação para leitores. A fonte editável está em [docs/manual-waswan-synth.html](../manual-waswan-synth.html).

## Jornadas verificadas

| Jornada | Evidência de software |
|---|---|
| Compor | Chrome tocou Piano sem Arm, gravou acordes com count-in, sobregravou Bass, escolheu um kit DRUM-X na DAW, aplicou mixer e FX, salvou/reabriu e exportou WAV de 88.200 frames. |
| Preparar áudio para Suno | Importação WAV/MP3, gestos de clipe, fades e quantização passaram em suítes de editores. A jornada integrada importou, recortou e aplicou fades ao guia enquanto conservava as trilhas MIDI, e exportou range, trilha e mix com o checksum da fonte intacto. |
| Controlador por contexto | Chrome com portas sintéticas verificou cutoff, Mixer, pickup, rajada de encoder, reconexão e recarga. Clonagem e resolução de ambiguidade passaram em Node. |
| Foco e painéis | Popup real operou o Mixer durante uma tomada MIDI com sustain, salvou, desfez, fechou e reconectou o painel. Reset Layout conservou o projeto. A posse do áudio entre abas passou em Chrome. |
| Gravação e recuperação | Contagem e áudio de entrada, permissão negada, geração rasgada, substituição e Undo dos bytes em Chrome. Testes de Node cobriram relógio do contexto anterior e referências que mudam durante a coleta. |
| MIDI e edição | SMF importado/exportado, loop/trim/split, desenho de notas, grupos, velocity, quantização e Undo. |
| Integridade | Chrome leu o cache de continuidade de Undo e clipboard, protegeu backup sob falha transitória de leitura, recuperou o manifesto anterior e podou fontes após duas gerações válidas. Depois de fechar um AudioContext, um segundo chegou ao fim natural e aceitou novo Play. |

O arranjo de cinco minutos, com três instrumentos, cinco trilhas PCM e dez efeitos, terminou no frame 13.230.000. Os buffers de fonte totalizaram 529.200.000 bytes. O Play preparou em 756 ms e o seek com cache em 33,2 ms, na execução medida. Um AudioContext e um host. Sem erro de áudio, estado inválido do Master ou bloco acima do orçamento no DSP Monitor. O host registrou 102.810 blocos, média de 0,117 ms e máximo de 2 ms, para quanta de 2,90 ms. A medição usa relógio de 1 ms e cobre o host WASM. Os FX Web Audio, o consumo nativo total e a saída física não são medidos por esses números.

A tomada de 20 minutos gravou 52.920.000 frames a 44,1 kHz. O WAV tem 211.680.044 bytes. Todas as amostras corresponderam ao sinal sintético de entrada, inclusive no prefixo recuperável, com click de monitoração habilitado. O relógio de parede mediu 1.200,865 s desde Record até a conclusão. O DSP Monitor registrou um bloco de 4 ms acima do orçamento entre 414.000 blocos do host. O arquivo capturado permaneceu íntegro. O teste curto foi repetido após os ajustes finais de ciclo de contexto e de progresso. Os ensaios longos iniciaram antes da exposição dos kits DRUM-X e preservaram o mesmo caminho de processamento.

**52 suítes Node e 18 suítes Chrome distintas passaram**, contando as jornadas e a carga. Os resultados dirigidos finais cobrem a troca de contexto, a seleção de bateria, a gravação, a exportação e os perfis em janelas. A comparação de referência de UI deu áudio idêntico nas 256.000 amostras verificadas.

O build de 8–256 vozes e a referência de UI foram reconstruídos. Evidências de teste e build em `.local/validation/daw-mvp-wave-9/`. A validação roda no Chrome 157/Linux com fontes e dispositivos sintéticos. Continua pendente a sessão manual com equipamentos físicos, Windows/macOS, diálogos nativos e múltiplos monitores. A integração em main depende de aprovação explícita.

Assessment de Astra 6.2 high revisou a coleta, identidade do transporte, retomada do relógio, media stream do contexto anterior e recuperação de fontes. Os casos acionáveis foram corrigidos e cobertos por regressões dirigidas.
