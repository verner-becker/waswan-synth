# WASWAN Studio — onda 0: diagnóstico e viabilidade

A evidência da Onda 0 do **Sampler Studio**, realizada em 20/11/2026, tem [registro próprio de auditoria e validação](sampler-studio-discovery.md). O diagnóstico abaixo corresponde à primeira série do Studio, de 17/11/2026.

Data: 2026-11-17. Base: `97ab4ecb4b12521aaac8db7c1e990d83db16d2fc`, conferida com `origin/main` via fetch. Upstream preservado em `3f751bc2be066414f204cf44e1aa05d9c7467d7f`. Acompanhamento e autorizações: [controle das ondas](studio-waves.md).

## Parecer

Prosseguir no navegador. O motor existente e a sondagem de captura sustentam uma primeira entrega de gravação estéreo local, sem necessidade demonstrada de migrar para nativo. Isto não certifica uma DAW completa, um número de pistas, gravações longas, latência física ou reprodução MIDI fiel.

O trabalho desta onda acrescenta documentação e sondagens reproduzíveis em `tests/`. Não altera fontes do instrumento, firmware, DSP, polifonia, controles, formatos ou interface de produção. O build continua gerando cópias derivadas em `.local/`.

## Caminho do áudio

```text
UI / Web MIDI → send → MessagePort → Engine.input → host WASM
                                                    ↓
                      firmware / sequenciador / arp / mixer / FX
                                                    ↓
                          master e clipping do instrumento
                                                    ↓
                         sim_out_l / sim_out_r → AudioWorkletNode
                                                    ↓
                                 GainNode de escuta → saída física
```

- O motor roda em um AudioWorklet com uma instância WASM. O wrapper `web/dsp-worklet.js` preserva o processador original e acrescenta métricas opcionais.
- `upstream/SMKSYNTH/web/simulator/app.js` cria contexto a 44,1 kHz com `latencyHint: 'interactive'`. A inicialização recusa outra taxa: não presumir suporte atual a 48 kHz.
- `upstream/SMKSYNTH/web/simulator/worklet.js` chama `engine.render(n)` e copia dois canais Float32 para a saída. No Chrome testado, os quanta são de 128 frames.
- `upstream/SMKSYNTH/web/sim/sim.c` produz blocos internos de 256 frames, com master e clipping já aplicados. Não há saídas web independentes por parte.
- O master faz parte do som renderizado. O mute da aplicação atua no GainNode posterior. A forma de onda existente analisa esse ganho, depois do mute.
- Recomendação: gravar depois do master/FX do instrumento e antes do mute de escuta. Assim, silenciar a monitoração não destrói a tomada. Esta é uma decisão de produto proposta, ainda não implementada.

## Eventos e fontes musicais

| Fonte | Caminho atual | Consequência para o Studio |
|---|---|---|
| Web MIDI físico | `onmidimessage → message(event.data)` | `event.timeStamp` não é encaminhado |
| Notas externas | `MidiInputController → {t:'midi',st,d1,d2}` | Canal e velocity de note-on preservados; note-off é normalizado |
| Pitch bend | Mensagem MIDI com dois bytes de dados | Mantém os 14 bits recebidos |
| Mod wheel / CC1 | Conversão para `{t:'wheel',w:1,v:...}` | Gravar apenas comandos perde a representação MIDI original |
| Sustain / CC120 / CC123 | Mensagens MIDI existentes | Não são equivalentes entre si nem a um fim de tomada |
| CC com perfil | `MidiProfile.handle → enc/fader/control/...` | Pode aprender, consumir, aguardar pickup ou efetivamente alterar o som |
| Teclado/pads virtuais | Handlers originais enviam `key`, `pad`, `btn` | Não são um fluxo de notas MIDI pronto; pads têm função contextual |
| Controles da interface | Comandos semânticos e edição de timbre | Não passam necessariamente pelo controlador MIDI |
| Arp, sequenciador e DRUM-X | Eventos gerados dentro do firmware | Não aparecem no log de entrada Web MIDI |

O controlador web atual não encaminha todas as mensagens que o firmware conhece: program change, aftertouch, clock e transporte externos não entram pelo caminho normal. Não habilitá-las incidentalmente como parte de uma gravação.

O diagnóstico MIDI existente registra CCs para investigação, não performances. Seus timestamps de recebimento, limite de registros e transmissão explícita para o servidor local não devem ser reaproveitados como gravador musical. A gravação Studio deve ficar local no navegador, sem enviar material musical a esse endpoint.

Existem três registros possíveis, com significados distintos:

1. Mensagens recebidas: o gesto físico, inclusive controles ainda não capturados pelo pickup.
2. Comandos e alterações efetivamente aceitos pelo instrumento: dependem de contexto, revisão e estado do mapeamento.
3. Eventos musicais gerados internamente: notas resultantes de arp/seq/DRUM-X, diferentes das notas que acionaram esses mecanismos.

Salvar somente (1) não transcreve tudo o que foi ouvido. Salvar somente comandos enviados não comprova (2). Inferir (3) das vozes consultadas a 25 Hz perde notas curtas, velocity e eventos entre snapshots. O teste isolado confirma que note-on/off juntos podem deixar zero vozes observáveis no snapshot posterior.

## Relógios e precisão

| Domínio | Situação atual | Uso recomendado |
|---|---|---|
| `performance.now()` / timestamp Web MIDI | Relógio da aplicação; timestamp MIDI descartado no encaminhamento | Registrar recebimento sem tratá-lo como instante de aplicação sonora |
| `currentFrame` / `currentTime` | Relógio do AudioContext | Eixo da captura e transporte; guardar posição em frames |
| `sim_ms()` | Avança conforme as amostras renderizadas | Diagnóstico do firmware; resolução de milissegundos |
| Render do host | 256 frames internos (~5,805 ms) | Considerar buffering e atraso de aplicação no motor |
| Controle DSP, arp e sequenciador | `CTL=16` frames (~0,363 ms), dentro do render interno | Não confundir com a entrega de eventos à entrada do host |
| Snapshots de UI | Aproximadamente 25 Hz (~40 ms) | Visualização, não relógio ou transcrição musical |
| `Date.now()` no DSP Monitor | Relógio civil, grosseiro e não monotônico | Métricas aproximadas de duração; nunca transporte |

`Engine.input` não tem agendamento por timestamp/frame. A sondagem envia uma nota com metadados de um futuro distante e confirma que ela já toca no próximo processamento. Acrescentar campos ao evento não basta para agendá-lo.

O teste confirma que 44.100 frames renderizados avançam exatamente 1.000 ms no relógio do firmware. Isto prova a relação dos relógios no teste determinístico, não latência MIDI de ponta a ponta. O host ainda faz polling a cada milissegundo e mantém um bloco de áudio interno; um evento carimbado na entrada do worklet não é automaticamente o início acústico da nota.

Para o sequenciador novo, será necessário um agendador limitado, antecipação e política de eventos atrasados no domínio do áudio. Não dirigir notas por `setInterval`/desenho da UI. A granularidade audível e compensações precisarão ser medidas antes de prometer precisão por amostra.

Suspensão do AudioContext pausa o tempo musical. Fechar/ocultar a página e trocar foco já liberam notas pelo comportamento legado (`blur`/`visibilitychange`), e a entrada MIDI ignora mensagens quando a página está oculta. Não prometer gravação musical contínua em segundo plano sem discutir uma mudança explícita desse comportamento.

## O que já existe e o que falta

Conforme [auditoria UX](ux-audit.md), fontes e sondagens:

- Quatro partes A–D e pool compartilhado de 256 vozes ANALOG; não há um pool de 256 por pista. SUPER e DRUM-X têm particularidades próprias.
- Seleção de timbres por parte, split/layer, mixer com volume/pan/envios e efeitos compartilhados. Efeitos globais não se tornam independentes por acrescentar pistas visuais.
- Sequenciador com quatro tracks, até 256 steps por track e quatro notas por step; gate/tie, velocity, ratchet, chance, nudge e ENDLESS.
- Quatro lanes de automação por track, com valores por step. Isto não é um editor arbitrário de curvas contínuas.
- Transporte e padrões já existem no firmware. A convivência com um transporte Studio precisa ter uma autoridade definida; não criar dois botões Play com resultados ambíguos.
- Fila MIDI do host compilado de 256 vozes: 1.024 mensagens, já ampliada pelas patches existentes. Não usar o limite de 64 do upstream original como se fosse o limite desta build. Agendamento futuro precisa detectar sobrecarga em vez de perder eventos silenciosamente.
- Não há hoje clipes de áudio web, reprodução por arquivo, gravação de PCM, codificador WAV/MP3 ou projeto Studio.

## Persistência e contexto

O formato legado exportado é `obervave-voice-lab-1`, com schema `smksynth-sim-21blocks-v1`; blobs atuais somam 21 × 16.384 = 344.064 bytes. A aplicação conserva esses blobs em localStorage e exporta/importa JSON, com migração de tamanhos anteriores. Perfil MIDI é separado.

`Engine.store(true)` força a leitura dos blobs persistidos; não executa Save do timbre. No teste desta onda, editar cutoff de 112 para 40 e restaurar esses blobs retorna 112. O estado vivo editado precisa de representação própria para um projeto Studio, preservando Save/Save as do instrumento.

Não serializar memória WASM inteira como formato de projeto: ela inclui detalhes de execução e depende da build. Proposta: manifesto Studio versionado, eventos, áudio em arquivos/blocos e snapshots musicais explícitos. Reutilizar a sessão legada como componente compatível quando adequado, sem alterar seu significado. O mecanismo exato de snapshot vivo e restauração ainda deve ser desenhado.

Armazenamento do navegador não é backup. Na primeira implementação, distinguir recuperação local de um arquivo de projeto exportado. Definir validação, limites, versão, arquivos ausentes e encerramento incompleto antes de aceitar importações. Não guardar áudio longo em localStorage/base64.

Dimensão aproximada a 44,1 kHz, estéreo, sem cabeçalhos:

| Representação | 1 minuto | 10 minutos |
|---|---:|---:|
| Float32 PCM | 21,17 MB | 211,68 MB |
| PCM de 16 bits | 10,58 MB | 105,84 MB |

## Sondagem de captura local

Implementação isolada: `tests/browser-studio-wave-0.mjs`. O teste carrega o instrumento real sem alterar seus módulos, cria dois taps em um processador de teste (antes e depois do mute) e transfere o MessagePort diretamente a um Worker. O Worker grava PCM em OPFS usando arquivo exclusivo do teste. Oito buffers de 4.096 frames são reciclados; os dados PCM não atravessam a thread da interface.

O artefato contém quatro canais apenas para comparar os dois taps; não é WAV nem formato de projeto. São 512 KiB de buffers de transferência, sem SharedArrayBuffer ou novos headers de isolamento. O Worker verifica escrita/leitura, sequência de blocos, continuidade por `currentFrame`, valores finitos e checksum sequencial de 32 bits (não criptográfico). Após reload, o teste verifica tamanho/checksum do arquivo e remove somente seu próprio artefato.

Resultado: PASS no Chrome 157.0.8103.78, Ubuntu, headless, contexto real a 44,1 kHz e MIDI sintético. Ensaio curto de aproximadamente 60 segundos de parede, com suspensão explícita de 250 ms e bloqueio da UI por 1.200 ms. Zero buffers descartados, zero lacunas de sequência/frames e nenhuma amostra não finita. O sinal antes do mute permaneceu não nulo enquanto o sinal posterior ficou em zero. Recuperação após reload passou. Evidência de 60 segundos em `.local/validation/studio-wave-0/capture-60s.json`; após reforçar a detecção de valores não finitos, a versão final passou novamente por 30 segundos, em `capture.json` no mesmo diretório. Nenhum desses ensaios equivale ao teste prolongado pendente.

O heap JS retido da página foi amostrado após GC; o teste limita seu crescimento a 8 MiB. Isto não mede toda a memória do navegador, o heap do Worker, caches do sistema ou toda a memória nativa. Checksum e continuidade não detectam todos os tipos de falha da saída física nem certificam conteúdo musical correto.

No navegador sondado, `MediaRecorder.isTypeSupported` retornou false para `audio/wav` e `audio/mpeg`, true para WebM/Opus. Isto não impede gerar WAV a partir de PCM ou codificar MP3 localmente; impede assumir esses formatos como saída nativa disponível nessa configuração.

## Validação e reprodução

Evidências locais em `.local/validation/studio-wave-0/`; não versionar áudio bruto ou artefatos gerados. As sondagens abrem perfis temporários, sem usar perfil pessoal nem dispositivo MIDI físico.

```sh
sh scripts/build-simulator.sh
sh tests/build-ui-reference.sh
# Usar o servidor existente, ou iniciar se necessário:
python3 scripts/serve-simulator.py
# Em outro terminal:
node tests/studio-wave-0.test.mjs
node tests/browser-studio-wave-0.mjs
# Ensaio prolongado disponível; NÃO executado nesta entrega:
STUDIO_PROBE_SECONDS=1200 node tests/browser-studio-wave-0.mjs
```

O teste de captura é deliberadamente isolado, com código controlado do próprio teste carregado por Blob; não executa código importado de projetos. A duração configurável vai de 30 a 1.800 segundos. O servidor já ativo em 8737 foi reutilizado, sem encerrá-lo. O build e a referência usam as ferramentas locais existentes; não foi instalada dependência nova.

Baseline Node: PASS para verificações upstream e suites `midi-profile`, `midi-diagnostic`, `knob-pickup`, `polyphony-256`, `dsp-monitor`, `voice-mode-action`, `ui-foundation`, `tone-selector` e `tone-editor`. O teste UI compara 256.000 amostras escalares com a referência anterior à UI; o DSP Monitor verifica áudio idêntico com monitor off/live/capture. Nenhuma alteração de alocação nesta onda requer nova expansão das etapas anteriores de voz.

Baseline Chrome: PASS nas cinco suites — UI Foundation, UI Foundation v2, tone selector, tone editor e 256 vozes. Resumo em `.local/validation/studio-wave-0/browser-baseline.json` e logs individuais no mesmo diretório.

SHA-256 do WASM de 256 vozes reconstruído e servido: `2111700f3cd96126f47af01d84c48093016c34f4d81ae86341972dbc41acfaac`.

## Limites desta conclusão

- Não foi executado ensaio de captura de 20–30 minutos. A execução de um minuto é prova inicial, não duração mínima suportada do produto.
- Não foram medidos latência física MIDI→áudio, desvios de início de nota, alinhamento MIDI/PCM, underruns do dispositivo ou precisão de reprodução MIDI.
- A carga da captura é um acorde de quatro notas em POLY. As regressões de 256 vozes são separadas e não comprovam captura prolongada nessa carga.
- Suspensão/retomada explícita foi testada, mas não perda real do dispositivo, crash, disco cheio, cota esgotada ou recuperação após encerramento forçado no meio de uma escrita.
- Não foi testada independência sonora por pista, exportação MP3, offline/PWA, outros navegadores, mobile ou gravação física.

Esses limites não exigem migração para nativo; são itens de validação e escopo antes de promessas correspondentes. Ensaio prolongado e alinhamento de eventos devem ser critérios de engenharia da onda 1, antes de sua aprovação final.

## Recomendação para a onda 1

Construir um gravador de tomadas estéreo, com estado explícito (pronto, gravando, finalizando, disponível, incompleta/erro), duração e indicador de integridade. Uma tomada por vez inicialmente. Gravar PCM em blocos no Worker e ouvir a tomada separadamente da execução ao vivo do synth. Exportar WAV; salvar e reabrir o projeto com seu áudio e contexto definido. Não introduzir piano roll editável, múltiplas pistas de áudio ou MP3 nesta primeira entrega.

Decisões que precisam ser fechadas com o usuário:

1. **Captura de som:** recomendar saída do instrumento com master/FX, antes do mute de escuta. Definir se Stop encerra imediatamente ou inclui uma cauda; Stop da gravação não deve enviar panic nem interromper notas tocadas.
2. **Eventos:** recomendar registrar entrada MIDI suportada com timestamp e origem, além de comandos das fontes virtuais/controles. Identificar diferenças entre recebimento e aplicação; não chamar esse log de transcrição completa do arp/seq. Se notas geradas forem requisito da primeira entrega, incluir instrumentação própria e seu custo no escopo.
3. **Projeto e fidelidade:** preservar o áudio como referência da performance e definir snapshot vivo. Não prometer que apenas o dump da sessão legada reproduz exatamente a tomada. Não restaurar um projeto ou substituir uma tomada com trabalho pendente por ação de navegação.
4. **Critérios mensuráveis:** propor desktop Chrome/Chromium inicialmente, ensaio de 20 minutos na carga musical acordada, nenhuma perda de blocos entregue ao gravador, memória limitada e falhas explícitas. Medir alinhamento antes de fixar tolerância; latência física depende de ensaio com o usuário.

A autorização desta onda não inicia a onda 1. O próximo passo é discutir essas decisões, aprovar seu escopo e registrar os critérios antes da implementação.

## Registro de fechamento da onda 0

- **Implementado:** controle das ondas, diagnóstico da arquitetura e duas sondagens isoladas; nenhum recurso novo no instrumento de produção.
- **Efetivamente testado:** baseline Node/upstream (10 verificações), cinco suites Chrome, captura de 60 segundos e repetição final de 30 segundos com bloqueio da UI, suspensão e recuperação após reload.
- **Limitado:** sem ensaio prolongado, alinhamento MIDI/PCM de ponta a ponta, validação física ou certificação de quantidade de pistas.
- **Decisões:** recomendar navegador, captura por blocos antes do mute, distinção entre entradas/comandos/notas geradas e contexto vivo separado do Save do timbre.
- **Próximo passo:** onda 1. Posteriormente, o usuário autorizou seguir pelas ondas propostas; consultar `studio-waves.md` para o estado atual.
