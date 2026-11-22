# Music Lab · W1

Abra `http://localhost:8737/simulator/` e selecione **Music Lab**. A biblioteca oferece a escala de Dó maior ascendente e descendente para cada mão, além da tríade de Dó maior em posição fundamental. **Melody Lab**, **Harmony Lab** e **Technique & Expression** organizam as lições. A pauta, o teclado de referência e os dedos sugeridos funcionam antes de ligar o áudio. **Praticar sozinho** controla o avanço manual. O teclado e os pads originais do Synth continuam disponíveis.

**Ouvir exemplo** aciona o mesmo motor do Synth e acompanha as notas na pauta e no teclado. O seletor de andamento atua na demonstração. O transpositor da W1 cobre Dó, Fá e Sol maiores com grafia por tonalidade. Os dedos editoriais aparecem para Dó, a posição em que foram escritos. A clave é escolhida pela tessitura. A pauta usa VexFlow 4.2.5 local com Bravura, zoom independente de 100–200% e rolagem interna em telas estreitas. [Origem e licenças](../web/vendor/vexflow/NOTICE.md)

## Integração

`ui-foundation.js` abre o Lab e mantém o foco MIDI vigente. `ui-music-lab.js` usa as três sementes JSON em `web/music-lab/`. `ui-music-lab-score.js` agrupa os ataques simultâneos e rende a notação pela mesma sequência usada pelo áudio. O MusicXML de referência acompanha cada lição.

`music-lab-preview.js` usa o relógio do Studio e a API de notas já existente no worklet. A escolha de uma parte Analog audível em POLY ou DUAL privilegia a parte atual. Antes de cada ataque, o Lab verifica se há vozes livres para todas as notas previstas. Camadas ao vivo e SUPER ficam reservados ao instrumento. A demonstração usa o timbre dessa parte e compensa a transposição de sequência. Sair, trocar a lição ou parar libera os ataques pertencentes à demonstração. Studio, DAW, Fusion, Legacy e panic têm prioridade. O [mapa W0 e o assessment Astra 6.2 extra high](music-lab-wave-0.md) detalham a entrada, o pedal e a propriedade das notas.

## Validação em software

- O auditor do ZIP confirmou 475 verificações. O XSD oficial MusicXML 4.0 aprovou as 11 partituras do pacote e as três cópias da W1. A auditoria semântica compara alturas, inícios, durações e dedos do JSON com o XML. [MusicXML 4.0](https://www.w3.org/2021/06/musicxml40/listings/musicxml.xsd/)
- `tests/music-lab.test.mjs` verificou escalas, dedilhados, clave por tessitura, grafia transposta, duração em frames, ataques simultâneos, cancelamento por sessão e disponibilidade de vozes. As regressões de MIDI, pickup, presets, áudio, DSP Monitor, Studio e DAW foram executadas.
- `tests/browser-music-lab.mjs` verificou leitura sem áudio, permissão MIDI negada, zoom, prática manual, transposição, som real do worklet, acorde simultâneo, cancelamento, pedal, saída do workspace e desconexão simulada. O Chrome mediu uma instância de áudio e preservou a tecla sustentada, a parte selecionada e os presets.
- `tests/browser-ui-foundation.mjs`, `tests/browser-ui-foundation-v2.mjs` e `tests/browser-daw-monitor.mjs` cobrem a navegação do shell, controles originais, propriedade do monitor DAW e contexto de pickup. Os relatórios e as capturas ficam em `.local/validation/`. As capturas do Lab estão em `.local/validation/music-lab/` nos tamanhos 1366 × 768, 1920 × 1080, 2560 × 1080 e 390 × 844.

## Limites e próxima onda

O usuário testou e aprovou a W1. O aceite cobre a experiência de estudo e demonstração entregue nesta onda.

O percurso atual cobre estudo individual, partitura de uma pauta e prévia pelo timbre carregado no Synth. O ensaio físico no SMK-37 Pro fica pendente. O teste no Chrome usou MIDI simulado e áudio WASM real.

A [W2](music-lab-wave-2.md) acrescenta a avaliação MIDI, a observação de duração e pedal, a retomada após reconexão e o progresso local. A integração à `main` requer aprovação explícita.
