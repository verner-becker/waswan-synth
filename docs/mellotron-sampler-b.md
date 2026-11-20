# Marco B · Mellotron de dois bancos

## Ensaio no SMK-37 Pro

1. Abrir o [simulador local](http://localhost:8737/simulator/), iniciar em **Start audio** e conectar o SMK-37 Pro na configuração MIDI. Em **Performance**, selecionar a parte A com um timbre Analog comum e o modo **POLY**.
2. Abrir **Mellotron · Part A** e escolher **Rehearsal flute** em **Instrument**. Com **Layer → None** ouve-se só a flauta. Selecionar **Rehearsal strings** em **Layer** e tocar a mesma frase com **Layer mix (%)** em 0, 100 e 50. **Use Synth on Part A** devolve o teclado ao timbre da parte.
3. Em modo de fita, sustentar uma tecla por alguns segundos, soltá-la e repetir imediatamente. Repetir depois de um segundo em repouso para ouvir o início novamente. Cada tecla retorna a 8×. Uma gravação curta pode acabar antes dos oito segundos. Marcar **Continuous loop** para manter a fita tocando. Experimentar o pedal e o pitch bend em um acorde, trocar de tela com as notas soando e verificar a liberação ao tirar o pé do pedal.
4. Para gravar o **áudio** tocado no Synth, armar uma pista de áudio na DAW e escolher a entrada interna do WASWAN. Para gravar ou editar **MIDI**, usar uma pista de instrumento com o preset **Mellotron · loaded banks** e direcionar a entrada MIDI a essa pista. O preset captura a mistura e os controles atuais. Selecioná-lo novamente para adotar novos ajustes.
5. Ouvir a tomada e os WAVs exportados da pista e do master. Conferir mute, solo, notas repetidas, tempo de resposta, estalos e notas presas. Para o aceite físico, registrar sistema, versão do Chrome, porta MIDI, saída de áudio e o trecho em que ocorreu qualquer falha.

## Usar gravações próprias ou autorizadas

Em **Tape settings and library → Open tape folder**, escolher a pasta que contém as subpastas de bancos. Cada WAV deve ser mono PCM16 a 44,1 kHz, com até oito segundos. A árvore abaixo exemplifica a nomeação pela nota-raiz MIDI.

```text
Minhas fitas/
  Flauta/
    48.wav
    60 Flauta.wav
  Cordas/
    55 Sol.wav
    67.wav
```

A pasta principal é a biblioteca e cada subpasta contém um instrumento. Também é possível abrir diretamente a pasta de um timbre, como `CHOIR`, com os WAVs na raiz. Em **Open tape folder**, essa escolha carrega o instrumento na parte A. Ao reabrir o synth, use **Play selection**. Para acessar os outros timbres ou combinar duas fitas, use **Open library folder…** e selecione a pasta principal. Escolher o timbre em **Instrument** já o coloca na parte A. **Layer** acrescenta um segundo timbre. O cabeçalho mostra o som confirmado. Se houver notas sustentadas durante a troca, soltá-las e clicar em **Play selection**. Cada tecla usa a raiz mais próxima de cada banco. Em empate vale a raiz mais grave. O limite é de 48 regiões e 16 MiB de PCM por par. O navegador guarda o acesso à pasta e os nomes dos bancos. Depois de reiniciar o Chrome, clicar em **Play selection** para reler os arquivos e renovar a permissão quando solicitada. Os projetos guardam os nomes, uma assinatura do conteúdo e os controles por pista. Se os arquivos mudarem, o usuário pode selecionar o novo som explicitamente no preset da pista.

## Implementação

O leitor Hermite de quatro pontos deriva da adaptação do Marco A do FMEL-1 de AntonioAltea, port para SMK-37 de M. Geisler, SMKTRON `3428613`, GPL-3.0-only. Cada voz ativa tem duas cabeças de leitura no mesmo host WASM. O leitor seleciona a região pelo número da tecla e acompanha bend, transposição e afinação fina. A dinâmica é fixa por padrão, com resposta opcional à velocity. Ataque, release, wow, flutter, desgaste e saturação pertencem à configuração do Mellotron.

A página confere os WAVs e prepara os dados antes de enviá-los ao worklet em blocos de até 64 KiB. A área de preparação é separada do par em uso. A troca ocorre depois da última cópia e exige que as notas afetadas tenham terminado. A memória linear cresce sob demanda em áreas reutilizáveis de 16 MiB, até duas áreas. As duas cabeças compartilham a voz do alocador existente. O teclado do Synth e as pistas usam as rotas de captura e mixagem do host. Todas as pistas Mellotron usam o mesmo par carregado e podem ter ajustes diferentes. As fitas históricas de terceiros dependem de autorização de distribuição.

## Validação de software em 19/11/2026

| Ensaio | Resultado |
|---|---|
| Leitura e transporte | O host distinguiu a primeira e a segunda metade de uma fita de teste ao repetir a tecla antes e depois do retorno. Uma fita de oito segundos terminou no fim da gravação. O loop continuou após o fim da amostra. |
| Duas cabeças | O espectro confirmou os bancos isolados, a mistura e a transposição de uma oitava. O pedal manteve a nota após Note Off, o bend deslocou a frequência e o panic liberou as vozes. Com um timbre de apoio neutro, a resposta fixa produziu a mesma amplitude nas velocities 35 e 110. A resposta opcional elevou a amplitude com a velocity. |
| Carga | Em Node, com 12 notas, duas cabeças por voz e os quatro efeitos de fita ativos, o percentil 99 ficou abaixo de 0,4 ms em 2.048 blocos de 128 frames. A janela de áudio por bloco é de 2,90 ms. A memória linear passou de 2.031.616 para 35.586.048 bytes após reservar as duas áreas de PCM. A tentativa de trocar de par com notas soando preservou o par ativo. |
| Performance no Chrome | Os bancos de ensaio tocaram com MIDI simulado. Uma nota continuou sustentada ao mudar de tela e cessou após desconectar a porta simulada. O teste selecionou bancos WAV por handles de diretório, fechou o Chrome, reabriu o mesmo perfil e recuperou as seleções e os arquivos. O teste substitui o diálogo nativo por uma pasta de teste isolada do navegador. |
| DAW no Chrome | Gravação interna estéreo de 88.200 frames com pedal, bend e repetição de tecla. A exportação da composição e a da pista produziram WAVs de 66.150 frames com as três alturas esperadas. A pista de fita mudou de ordem, e a exportação individual usou outro slot do host. A pista vazia, o solo dessa pista e o master com a pista de fita em mute produziram silêncio. A sessão manteve um AudioContext. |
| Regressões | Build do simulador e referência de UI, duas suítes Chrome de UI, regressões de UI, MIDI/pickup, 256 vozes, DSP Monitor, Analog, FM, gravação, projetos, exportação e a prova do Marco A. A comparação de áudio da UI preservou 256.000 amostras escalares da referência. |

A comparação inicial dos WAVs revelou que o panorama e a afinação vintage do timbre Analog de apoio variavam com a voz alocada. O preset Mellotron da DAW agora usa panorama central e afinação neutra. A medição do host cobre processamento de software. Latência percebida, pedal físico, resposta à repetição, fidelidade e eventuais estalos ficam para o ensaio no instrumento. Leslie, echo e reverb dedicados ficam para avaliação musical posterior.

Para reproduzir, executar o build normal e servir o simulador na porta 8737. Rodar `node tests/mellotron-b/library.test.mjs`, `node tests/mellotron-b/host.test.mjs` e `node tests/mellotron-b/browser.mjs`. As medições, os WAVs e a captura da interface ficam em `.local/validation/mellotron-b/`. O próximo passo é registrar o ensaio físico antes de decidir ajustes de tocabilidade.

## Pastas do instrumento

Em **Instrument setup → Library folders**, escolha a pasta dos bancos de timbres (`.wstone`), a pasta das fitas do Mellotron (uma subpasta por banco) e a pasta de samples reservada ao Marco C. O IndexedDB do perfil guarda referências às pastas e nomes de bancos. O áudio fica no disco. Ao reabrir o synth no mesmo endereço, os bancos voltam ao seletor **Bank** e ao painel **Mellotron · Part A**, disponível em **TONES** e **Performance**. Com acesso de leitura, o synth atualiza a lista de subpastas ao iniciar. Se o navegador pedir nova permissão, use **Allow access** no cadastro. Se a pasta mudou de lugar, use **Choose folder…**.

Para o ensaio local, selecione `.local/libraries/SMKTRON ML1` em **Mellotron tapes**. O download corresponde à edição ML1 do SMKTRON em `3428613`. São 46 regiões preparadas para o firmware, convertidas de IMA ADPCM a 11.025 Hz para WAV mono PCM16 a 44.100 Hz. FLUTE, CHOIR e CELLO têm 12 notas-raiz cada e VIOLINS tem 10. Os créditos e a origem acompanham os WAVs no disco. As gravações de Bernie Kornowicz têm termos próprios para uso não comercial. [Dados de áudio da edição ML1](https://github.com/4t59m4f784-creator/SMKTRON/blob/342861317896d316f44e1da66e3dfd2b7bf273ab/experiments/appearance/engine/firmware/gen/smktron_strings_tapes.h) · [Créditos das gravações](https://github.com/4t59m4f784-creator/SMKTRON/blob/342861317896d316f44e1da66e3dfd2b7bf273ab/web/CREDITOS.md)

No Chrome, `node tests/browser-library-folders.mjs` usa um perfil de teste e diretórios do OPFS para conferir o cadastro, a reabertura do navegador, a descoberta de um novo banco e a renovação de permissão. O ensaio local das fitas passou os WAVs pelo carregador do simulador e mediu sinal no master com os pares FLUTE + CHOIR e CELLO + VIOLINS. Evidência em `.local/validation/library-folders/`. A seleção pelo diálogo nativo no perfil do músico e a escuta no SMK-37 Pro dependem do ensaio físico.
