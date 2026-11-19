# Roadmap musical do WASWAN Mellotron e do WASWAN Sampler

Primeiro, abrir um banco de fitas, tocar um acorde no SMK-37 Pro e gravá-lo na DAW. Depois, repetir a experiência com gravações próprias, distribuídas pelo teclado e salvas em uma pasta que o músico pode levar para outra máquina.

| Marco | O que o músico consegue fazer ao final | Dependência |
|---|---|---|
| A · Prova do núcleo | Tocar um WAV de teste em três alturas e reconhecer a frase no arquivo exportado | [Concluído em software no host e no Chrome](mellotron-sampler-a.md) |
| B · Mellotron tocável | Abrir fitas autorizadas, combinar dois bancos, tocar e gravar com o comportamento de fita | [Validado em software, pronto para ensaio no SMK-37 Pro](mellotron-sampler-b.md) |
| C · Sampler tocável | Transformar gravações próprias em um instrumento polifônico, salvar e reabrir | B entrega reprodução, eventos e biblioteca física |
| D · Aceite conjunto | Reabrir um projeto, tocar com FM e subtrativo e exportar a música e suas pistas | B e C disponíveis para ensaio integrado |

## Ponto de partida

Base do planejamento em 19/11/2026: WASWAN `df82b4f` e SMKTRON `3428613` (ML1). Na sondagem anterior em Node, o binário original produziu um acorde por `web_key` a 44,1 kHz e liberou as três teclas. Velocities 32 e 112 produziram PCM idêntico no trecho comparado. No modo synth inicial, o mesmo acorde enviado por `web_midi` produziu a mesma saída do controle em repouso. Esses resultados descrevem o binário de referência. Na data do planejamento, a integração, o desempenho em Chrome e o aceite físico estavam pendentes. Os ensaios posteriores constam no fechamento de cada marco. [Build ML1](https://github.com/4t59m4f784-creator/SMKTRON/blob/3428613/experiments/midi-layers/build.py) · [Worklet de referência](https://github.com/4t59m4f784-creator/SMKTRON/blob/3428613/web/worklet.js)

**Arquitetura proposta.** Adaptar as cabeças de leitura, a seleção de zonas, a interpolação e o transporte de fita de `mel.c` para receber dados preparados pelo host. Manter um AudioContext e a instância atual do instrumento. O WASM publicado permite uma comparação sonora rápida, mas incorpora fitas e funções do firmware e não expõe carregamento de WAVs. Um worklet dedicado só merece reconsideração se o experimento revelar um impedimento concreto no host atual. Os arquivos `grain_audio.h` e `grain_render.h` implementam processamento granular opcional. [Motor de fita](https://github.com/4t59m4f784-creator/SMKTRON/blob/3428613/firmware/firmware/src/mel.c) · [Arquitetura FM e polifonia compartilhada](fm-layer.md)

## Marco A · Da primeira nota ao WAV exportado

1. Registrar a revisão, os arquivos GPL-3.0-only aproveitados, seus autores e as adaptações. Usar um WAV próprio ou com autorização documentada. Os quatro bancos do SMKTRON têm termos específicos das gravações de Bernie Kornowicz. Isso abrange as fitas codificadas nos headers e no binário. [Créditos e procedência](https://github.com/4t59m4f784-creator/SMKTRON/blob/3428613/web/CREDITOS.md)
2. Carregar um WAV mono curto de uma pasta escolhida e preparar uma região com nota-raiz. Reproduzi-la no host atual usando o código de leitura adaptado. Usar uma gravação de afinação conhecida para conferir raiz, transposição e duração. Reservar os buffers antes de tocar. Leitura, validação e decodificação ficam fora do processamento de áudio.
3. Fazer a mesma frase percorrer a entrada ao vivo e o sequenciador da DAW. Associar a nota à sua origem, parte e destino até o Note Off. A captura interna usa a saída 0 do instrumento, enquanto o mixer usa saídas por parte e a exportação lê o master ou a pista. Conferir cada percurso com uma segunda pista silenciosa para detectar vazamento ou duplicação. [Host](../web/dsp-worklet.js) · [Mixer](../web/daw-player.js) · [Gravação](../web/daw-recording.js) · [Exportação](../web/daw-audio-export.js)
4. Comparar a baseline com o mesmo projeto, taxa e tamanho de bloco. Medir tempo de renderização, memória residente das amostras e crescimento durante a carga. As 12 vozes do SMKTRON são uma carga de ensaio. Registrar como notas, segunda cabeça e vozes em release serão contabilizadas dentro da política global do WASWAN. Qualquer expansão da polifonia exige decisão explícita.

**Aceite de A.** Um acorde de três notas tem as alturas esperadas, termina após o release e aparece uma vez na captura interna, no master exportado e na pista correta. A pista silenciosa continua silenciosa. Registrar o trecho de código reaproveitado, o que precisou ser adaptado e os limites propostos de vozes, regiões e bytes decodificados para B/C. Se o núcleo não puder usar uma amostra externa, documentar onde falhou e o custo das alternativas antes de iniciar B.

## Marco B · Mellotron tocável

- **Primeira sessão musical.** Escolher a pasta física, abrir um banco autorizado e tocar pelo teclado virtual, MIDI e pista da DAW. Reutilizar os controles e o roteamento do WASWAN. Validar Note Off, sustain, bend, panic, desconexão MIDI e mudança de tela enquanto uma nota soa. Começar com dinâmica fixa para reproduzir o ML1 e oferecer resposta à velocity como opção.
- **Comportamento de fita.** Entregar dois bancos com balanço, transposição, afinação fina, ataque e release, loop contínuo e modo de fita de oito segundos com retorno por tecla a 8×. Conferir o retorno parcial repetindo a nota antes e depois de a fita rebobinar. Priorizar wow, flutter, desgaste e saturação. Avaliar Leslie, echo e reverb após medir o custo com dois bancos. [Efeitos de fita](https://github.com/4t59m4f784-creator/SMKTRON/blob/3428613/firmware/firmware/src/mel_fx.c)
- **Bancos e acesso.** Permitir importar flauta, coral, violoncelo e violinos conforme disponibilidade e direitos de cada coleção. Para o primeiro ensaio de mistura bastam dois bancos próprios ou autorizados. Usar a seleção de pasta e o fluxo de renovação de permissão já existentes, com referência própria para a biblioteca de amostras. [Biblioteca de timbres](../web/tone-bank.js) · [Fluxo de permissões](../web/ui-tone-banks.js)

**Aceite de B.** Gravar uma frase com pedal, bend, dois bancos e repetição rápida da mesma tecla. Verificar o comportamento da fita, mute/solo e presença da frase na tomada e no WAV exportado. Fechar o Chrome, reabrir a biblioteca e recuperar a seleção após nova permissão, se necessária. Registrar separadamente a execução automatizada e a experiência ao tocar no SMK-37 Pro.

## Marco C · Das nossas gravações a um sampler tocável

1. **Importar.** Selecionar WAVs, validar cabeçalho e comprimento e copiar os bytes originais para a pasta física. Subconjunto inicial proposto: WAV PCM inteiro de 16 bits, mono ou estéreo, a 44,1 kHz. Mostrar o motivo de rejeição dos demais formatos. Preservar ambos os canais. O gerador de fitas upstream seleciona um canal e ajusta níveis para ADPCM, decisões próprias da preparação do Mellotron. [Gerador de fitas](https://github.com/4t59m4f784-creator/SMKTRON/blob/3428613/firmware/tools/gen_tapes.py)
2. **Mapear e tocar.** Começar com uma amostra e sua nota-raiz. Acrescentar regiões com nota mínima, máxima e raiz, ganho, resposta à velocity, ADSR e modo one-shot ou loop. Expressar início, fim e crossfade opcional do loop em frames da amostra. Para o MVP, rejeitar regiões sobrepostas com mensagem que identifique o conflito. Uma nota fora das regiões fica em silêncio.
3. **Salvar e recuperar.** Usar um `instrument.json` versionado, legível, com regiões e caminhos relativos. Validar nomes, colisões, caminhos externos, intervalos e pontos de loop. Publicar o mapa depois de concluir as cópias. Uma importação interrompida deve preservar o último instrumento íntegro. Ao encontrar WAV ausente ou pasta movida, identificar a referência a corrigir e permitir revincular a biblioteca pelo seletor.
4. **Controlar memória.** Pré-carregar apenas o instrumento necessário, compartilhar a amostra entre regiões e vozes e liberar o buffer quando a última voz deixar de usá-lo. Dimensionar os limites a partir de A e medir o pico ao trocar de instrumento com sustain ativo. Avaliar streaming apenas se a carga musical de referência ultrapassar o orçamento medido.

**Contrato de armazenamento.** WAVs, bancos, regiões, presets, metadados e configurações do instrumento vivem na pasta selecionada pela File System Access API. IndexedDB pode lembrar o handle, referências e pequenas preferências de interface. IndexedDB, localStorage, Cache Storage e OPFS ficam fora do caminho de persistência de áudio da biblioteca. O projeto DAW referencia o instrumento por identificador e caminho relativo; tomadas gravadas e exports continuam seguindo os fluxos próprios da DAW. O formato versionado permite acrescentar camadas de velocity, articulações e release samples em uma revisão futura.

**Aceite de C.** Importar três gravações próprias, incluindo uma estéreo com canais distinguíveis. Montar três regiões, tocar um acorde que atravesse suas fronteiras e conferir transposição, canais, envelope, one-shot e loop. Salvar, fechar o Chrome, reabrir e repetir a frase. Comparar hashes dos arquivos de origem e das cópias; mover a pasta e revinculá-la; testar arquivo truncado, sample ausente, colisão e permissão revogada.

## Marco D · Aceite musical e regressões

| Ensaio | Evidência para encerrar |
|---|---|
| Execução física | No SMK-37 Pro, tocar acordes, repetir notas, usar pedal e bend, mudar de tela e acionar panic. Registrar controlador, sistema, versão do Chrome e observações de escuta. |
| Convivência na DAW | Reabrir projeto anterior e um projeto com Mellotron, sampler, FM e subtrativo. Gravar MIDI e áudio, reproduzir, testar mute/solo e exportar master e pistas. Conferir que cada nota aparece uma vez no destino esperado. |
| Persistência | Em perfil de teste, comparar armazenamento antes e depois de importar bancos de tamanhos diferentes. Inspecionar os stores e verificar que seu crescimento corresponde apenas às referências. Reabrir o Chrome e conferir os WAVs e o JSON na pasta real. Isolar esse ensaio da gravação de tomadas da DAW. |
| Desempenho | Repetir a carga de A com acordes, sustain, dois bancos, estéreo e trocas. Registrar vozes ativas, picos de memória, duração de blocos, perdas de captura e resolução do relógio. Usar o DSP Monitor onde mede o trabalho executado. [Limites da medição](dsp-monitor-v1.md) |
| Regressão | Executar testes Node e Chrome pertinentes de MIDI/pickup, 256 vozes, DSP Monitor, FM/DX7, presets, biblioteca física, UI, gravação e exportação. Se o alocador mudar, incluir as etapas anteriores de polifonia. [Instruções de validação](../AGENTS.md) |

## Entrega e decisões

Cada marco fecha com a revisão testada, resultado reproduzível, evidências em `.local/validation/`, limitações e próximo passo. Desenvolver em branch dedicada e integrar à `main` apenas com autorização explícita. O Marco A validou o núcleo adaptado com uma região mono. O Marco B entregou os dois bancos no simulador. O próximo passo é o [ensaio físico no SMK-37 Pro](mellotron-sampler-b.md). A próxima implementação prevista é o sampler do Marco C.

As decisões em aberto são quais gravações poderão acompanhar uma distribuição, qual carga o host sustenta e quais efeitos opcionais cabem nela. O aceite físico depende de tocar e ouvir o instrumento no equipamento. Editor avançado de waveform, slicing, time stretching, granular e IA ficam fora destas quatro entregas.
