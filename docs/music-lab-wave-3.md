# Music Lab · W3

O catálogo tem 19 lições. **Nível** filtra Fundamentos, Aplicação e Coordenação. Há escalas maiores, menores naturais, harmônicas e melódicas clássicas, as duas pentatônicas, tríades com inversões, tétrades e arpejos. **Tonalidade** cobre as 12 classes de tônica por família e conserva a grafia diatônica. Dedos editoriais ficam nas posições para as quais foram escritos.

**Trecho** permite estudar um compasso. **Repetir exemplo** usa o relógio da prévia no worklet existente. A prática salva resultados por variante de mão, compasso e oitava além da tonalidade.

## Duas mãos e alcance

**Calibrar alcance** lê as teclas extrema grave e aguda na porta e no canal observados. Confirme as notas na oitava escolhida. Recalibre ao mudar a oitava do controlador. Na lição de duas mãos, a prática MIDI é liberada quando a extensão medida abrange toda a variante. Quando cabe em outra oitava, a mudança tem botão explícito. O seletor **Mãos** oferece estudo separado.

A pauta dupla coloca o baixo e a melodia em claves escolhidas pela tessitura e alinha os ataques que começam no mesmo ponto do compasso. A avaliação guiada pede a entrada conjunta e a tecla do baixo durante a melodia. Quando a tecla é solta, o Lab indica como recolocar o baixo e retomar. A orientação de mãos e dedos vem da partitura.

## Evidências

- 19 lições conformes ao esquema JSON. O catálogo fixa as alturas esperadas, incluindo F♯ em Sol maior, B♭ em Fá maior, C𝄪 em Ré♯ menor harmônica e B𝄫 em Cdim7. Os testes conferem as fórmulas nas 12 tônicas, as inversões C/E e C/G e o recorte de compasso.
- O Chrome confirmou a pauta dupla sincronizada, a calibração, o bloqueio por alcance, o ajuste explícito, a prática com baixo sustentado e o loop de compasso. As regressões cobrem a prévia e os exercícios MIDI já existentes. Relatório e capturas em `.local/validation/music-lab/`.
- A calibração foi simulada com WASM real. O ensaio físico segue pendente. A W4 acrescenta acompanhamento, improvisação e exportação opt-in.
