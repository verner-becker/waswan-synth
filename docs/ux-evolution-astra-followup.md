# Parecer de seguimento do Astra sobre Synth e DAW

O GPT-6.2 Astra, com esforço alto, revisou a interface após as seis etapas. Reproduziu três problemas P1 e confirmou as correções em um Chrome independente. Nenhum P0 apareceu nos fluxos exercitados. As capturas e medições estão em `.local/validation/ux-astra-followup/`.

## Fluxos revisados

- **Tocar e configurar.** Iniciar o áudio sem controlador deu acesso a teclado, pads e Instrument setup. Performance, TONES e Quick capture mantêm a navegação curta. Em Full HD, o grupo Parts and mixer concentra os controles A–D em uma das quatro colunas, com espaço ocioso ao lado quando os outros grupos estão recolhidos. O Astra sugere dar a largura da linha ao grupo aberto. O critério é comparar as quatro partes e encontrar o próximo grupo sem percorrer 32 campos. Evidências `02-performance.png` e `03-instrument.png`.
- **Criar e editar o primeiro clipe.** Add MIDI track seguido de Add clip at cursor abriu o Piano Roll. Em Full HD emulado com zoom real do Chrome, a grade exibiu 197 px a 100% e 142 px a 125%. A 200%, a primeira versão dos botões de vista deixava a grade e a timeline fora da área visível. Após a correção, Editor view mostrou 140 px de Piano Roll e Arrangement view mostrou 161 px de timeline, com o transporte inteiro nas duas vistas. Ao chegar a 200%, ainda é preciso escolher uma delas. Evidências `zoom.json`, `12-editor-200.png` e `13-arrangement-200.png`.
- **Marcar e gravar.** O marcador Entrada aceitou Enter e conservou o foco. Ao gravar de Synth output (internal), a DAW mostrou pista, fonte e Recording em vermelho. Stop DAW criou a tomada e informou que Undo restaurava a anterior. O Astra observou que o status dizia Waveform enquanto o editor estava recolhido. O texto agora aponta para Show Clip editor. Quick capture agora usa a mesma cor de gravação da DAW acompanhada do rótulo Recording. Evidências da revisão `14-quick-record.png`, `15-recording.png` e `16-recorded.png`.
- **Trabalhar em ultrawide e nova aba.** O Astra abriu a mesma DAW em uma aba de 3440×1440, com a identificação do host, o projeto e o editor presentes. A etapa 4 mediu 3340 px de timeline em 3440×1440 e 2460 px em 2560×1080. Também registrou retorno durante reprodução e gravação e o tema do Mixer destacado. Evidência `10-linked.png` e [fechamento da etapa 4](ux-stage-4.md).
- **Reabrir e preservar Studio.** Open DAW project oferece o original e uma cópia editável, com aviso sobre expressão, FX compartilhados, automação e Stop. O Astra encontrou dois problemas em Quick capture. Ao gravar por cima da tomada de uma composição sem notas, o arquivo salvo perdeu a sequência a 137 BPM e a automação de cutoff. Em outro arquivo, abrir e salvar trocou o programa salvo de 1 para 71. No reteste, a composição conservou os 137 BPM, cutoff 49 e 5.632 quadros de áudio. O segundo arquivo conservou o programa 1, master 724 e o patch byte a byte. Evidências `capture-roundtrip-after.json`, `context-roundtrip-after.json` e `.local/validation/ux-stage-6/studio-compat.log`.

O Astra também encontrou mensagens que ainda chamavam o sequenciador do instrumento de Legacy. Foram atualizadas para indicar o pattern em Performance.

## Próximo ciclo de UX

1. Aproveitar a largura do Instrument setup para comparar as partes A–D e manter a entrada para os demais grupos ao alcance. Medir a rolagem em Full HD e a 125% antes e depois.
2. Avaliar se a DAW deve revelar a última vista musical usada ao entrar com zoom de 200%. A vista escolhida já mostra conteúdo musical e transporte ao mesmo tempo.
3. Verificar teclado, foco visível, dicas e anúncios de seleção e gravação com leitor de tela. A revisão confirmou foco no marcador com Enter e o texto do estado de gravação no Chrome.

A validação usou Chrome em perfis descartáveis, projetos sintéticos e a saída interna do Synth. Permanecem pendentes controlador SMK-37 Pro, entradas e saídas físicas, seletor nativo de arquivos, leitor de tela e movimentação entre monitores reais.
