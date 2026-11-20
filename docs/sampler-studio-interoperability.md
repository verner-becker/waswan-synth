# Interoperabilidade do Sampler Studio

## Trocar um instrumento por SFZ

A importação lê um texto SFZ e um handle para a pasta que contém o mapa. Os WAVs PCM16 mono ou estéreo a 44,1 kHz são copiados fisicamente para a biblioteca e o manifesto é publicado com a revisão esperada. **Samples**, no navegador, guarda o acesso à pasta. Os WAVs e os manifestos ficam na pasta convencional.

O perfil lê `<group>` e `<region>`. Uma região herda os opcodes do grupo anterior e pode sobrescrevê-los. `sample` aceita nomes com espaços e barras de Windows ou Unix, sempre relativos à pasta do mapa. O perfil aceita `key`, `lokey`, `hikey`, `pitch_keycenter`, `lovel`, `hivel`, `volume` e `tune`. Notas podem ser MIDI ou nomes como C#4. Ganho usa a faixa de −144 a +6 dB e tuning usa cents inteiros de −100 a +100. [Grupos](https://sfzformat.com/headers/group/) · [Amostras](https://sfzformat.com/opcodes/sample/) · [Volume](https://sfzformat.com/opcodes/volume/) · [Tuning](https://sfzformat.com/opcodes/tune/)

`amp_veltrack=0` usa ganho fixo. O valor padrão 100 usa o quadrado da velocity dividida por 127. A faixa de reprodução pode ser limitada com `offset` e `end`. O perfil aceita `no_loop`, `one_shot` ou `loop_continuous` com início e fim explícitos. Os finais de reprodução e de loop do SFZ incluem o frame indicado. O manifesto WASWAN guarda o primeiro frame depois do fim. Um WAV com loops embutidos exige modo explícito para o mapa indicar se os loops devem tocar. [Velocity](https://sfzformat.com/opcodes/amp_veltrack/) · [Modos](https://sfzformat.com/opcodes/loop_mode/) · [Fim da reprodução](https://sfzformat.com/opcodes/end/) · [Fim de loop](https://sfzformat.com/opcodes/loop_end/) · [Metadados RIFF](https://www.mmsp.ece.mcgill.ca/Documents/AudioFormats/WAVE/Docs/RIFFNEW.pdf)

O relatório lista cabeçalhos ou opcodes que seriam descartados. Um include, macro, `default_path`, sequência ou seleção aleatória impede a importação. As variantes de uma sequência com intervalos de velocity diferentes podem introduzir passos silenciosos em outros players. O importador evita transformar esse mapa em camadas simultâneas. [Sequências](https://sfzformat.com/opcodes/seq_position/)

As operações ficam em `web/sampler-sfz.js`.

- `parseSfz(text)` analisa o mapa sem ler WAVs.
- `inspectSfzImport(sourceDirectory, text)` valida caminhos, cabeçalhos WAV e limites de frames. `importSfz(library, sourceDirectory, text, {id, path, expectedRevision, acceptLosses})` grava as fontes e publica o instrumento.
- `planSfzExport(instrument, {articulations, variants})` informa escolhas e perdas antes de gravar. Cada entrada em `articulations` associa o grupo de seleção à articulação. Cada entrada em `variants` associa o conjunto à tomada.
- `exportSfz(library, ref, destination, {folder, acceptLosses, articulations, variants})` cria uma pasta nova com `instrument.sfz`, WAVs e `provenance.json`. O mapa usa caminhos dentro dessa pasta e pode ser movido com ela. Use `acceptLosses: true` após revisar o relatório.

A troca preserva os intervalos de nota e velocity, o ganho, o tuning e as coordenadas de loop dentro do perfil. A exportação informa a perda de soltura dedicada, modulação, saídas, pad, panorama, crossfades, modos de loop e regras de articulação ou variação quando presentes. A validação comparou seleção, ganho e afinação em um round-trip WASWAN com WAVs físicos. A reprodução em players SFZ externos fica fora dessa medição.

## Exportar um banco de fitas ao Mellotron

`planTapeBank(instrument, mapping)` prevê um WAV por raiz MIDI. A seleção pode especificar `roots`, `velocity`, `articulations`, `variants` e `regions`, onde `regions` associa uma raiz a um ID de região. Quando as camadas, articulações ou tomadas tornam a escolha ambígua, o banco só pode ser exportado após resolver a seleção. O Mellotron usa a raiz mais próxima e fixa a dinâmica e a articulação escolhidas na conversão.

`renderTapeBank(library, ref, mapping)` verifica os originais, recorta as regiões e usa o conversor de taxa do editor para incorporar a diferença de afinação. O arquivo final é mono PCM16 a 44,1 kHz, com a média dos canais após panorama e os ganhos escolhidos. A opção `seconds` permite encurtar a duração dentro do limite de oito segundos. O relatório aponta cortes, downmix, clipping e perdas no mapeamento.

`exportTapeBank(library, ref, mapping, destination, {name, partner, acceptLosses})` cria uma pasta nova. A opção `partner` identifica um banco existente na pasta de destino. O par deve caber em 48 regiões e 16 MiB de PCM. Ao concluir, o exportador reabre os WAVs no carregador do Mellotron. Em **Open tape folder**, escolha o banco novo para tocá-lo ou a pasta acima para combiná-lo com outro banco. A procedência e as licenças da origem acompanham as fitas em `waswan-tape.json`.

Para reproduzir os ensaios de pasta física, execute `node tests/sampler-studio/interoperability.test.mjs`. Os testes cobrem transposição de 440 para 880 Hz, ganho, downmix de estéreo em oposição de fase, limites do par, interrupção de gravação, colisões de nomes e leitura pelo carregador existente.

## Metadados da biblioteca e presets

Uma importação grava o WAV sem alterações e um documento `.sample.json` com ID, tamanho, SHA-256, formato, título, tags, procedência e licença. O catálogo lê só esse documento. `inspectSample(root, path, {verify: true})` também valida a mídia e `updateSampleMetadata(root, path, changes, {expectedSha256})` atualiza os dados de catálogo sem reescrever o WAV. Um arquivo antigo sem metadados continua visível pelo nome e pode receber um documento após verificação.

Um derivado conserva o hash e o caminho da fonte, a versão da receita e as operações em ordem. `collect` percorre essa cadeia, copia os originais e derivados usados, inclui os metadados e reescreve os caminhos para a raiz de destino. Uma fonte ausente, um hash divergente ou uma referência circular impede a publicação da cópia. Bibliotecas antigas podem fornecer a receita por meio do manifesto quando o derivado ainda não possui um documento próprio. Etapas antigas que nunca foram registradas precisam ser reconstituídas na origem.

`createSamplerPreset({name, ref, controls})` cria um preset que aponta para uma revisão específica. `saveSamplerPreset(root, preset, {path, expectedRevision})` publica o documento em `Presets` e `loadSamplerPreset(root, path)` o reabre. Os controles aceitam ganho em dB, panorama, afinação em cents e articulações iniciais por grupo. Novas revisões do instrumento-base deixam o preset associado à revisão escolhida. `materializeSamplerPreset(root, presetPath, {id, path})` publica um instrumento com os ajustes do preset para tocar no host. O novo ID separa o mapa de execução e as regiões continuam usando os WAVs originais.

`node tests/sampler-studio/library-metadata.test.mjs` valida busca por nome e tags, reorganização física de pastas, materialização e edição concorrente de presets e uma cópia verificável com dois derivados e um original de 48 kHz.

## Ensaios de áudio e compatibilidade

Após montar o simulador, `node tests/sampler-studio/interoperability-host.test.mjs` exporta uma gravação sintética de 220 Hz que o sampler mapeia em MIDI 60. A exportação transpõe e grava o WAV da raiz 72. O teste passa o arquivo físico por `preparePair` e `TapeRuntime`, toca MIDI 72 e mede 440 Hz na captura estéreo do host WASM. Com `WASWAN_INTEROP_EVIDENCE` indicando uma pasta, o teste grava os WAVs e as medidas.

`node tests/sampler-studio/interoperability-kit.test.mjs` confere a preservação das notas MIDI fixas do kit. O relatório sinaliza a perda de saídas nomeadas, choke, retrigger, limites de vozes, modulação, filtros, envelopes e loops incompatíveis.
