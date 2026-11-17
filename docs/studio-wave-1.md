# WASWAN Studio — onda 1: gravador de performances

Estado: concluída em software, com limitações abaixo e validação física pendente. Autorização: seguir pelas ondas planejadas, com recomendações da onda 0 e registro de fechamento por onda. Branch `feat/studio-waves`; main sem integração.

## Comportamento e decisões

Studio acrescenta uma workspace ao synth existente. Uma tomada estéreo de até 20 minutos, capturada após master/FX do instrumento e antes do mute de monitoração. Stop encerra a captura no próximo bloco, sem panic ou release; não há cauda automática. Aguardar a cauda antes de parar é uma escolha do músico.

Áudio PCM é transferido diretamente do processador de captura para um Worker, com oito buffers reciclados de 4.096 frames (256 KiB). O Worker converte para PCM16 little endian e grava WAV progressivamente no OPFS. A interface recebe progresso aproximadamente uma vez por segundo, não os blocos de áudio. Checkpoints atualizam cabeçalho e metadados; falhas preservam os blocos já gravados como tomada incompleta quando o armazenamento permite.

O registro de eventos distingue MIDI recebido (timestamp original correlacionado ao relógio do contexto e instante de recebimento) de comandos observados na entrada do motor (posição `currentFrame`). Esta correlação não mede latência acústica. Não transcreve notas geradas por arp/seq e não afirma que um comando foi aceito pelo pickup. Não habilita novas mensagens MIDI.

O snapshot contém os parâmetros vivos dos quatro timbres, programas, engines, tempo e master, além da sessão legada. Não inclui memória completa de execução, vozes/envelopes/FX em curso nem garante ressíntese idêntica. Consultar os blobs para esse snapshot preserva o cache de persistência original do motor.

Abrir projeto ou recuperar tomada não aplica os timbres ao synth e não reinicia o instrumento. Ouvir a tomada é reprodução de áudio, usando o mesmo AudioContext e o ganho de monitoração. Trocar de workspace não encerra gravação/reprodução nem altera notas. Suspensão do contexto, página oculta ou falha do instrumento encerra a captura como incompleta; o comportamento legado de liberar notas ao ocultar a página é preservado.

## Arquivos e limites

- `studio-format.js`: WAV, PCM16, limites e formato binário `.wsproj` documentado abaixo; validação sem execução de conteúdo.
- `studio-capture.js`: tap de captura com buffers limitados e encerramento explícito por falta de buffer/duração.
- `studio-worker.js`: escrita de áudio/eventos/metadados no armazenamento privado do navegador.
- `studio-recorder.js` e `ui-studio.js`: ciclo da tomada, recuperação, import/export, reprodução e apresentação.
- Extensões pequenas em MIDI, DSP wrapper e staging preservam timestamps e observam comandos sem modificar sua interpretação.

OPFS: `waswan-studio-v1/take-<timestamp>-<uuid>/` contém `audio.wav`, `events.jsonl` e `take.json`. Novas tomadas não sobrescrevem as anteriores. Recover escolhe a tomada mais recente que puder ser validada. Dados locais podem ser removidos pelo navegador/usuário e não são backup. Não há upload de material musical.

Formato `.wsproj` v1: assinatura ASCII `WASWAN-STUDIO-1\n`, uint32 little endian do tamanho do JSON, JSON UTF-8 e WAV estéreo PCM16 de 44,1 kHz. O JSON identifica formato/versão, nome/status/duração/contexto e eventos. Áudio tem exatamente `44 + frames × 4` bytes. Limites: 20 minutos, 100.000 eventos e 16 MiB de JSON. Versão, tamanhos, intervalos, estrutura dos eventos e cabeçalho WAV são validados antes de abrir; importação não executa comandos do projeto.

O limite de eventos ou falha de buffers encerra como incompleta, sem apagar o início da tomada nem fingir sucesso. O teste de duração máxima deve confirmar encerramento automático. Arquivos importados são mantidos como dados; a camada de sequenciamento futura deverá validar separadamente qualquer comando que vier a executar.

## Validação executada

Evidências: `.local/validation/studio-wave-1/`. Ambiente Chrome desktop isolado, com áudio/WASM reais e MIDI sintético; sem validação física.

- PASS `studio-format.test.mjs`: roundtrip projeto/áudio, clipping PCM e rejeição de versões, tamanhos, eventos/payloads e WAV inválidos.
- PASS browser curto: gravação, WAV não nulo, eventos de entrada/comandos, snapshot de cutoff não salvo, navegação com notas mantidas, playback, projeto idêntico após recuperação, import inválido sem perder a tomada e recuperação incompleta após interromper o Worker. Desktop e 390 px sem overflow.
- PASS DSP Monitor: áudio idêntico em off/live/capture após extensão do wrapper.
- PASS ensaio real de 20 minutos: quatro notas POLY, pitch periódico, 52.920.000 frames a 44,1 kHz, 90 registros, encerramento automático no limite, exportação WAV/projeto e recuperação. Heap retido da página após GC: aproximadamente 5,27 MB no primeiro ponto e 5,12 MB no final, sem crescimento progressivo; não é uma medição de toda a memória do navegador. Resultado detalhado em `browser-long.json`.
- PASS suites Node: upstream, formato Studio, MIDI/profile/diagnóstico/pickup, 256 vozes, ações de modo, UI Foundation e tone selector/editor. PASS teste do tap: amostras estéreo exatas, saída adicional silenciosa, flush parcial, overrun explícito, preservação de NaN para validação e limite de duração.
- PASS cinco suites Chrome: UI Foundation, UI Foundation v2, tone selector, tone editor e 256 vozes. A navegação mantém uma instância e notas sustentadas.
- PASS casos adicionais no browser curto final: cancelamento durante preparação, suspensão/retomada sem novo instrumento e recuperação marcada como incompleta. Carregamento/importação bloqueia início simultâneo de nova gravação.

O ponto medido entre timestamp do input e comando observado ficou entre ~0,09 e ~0,20 ms nos ensaios curtos e em ~11,81 ms no ensaio longo, que incluiu outras verificações em processos separados. São observações pontuais, não distribuição de jitter, benchmark exclusivo ou latência MIDI→som. O processamento interno ainda tem polling/buffering próprios; ressíntese com alinhamento acústico não está certificada.

Comandos principais:

```sh
sh scripts/stage-simulator.sh
node tests/studio-format.test.mjs
node tests/studio-capture.test.mjs
node tests/browser-studio.mjs
STUDIO_RECORD_SECONDS=1200 node tests/browser-studio.mjs
```

Servidor e Playwright seguem a configuração existente. As suites browser abrem perfis temporários e não usam o controlador físico do usuário.

## Registro de fechamento

- **Implementado:** workspace Studio; tomadas estéreo por blocos; input MIDI com timestamp e observação de comandos; contexto vivo de quatro partes; playback de áudio; WAV, `.wsproj`, importação validada e recuperação local completa/incompleta.
- **Efetivamente testado:** fluxo curto e ensaio real de 20 minutos, integridade dos arquivos no roundtrip, interrupção abrupta do Worker, suspensão, cancelamento, navegação/notas mantidas, layout desktop/mobile, limites do tap e regressões Node/Chrome descritas acima.
- **Limitado:** Chrome/Chromium desktop; 20 minutos e 100.000 eventos por tomada; sem transcrição de arp/seq, edição de notas, MP3, pistas de áudio ou restauração automática de timbres. Sem medição física de latência/underruns ou garantia de áudio idêntico numa ressíntese. Cota esgotada/disco cheio produzem falha explícita, mas não foram provocados fisicamente; checkpoints não tornam o navegador imune a perda de armazenamento.
- **Decisões:** captura antes do mute, Stop sem release/cauda automática, áudio como referência, origens/relógios distintos para eventos, recuperação local separada de backup exportado e projeto aberto sem substituir o synth.
- **Próximo passo:** onda 2 — piano roll, edição/quantização, transporte MIDI pelo relógio de áudio, metrônomo e SMF. Prova isolada de notas com propriedade Studio já verifica preservação de uma nota ao vivo da mesma altura; não foi usada na captura desta onda.
