# Sampler Studio · API de uso

A API recebe um `File` ou `Blob` de WAV e um `FileSystemDirectoryHandle` já autorizado. Tanto uma gravação de celular como um bounce da DAW ou uma tomada de teclado entram pelo mesmo caminho. O código a seguir roda no lado de controle do navegador. Os caminhos são relativos à pasta escolhida pelo músico.

## De um WAV a um instrumento cromático

```js
import {initializeLibrary, importOriginal, publish, listChildren, search} from './sampler-library.js';
import {runOffline, renderDerivative} from './sampler-offline.js';
import {mapSample, prepareSampler, setLiveSampler} from './sampler.js';

await initializeLibrary(root, {name:'Meu estúdio'});
const original = await importOriginal(root, file, 'Samples/Originals/Teclas/nota.wav');
const {sample} = await renderDerivative(root, original, [
  {type:'trimSilence', thresholdDb:-50},
  {type:'fade', inFrames:40, outFrames:180},
  {type:'rate', sampleRate:44100},
  {type:'normalizePeak', targetDb:-3}
], 'Samples/Processed/Teclas/nota.wav');
const draft = mapSample(sample, 60, {name:'Meu teclado'}); // gravação em dó central
const ref = await publish(root, draft, {path:'Instruments/Teclas/Meu teclado', expectedRevision:0});
const instrument = await prepareSampler(player, root, ref);
await setLiveSampler(player, instrument);
```

A nota 60 reproduz a altura gravada e a nota 72 toca uma oitava acima. Para sugerir uma raiz antes de mapear, use `await runOffline(file,{type:'analyze'})` e examine `pitch.root`, `pitch.confidence` e o motivo de abstenção. Um som percussivo pode ser atribuído diretamente a um pad. Uma gravação pode ficar na biblioteca como som avulso. A preparação para o leitor requer PCM16, mono ou estéreo, a 44,1 kHz. A importação também aceita 48 kHz para derivação offline.

## Pastas, pesquisa e edição do mapa

```js
const children = await listChildren(root, 'Instruments/Teclas', {limit:40});
const kits = await search(root, {kind:'kit', tags:['acústico'], limit:30});
```

O módulo `sampler-instrument.js` exporta `samplerCapabilities`. A apresentação pode enumerar modos de reprodução e loop, filtros, LFOs, curvas de velocity, fontes e destinos de modulação e limites a partir dos mesmos valores usados pelo validador. Uma região de loop usa frames `[start,end)`. Os intervalos de nota e velocity incluem os dois extremos. Ganho é em dB, ajuste de altura em cents, tempos dos envelopes em ms e frequência de filtro/LFO em Hz.

A árvore pode pedir a próxima página com `nextCursor`. Expandir uma pasta ou consultar tags lê os metadados. A leitura de PCM ocorre na preparação ou análise explícita. Use `inspect(root,ref)` para a revisão e o localizador corrente, `verify(root,ref)` para checar os WAVs e `findCandidates` e `relink` para recuperar referências após reorganizar pastas. `collect(root,ref,destino)` cria uma biblioteca portátil.

Para criar um piano, passe as gravações à função `suggestMapping` com as notas e velocities conhecidas, ou com os resultados da análise. Ela devolve limites sugeridos para revisão. `createInstrument` recebe os descritores de amostra, regiões, grupos, layers, articulações e conjuntos de round-robin. `compile` e `explainNote` permitem à futura UX indicar que gravações soariam com determinada tecla, velocity e estado. `applyEdits` atualiza o documento em memória. Publique com a revisão que foi aberta para detectar conflitos. [Exemplo executável de piano com articulações](../tests/sampler-studio/fixtures.mjs)

## Uma batida num objeto vira um kit

```js
import {createKit, kitFromSlices} from './sampler-kit.js';

const kit = createKit({
  name:'Cozinha', samples:[pote, tampa, tampaCurta],
  pads:[
    {index:1, note:36, recordings:[{sample:pote.id}]},
    {index:2, note:42, choke:'tampas', recordings:[{sample:tampaCurta.id}]},
    {index:3, note:46, choke:'tampas', recordings:[{sample:tampa.id}]}
  ]
});
const kitRef = await publish(root, kit, {path:'Kits/Objetos/Cozinha', expectedRevision:0});
```

Os dois pads com o mesmo `choke` interrompem um ao outro na mesma pista. Outra forma de construir o kit é passar uma tomada longa e os frames de ataque a `kitFromSlices(sample, markers)`. Os marcadores podem vir do músico ou do campo `transients` de `analyzeSample`. Para usar uma grade de tempo, `beatSlices(audio, {bpm:120}).slice(1).map(([start]) => start)` extrai os frames de corte dos intervalos. Cada pad pode apontar para várias gravações com layers e variações. [Kit executável com 16 pads](../tests/sampler-studio/kit.test.mjs)

## Tocar, gravar e exportar

Para uma pré-escuta avulsa, `prepareSamplePreview(player,file,rootNote)` devolve uma referência temporária. `setLiveSampler(player,ref)` seleciona a rota do Synth e `setLiveSampler(player,null)` a libera. Para uma pista MIDI da DAW, atribua ao campo `track.instrument` o resultado de `prepareSampler` com uma revisão publicada. O monitor, a gravação, o transporte e o exportador de master e stems são os mesmos usados pelas demais pistas. A retomada do projeto resolve a referência na pasta Samples configurada. [Performance, reabertura e exportação no Chrome](../tests/sampler-studio/browser.mjs)

A tomada de um teclado externo pode entrar como arquivo. Para automatizar em uma integração com dispositivos, `planCapture` enumera notas, intensidades, duração, cauda e repetições. `runCapturePlan` recebe uma saída MIDI, uma entrada de áudio e relógio, e `mapCaptureTakes` produz o mapa. Há ensaio com adaptadores simulados. [Contrato de captura](../web/sampler-capture.js)

Para renderizar uma textura, use a mesma `renderDerivative` com `stretch`, `pitchShift` ou `granular` e mapeie o WAV resultante como qualquer outro. Para o Mellotron, `planTapeBank` prevê perdas e tamanho, e `exportTapeBank` grava a seleção de raízes e verifica o par de bancos com o carregador do instrumento. O perfil SFZ tem operações separadas para inspecionar, importar e exportar. [Transformações](sampler-studio-wave-4.md) · [Formatos e limites de interoperabilidade](sampler-studio-interoperability.md)

## Sons avulsos e presets

`inspectSample(root,path)` recupera o descritor do WAV fora de um instrumento. Título, tags, licença e histórico persistem ao lado do WAV. O catálogo também reconhece WAVs de pastas antigas. Um preset fixa a revisão original e armazena ganho, panorama, afinação e articulações iniciais. Para tocá-lo ou atribuí-lo a uma pista, materialize o preset sob uma nova identidade e prepare a referência resultante. As duas versões compartilham o PCM. [Persistência e testes de presets](../tests/sampler-studio/library-metadata.test.mjs)
