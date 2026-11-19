# Marco A · Um WAV externo tocado pelo WASWAN

**Resultado em 19/11/2026.** O Chrome tocou três alturas a partir de um WAV mono lido do disco. A DAW gravou o acorde pela entrada de áudio interna e exportou uma frase do sequenciador no master e na pista de instrumento. As três frequências estão presentes nos três arquivos. A pista vazia e o master com a pista de instrumento em mute contêm somente zeros. A prova está disponível em um endereço próprio do simulador local. [Roadmap](mellotron-sampler-roadmap.md)

## Tocar a prova

Com o build normal do WASWAN e as ferramentas do repositório disponíveis, executar na raiz:

```sh
sh tests/mellotron-a/build.sh
node tests/mellotron-a/host.test.mjs
python3 scripts/serve-simulator.py --port 8740
```

Abrir [a prova local](http://localhost:8740/mellotron-a/). Em **Open sample folder**, escolher uma pasta com um WAV **PCM16 mono de 44.100 Hz, até dois segundos**. Também é possível usar **Or open WAV** para escolher um arquivo individual. O teste Node cria uma amostra em `.local/validation/mellotron-a/reference-C4.wav`. Com raiz 60, as teclas MIDI 60, 64 e 67 devem produzir 220, 277,18 e 329,63 Hz. A gravação de teste contém uma senoide de 220 Hz deliberadamente mapeada para o dó central.

Escolher **Load instrument** e depois **Start audio**. Em Performance, tocar a primeira parte do Synth; na DAW, atribuir um timbre Analog comum à primeira pista MIDI. No protótipo, essas duas rotas recebem o WAV durante a sessão. Para trocar a amostra, recarregar a página. Usar uma porta exclusiva para a prova permite manter os dados de sessão da DAW em uma origem separada. A página normal em `/simulator/` continua servindo o build habitual.

## Arquitetura e procedência

- A cabeça de leitura adapta a fase fracionária e o interpolador Hermite de quatro pontos de `head_run`, no `mel.c` do SMKTRON `342861317896d316f44e1da66e3dfd2b7bf273ab`. Autoria do núcleo FMEL-1 de AntonioAltea, port para SMK-37 de M. Geisler e adaptações do projeto SMKTRON sob direção musical de Marcus Padrini. A adaptação está sob GPL-3.0-only. O banco de teste é sintetizado localmente pela suíte. [Fonte original](https://github.com/4t59m4f784-creator/SMKTRON/blob/3428613/firmware/firmware/src/mel.c) · [Créditos do projeto](https://github.com/4t59m4f784-creator/SMKTRON/blob/3428613/web/CREDITOS.md) · [Código adaptado](../tests/mellotron-a/sample-head.h)
- A leitura PCM substitui a leitura sequencial de ADPCM e seus checkpoints. Um cursor Q16 por voz usa a razão de frequências entre a nota tocada e a raiz. O host fornece envelope, afinação, panorama, alocação e destino do áudio. O mixer e o gravador usam seus caminhos habituais. Cada nota em modo POLY consome uma voz do pool global. O mesmo PCM atende todas as vozes.
- Arquivo e cabeçalho são lidos e validados na página da prova. Na inicialização do worklet, os dados são copiados uma vez para um buffer WASM reservado. A cabeça de leitura usa apenas o cursor e amostras já residentes durante a reprodução. A biblioteca de timbres e o formato dos projetos continuam com seu fluxo original. O vínculo experimental entre amostra e parte dura uma inicialização e ainda não constitui um instrumento salvo.
- Decisão para B: prosseguir com o núcleo adaptado no host atual. O grafo testado usa um AudioContext e uma instância de instrumento. A prova cobre a leitura e o roteamento; a posição de fita por tecla, o rebobinamento, a segunda cabeça e os efeitos de fita entram em B.

## Validação executada

| Ensaio | Resultado |
|---|---|
| Host em Node | O caminho desativado produziu PCM bit a bit idêntico ao build habitual no acorde de controle. Três notas ao vivo e uma nota de sequenciador da mesma altura ocuparam quatro vozes. O Note Off do sequenciador preservou as três notas ao vivo. Após liberação e release, os sinais secos das duas rotas chegaram a zero. |
| WAV e afinação | O leitor rejeitou canais, taxa, tamanho RIFF e tamanho de dados incompatíveis. Na gravação e nos exports, a projeção espectral nas três frequências da fixture superou em mais de 8× o nível nos pontos de controle. O oráculo também verifica clipping no acorde seco. |
| Gravação no Chrome | Chrome 157.0.8103.78 headless, MIDI simulado, arquivo físico selecionado pela entrada de arquivo. A tomada estéreo contém 88.200 frames a 44,1 kHz, com o monitor de escuta silenciado. O seletor nativo de pasta ficou para teste manual. |
| Exportação no Chrome | Master e pista com 66.150 frames cada. A amplitude de cada frequência concordou entre ambos dentro da tolerância de 7%. Há silêncio antes e depois da frase. A escrita final dos exports foi recolhida em memória pelo teste e os bytes foram salvos em disco pelo Node. Captura, mix e codificação WAV usaram a DAW real. |
| DSP Monitor | Nove janelas, 3.105 blocos de 128 frames, máximo observado de 1 ms e zero blocos classificados acima do orçamento. O relógio disponível foi Date.now com resolução nominal de 1 ms. Falhas na saída física exigem ensaio de escuta. |
| Regressões no build habitual | Passaram MIDI profile, knob pickup, camada FM, importação DX7, captura DAW, runtime DAW, gravação DAW, 256 vozes e DSP Monitor. A referência de UI foi reconstruída, a suíte UI Foundation passou e as duas suítes Chrome de UI Foundation passaram. |

O primeiro ensaio de exportação revelou distorção durante quedas de nível. O divisor sem sinal tornava incorreta a interpolação descendente do envelope. A correção usa aritmética com sinal. O teste agora exige separação espectral do acorde e verifica o pico do sinal seco.

### Custo observado

Medição Node do mesmo host, com um timbre analógico na baseline e o WAV no experimento. Cinco rodadas com ordem alternada, após aquecimento. Cada valor é a mediana das médias de 512 chamadas de renderização, em milissegundos por bloco de 128 frames. Este ensaio mede o host WASM nessa máquina. A comparação com dois bancos, estéreo e efeitos fica para B/C.

| Carga | Baseline | Leitura PCM |
|---|---:|---:|
| 3 notas | 0,0528 ms | 0,0492 ms |
| 12 notas | 0,0708 ms | 0,0586 ms |

A memória linear WASM passou de 1.966.080 para 2.162.688 bytes (+192 KiB). O buffer mono tem 176.400 bytes reservados desde o boot; o WAV de teste tem 176.444 bytes com cabeçalho. A preparação mantém temporariamente dados no navegador enquanto os copia. O pico total de RAM do processo Chrome não foi medido.

## Limites e próxima entrega

**Proposta de ensaio para B.** Começar com 12 notas, duas cabeças por nota e até 48 regiões compartilhadas entre os dois bancos carregados. Testar um orçamento inicial de 16 MiB de PCM residente: 48 regiões mono de três segundos em PCM16/44,1 kHz ocupariam cerca de 12,1 MiB. São hipóteses para medir, inclusive durante trocas com sustain ativo. A prova de A mediu **uma região e uma cabeça por nota**. Para C, confrontar o mesmo orçamento com amostras estéreo e rejeitar cargas acima do limite antes de substituir o instrumento atual.

A próxima entrega deve permitir importar dois bancos autorizados de uma pasta física, tocar a mesma tecla antes e depois do retorno da fita e reabrir o instrumento após reiniciar o Chrome. A identificação do instrumento na pista precisa sobreviver a reordenação e exportação individual. Em A o vínculo é deliberadamente fixo na primeira parte ao vivo e no primeiro slot extra do sequenciador. Sons originais de fita, sustentação e bend no SMK-37 Pro, latência física e fidelidade musical aguardam ensaio próprio.

### Reproduzir a validação de navegador

Com o simulador servido pelo script normal na porta 8737, executar `node tests/mellotron-a/browser.mjs`. O teste lança um Chrome temporário. Os WAVs de entrada, tomada, master, pista, controles de silêncio e relatórios JSON ficam em `.local/validation/mellotron-a/`. O código de reprodução, os testes e o gerador da amostra estão versionados; os arquivos de áudio podem ser recriados. [Sondagem do host](../tests/mellotron-a/host.test.mjs) · [Gravação e exportação no Chrome](../tests/mellotron-a/browser.mjs)
