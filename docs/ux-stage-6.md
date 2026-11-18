# Etapa 6 · composição na DAW e projetos Studio originais

Branch `feat/ux-stage-6-studio-consolidation`, sobre `21d6b29`. A DAW concentra a composição na navegação principal. **Synth → Quick capture** grava, ouve, recupera e exporta tomadas do instrumento. **Original Studio projects** leva ao editor de compatibilidade para composições que usam as quatro partes vivas.

Em **DAW → File → Open DAW project**, um `.wsproj` Studio oferece **Open Studio original** ou **Open editable DAW copy**. Abrir o original usa o leitor e o editor Studio, com suas regras de reprodução e de aplicação explícita dos timbres salvos. Quando invocado pela DAW em outra aba, o original abre no Synth e a DAW conserva o projeto atual. A cópia editável leva notas, áudio e automação de nível e pan. A DAW conserva os dados de origem no arquivo, oferece **Studio playback compatibility** no menu File e pede um destino diferente para salvar. Caso o destino escolhido seja um arquivo Studio existente, a gravação é recusada.

Expressão MIDI, efeitos compartilhados e automações adicionais são reproduzidos pelo Studio original. A DAW restaura os valores-base de volume e pan em Stop. O Studio conserva os últimos valores automatizados. Projetos que dependem dessas diferenças devem ser abertos no modo original. O formato dos arquivos Studio continua legível nos dois caminhos e o formato da DAW permanece v4.

A revisão do Astra encontrou perda de sequências sem notas e substituição de timbres salvos na Gravação rápida. A exportação passou a conservar composição ativa, automação, expressão, fontes e o contexto original mesmo após uma nova tomada. Também corrigimos o foco visual do Arrangement e Editor a 200% de zoom e aplicamos a mesma cor de gravação às duas áreas. [Parecer de seguimento](ux-evolution-astra-followup.md)

## Validação

- 39 suítes Node de DAW, Studio, UI Foundation e TONES passaram. Os arquivos Studio v1/v2 incluíram notas, expressão, automação, timbre SUPER, PCM e verificação da cópia salva.
- Em Chrome, `browser-daw-studio-compat.mjs` cobriu Cancel, cópia editável, preservação de arquivo, abertura do original a partir da aba ligada e apenas um contexto de áudio. A gravação de uma nova tomada preservou BPM, automação, timbres e bytes de uma fonte sem clipes.
- Passaram as suítes de sequência, arranjo, áudio, automação e fluxo Studio, UI Foundation v1/v2, aceite da DAW, MIDI em janelas, instrumentos e posse de áudio. O PDF recompilou com 49 páginas e os links internos verificados.
- A abertura nativa de arquivos, o controlador físico, entradas USB/TRS e o uso de monitores físicos ainda precisam de aceite. O Chrome usou arquivos locais em OPFS e perfis descartáveis.
