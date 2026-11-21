# Avaliação de transposição offline no Sample Lab

O ensaio usou o leitor nativo WASM de 256 vozes, a WSOLA existente e uma prova do Signalsmith Stretch em Worker no Chrome. A entrada foi a vogal real do proprietário, mono, 352.789 frames a 44,1 kHz. A versão nativa variou a duração com a afinação. A comparação alinhou os instantes com a fonte e igualou o nível antes de medir o formato do espectro.

| Deslocamento | Δ envelope nativo | Δ WSOLA | Δ Signalsmith com compensação | Janelas periódicas na saída / referência |
| --- | ---: | ---: | ---: | ---: |
| −12 | 14,78 dB | 14,91 dB | 1,47 dB | 2/11 |
| −7 | 10,84 dB | 10,87 dB | 2,10 dB | 6/11 |
| −3 | 7,07 dB | 6,94 dB | 1,60 dB | 9/11 |
| +3 | 7,01 dB | 7,16 dB | 1,65 dB | 11/11 |
| +7 | 9,75 dB | 9,87 dB | 1,69 dB | 10/11 |
| +12 | 9,32 dB | 9,40 dB | 2,13 dB | 11/11 |

O Δ é a mediana de 16 distâncias RMS em dB do envelope espectral suavizado de 250 a 3350 Hz, em janelas de 4096 frames no trecho sustentado. A medição é indireta e a autocorrelação em torno do F0 previsto pode deixar passar erros de oitava. O desvio de timbre melhora em ±3 semitons na vogal e a periodicidade piora de forma importante em −7 e −12. Na guitarra com acompanhamento, a correlação estéreo caiu de 0,92 para 0,76 e o RMS caiu 3,82 dB no ensaio de +7. No seno seco, −7 resultou em erro de +10,55 cents e queda de 2,74 dB no trecho mantido. Os mesmos sinais e o report de medidas ficam em `.local/validation/sample-lab-hq/`. Os arquivos `listen-voice-*.wav` permitem escuta cega em três versões com RMS equiparado. O aceite auditivo continua com o proprietário.

## Integração adotada

**Signalsmith Stretch · experimental** é uma seleção explícita para trechos mono sustentados de 250 ms a 16 s e deslocamento total de até ±3 semitons. Exige um F0 detectável com confiança mínima de 85%. Oferece **Formant compensation** e informa o desvio de pitch, o tempo de processamento, a memória linear e os valores de saída acima de escala. Usa a biblioteca Signalsmith Stretch 1.3.2 e as duas partes necessárias da Signalsmith Linear 0.6.6, ambas MIT e compatíveis com GPL. São incluídos avisos, fontes correspondentes e procedimento para reproduzir o módulo. [Licenças e revisões dos componentes](../wasm/vendor/signalsmith/NOTICE.md) · [Compatibilidade MIT/Expat, FSF](https://www.gnu.org/licenses/license-list.html#Expat)

O Zig 0.15.1 compila C++ para um WASI reactor standalone. O Binaryen 133 produz um WASM de 81.638 bytes, carregado sob demanda no Worker da operação. A prova que aceitava estéreo usou 23,5 MiB de memória linear e 119–142 ms de CPU para oito segundos de vogal com transposição. O módulo integrado limita a memória linear a 64 MiB. A semente fixa, o F0 usado, os parâmetros e a versão viabilizam a repetição exata da receita. A saída conserva a duração e compensa o pré-roll. O Worker é descartado ao cancelar. O módulo de reprodução em tempo real continua usando o mesmo leitor.

O Chrome executou a variante com +3 semitons da vogal pelo mesmo host do teclado e capturou A/B com MIDI idêntico. A tela apresentou tempo, memória, pitch, nível e região de loop. O teste reabriu as três zonas criadas com raízes 39, 42 e 45. A zona usa a raiz do seu próprio WAV, de forma que a reprodução pelo teclado não aplica novamente a transposição offline. A ferramenta usa no máximo duas derivações por geração de regiões e mantém as receitas na pasta da biblioteca.

O TD-PSOLA permanece em avaliação. Sua implementação pede marcação confiável dos pulsos de voz e tratamento da alternância entre trechos vozeados e surdos. O detector global atual não cobre essas etapas. [Referência primária de overlap-add e manipulação no Praat](https://www.fon.hum.uva.nl/praat/manual/overlap-add.html)

## Diagnóstico de aliasing

A fixture de referência usou 2 kHz e 16 kHz e tocou MIDI 72 a partir da raiz 60 no leitor nativo. O tap seco mediu os 4 kHz esperados e observou em 12,1 kHz o rebatimento do componente de 16 kHz transposto acima de Nyquist. As amplitudes foram 0,220 e 0,210 respectivamente. O caso identifica aliasing por uma frequência prevista e observada. Degraus na emenda, mudanças de formantes, flutuação de volume, erros de interpolação e saturação permanecem diagnósticos distintos. O teste com ganho deliberadamente elevado capturou 90.512 amostras acima de escala no acorde sintético. As capturas em ganho inicial da voz e da guitarra não excederam escala. Isso comprova que o fluxo mede a saturação da soma, com atribuição auditiva à ocorrência original ainda pendente.

```sh
sh scripts/build-sampler-pitch.sh
sh scripts/stage-simulator.sh
node tests/sampler-studio/sample-lab-hq.test.mjs
LAB_COMPARE=1 LAB_ANCHORS=1 LAB_PROCESSOR=signalsmith-stretch LAB_REPORT=voice-hq LAB_WAV='/caminho/voz.wav' node tests/sampler-studio/browser-sample-lab.mjs
```
