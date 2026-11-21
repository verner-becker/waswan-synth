# Sampler Studio · do som à pista

Abra **Sampler Studio** na barra do WASWAN e clique em **Start audio** para tocar. Em **Library & Metadata**, escolha a pasta que vai guardar seus samples e instrumentos. Ao reabrir o navegador, use **Allow folder access** se a pasta pedir acesso novamente.

Para transformar um trecho em instrumento com raiz, envelope e loop sugeridos, abra **Auto Instrument Wizard**. [Guia do assistente e ensaios](auto-instrument-wizard.md)

## Extrair três segundos de uma gravação

1. Em **Sample Editor**, use **Import WAV…**. A waveform mostra os canais separados. Arraste sobre o trecho que quer aproveitar ou digite o início e o fim em frames ou segundos. O fim é exclusivo.
2. Use **Zoom to selection** e **Preview selection** para conferir o ataque e o corte. **Create Sample from Selection** abre um novo recorte. Sua primeira posição agora é o frame zero. **Back to source take** volta à tomada completa para buscar outro trecho.
3. Em **Processing Stack**, adicione **Pitch Shift** e ajuste os semitons. Coloque os fades no final da cadeia quando quiser que suavizem as bordas do áudio já transposto. Ouça antes e depois de um estágio. **Render Version** grava um novo WAV e **Continue editing rendered version** permite usá-lo como entrada da próxima edição.
4. Dê um nome em **Working name** e defina **Root note (MIDI)**. **Suggest root note** ajuda em sons de altura definida. Você pode entrar com a raiz manualmente para uma textura ou um ataque sem altura estável.
5. Use **Save Working** para guardar o rascunho. Selecione **Working Copy** em **Keyboard source** e use **Play on Synth keyboard** para experimentar a resposta em várias notas. **Release Synth keyboard** devolve o teclado ao som anterior.
6. Use **Promote to Official** depois de ouvir o resultado. Para usar a publicação em uma composição, selecione uma pista MIDI na DAW e clique em **Assign Official to selected DAW track**. Projetos que apontam para outras revisões conservam sua escolha.

## Editar um loop e criar slices

Em **Sample Editor → Advanced waveform tools**, amplie o trecho e ajuste o cursor em frames. O snap do ponteiro pode usar grade, marcadores ou cruzamento de zero do canal esquerdo/mono. A entrada numérica continua disponível para colocar um limite em um frame exato. Use **Suggest loop points** para comparar candidatos e **Use suggested points** para mover a seleção ao intervalo escolhido. Use **Repeat selection** para ouvir a junção, escolha o modo de loop e o crossfade em frames e aplique **Use selection as region loop**. Para outra região do instrumento, selecione-a no mapa e use **Open selected region waveform**.

Insira marcadores com o cursor, pela grade de andamento ou por detecção de transientes. Revise os frames, envie para **Use slices in kit builder** e monte o kit. O rascunho e os checkpoints guardam os marcadores da fonte. Para usar as posições de um resultado processado em um instrumento, materialize o WAV com **Render Version**.

## Recuperar um experimento

Em **Versions & History**, dê um nome ao **Create Checkpoint** antes de uma mudança que queira comparar. Selecione os dois estados em **Compare A** e **Compare B** e use **Listen A** e **Listen B**. A waveform e a escuta de referência de um mapa representam o sample indicado na tela. Para comparar os mapas completos com as suas notas e dinâmicas, use **Play A on Synth keyboard** e **Play B on Synth keyboard**. Depois use **Release Synth keyboard** para devolver a rota.

Em **Full history**, **Restore Checkpoint** abre outra cópia de trabalho. **Branch from Here** dá um nome à alternativa. **Discard Working** retorna ao oficial vigente quando existe uma publicação. **Start Again from Original** abre uma cópia limpa da tomada original. **Re-promote Previous** publica o som escolhido com um novo número de revisão. Para continuar em outro dia, use **Save Working** antes de fechar o navegador.

## Construir um instrumento

Em **Instrument Builder**, reúna WAVs da biblioteca ou importe suas gravações; a mesma amostra pode alimentar várias regiões. Configure raízes e dinâmicas e abra o mapa. Em **Mapping Editor**, o eixo horizontal representa notas e o vertical representa velocity. Selecione uma zona e use os campos exatos para ajustes pequenos. Consulte o resultado da seleção para uma nota e velocity antes de tocar. Em **Instrument Builder** também ficam grupos, articulações, solturas, filtros, envelopes e modulações. Para percussão, construa o kit por arquivos ou por slices.

Ouça a cópia no teclado e compare pelo menos uma nota em duas intensidades. Publique e atribua a uma pista quando estiver pronto. Para reabrir, escolha o instrumento na biblioteca e confira a revisão indicada em **Official**.

## Consolidar fontes com Sound Fusion

Abra **Sound Fusion** e adicione snapshots de uma parte do Synth, da pista MIDI selecionada ou de um sampler Official. Uma parte com FM ou um banco de fitas fornece o som correspondente à sua configuração carregada. Ajuste nível e panorama e experimente **Listen to Fusion**. Você pode manter a nota pressionada enquanto troca de workspace. **Release Fusion keyboard** devolve a entrada anterior.

- **Single Sample** imprime a nota e a intensidade escolhidas. Ajuste a janela de soltura e **FX tail (s)** para incluir o decaimento de delay ou reverb.
- **Texture** captura uma sustentação ou a frase de **Use selected DAW MIDI clip**. Selecione o clipe no arranjo primeiro. A captura usa suas notas, expressões e andamento.
- **Multisample instrument** repete o procedimento nas raízes e intensidades escolhidas. As repetições da mesma zona alimentam o round-robin. O cancelamento preserva eventuais tomadas já gravadas. O mapa de saída é entregue quando a captura se completa.

Os efeitos de pista selecionados e os efeitos de master incluídos ficam gravados no WAV. O mapa consolidado reproduz esses WAVs e pode receber novos efeitos. Você pode guardar o resultado com **Save Working**, publicar e usar na DAW. **Restore source snapshots** recupera a receita registrada quando as dependências de origem estão disponíveis. Para monitorar ou capturar Fusion, o transporte e as entradas monitoradas da DAW precisam estar livres.

## Ver a onda e escolher os efeitos do teclado

Abra **Oscilloscope** no alto do Sampler Studio. Para comparar dois candidatos no Wizard, escolha **WAV preview only** e use **Listen** em cada um. O gráfico acompanha só a prévia, mesmo com outro instrumento tocando. Para observar o ataque e a soltura de uma nota no teclado, escolha **Shared output · post-master**. Essa entrada inclui as outras partes audíveis na saída. O painel mostra a soma em mono, com RMS e pico em dBFS. **Y zoom** amplia o desenho. **Spectrogram** mostra a evolução das frequências.

Em **Play & Finish**, deixe **Keyboard FX** em **Dry** para ouvir o recorte com seu envelope e loop. Para experimentar o instrumento com os efeitos atuais, escolha **Use Synth FX** antes de tocar ou durante uma nota sustentada. O volume e o panorama da Parte A, o volume master e o limitador final também se aplicam em Dry. Ao voltar a Dry, uma cauda de reverb ou delay já iniciada pode terminar naturalmente.

Você também encontra **Keyboard FX** em **Versions & History** no editor avançado. A escolha vale para a execução ao teclado nessa sessão. O WAV e a Working Copy guardam o áudio e a receita do instrumento. Para aplicar efeitos na DAW, use os controles da pista.

## Usar o player compacto e a biblioteca

Em **Performance** ou na **DAW**, **Sampler player** permite procurar um instrumento, testar a amostra de referência e escolher o que o teclado vai tocar. A DAW também oferece a atribuição à pista selecionada. Em **Open Sampler in new window**, o editor compartilha a sessão da janela do Synth. **Dock Sampler Studio** devolve o painel. Cada janela lembra as seções que você deixou abertas.

Em **Library & Metadata**, inspecione título, tags, licença, origem e SHA do WAV. Para um instrumento que perdeu arquivos, abra **Dependencies and portable copy**, confira **Check dependencies**, procure os WAVs correspondentes e aplique **Relink selected WAVs**. Isso cria uma revisão. **Collect portable instrument…** reúne a revisão e suas dependências numa pasta que pode ser reaberta em outro local.

Em **SFZ and Mellotron**, escolha a operação e revise a conversão. Ao converter para fita, escolha raízes, velocity e duração, e resolva qualquer ambiguidade entre regiões ou articulações. Leia as perdas listadas antes de marcar o aceite e usar **Write reviewed conversion…**. O SFZ exportado segue o perfil documentado. [Perfil SFZ e de fitas do Mellotron](sampler-studio-interoperability.md)

## Ensaio no SMK-37 Pro

Em **Start audio → Connect MIDI keyboard**, selecione **SMK-37 Pro-Master**. No instrumento publicado, toque a mesma nota primeiro fraca e depois forte. Sustente um acorde com o pedal, navegue entre DAW e Sampler Studio e abra o editor. Confira o som até soltar as teclas e o pedal. Compare o master e o stem de uma frase gravada com o que ouviu. Anote a saída de áudio usada, a revisão do instrumento e qualquer diferença de dinâmica, loop ou soltura. Esses passos completam o ensaio musical do proprietário.
