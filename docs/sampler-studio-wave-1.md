# Sampler Studio · instrumentos tocáveis

A Onda 1 implementa o percurso WAV → instrumento → nota → DAW na branch `feat/sampler-studio-wave-1`. O cadastro existente fornece a raiz `sampleLibrary`. Para escrita, o chamador pode solicitar `readwrite` a partir do gesto de salvar. A API opera sobre o handle externo recebido. Escolher outra pasta em Instrument setup ou navegar entre telas não aciona o instrumento.

## Criar, tocar e reabrir

Exemplo em um consumidor ES do simulador. `root` é a pasta física escolhida e `wav` um File. `player` e `controller` são os mesmos usados pela DAW. Uma pasta nova requer inicialização. Para editar um instrumento publicado, carregar a revisão e passá-la como `expectedRevision`.

```js
import {initializeLibrary, importOriginal, publish, listChildren} from './sampler-library.js';
import {mapSample, prepareSampler, setLiveSampler} from './sampler.js';

await initializeLibrary(root);
const sample = await importOriginal(root, wav, 'Samples/Originals/Sessão/nota.wav');
const piano = mapSample(sample, 60, {name: 'Minha gravação'});
const ref = await publish(root, piano, {path:'Instruments/Teclas/Minha gravação', expectedRevision:0});
const instrument = await prepareSampler(player, root, ref);
await setLiveSampler(player, instrument);  // teclado live da parte A
controller.command('track.update', {id:trackId, changes:{instrument}});
const folder = await listChildren(root, 'Instruments/Teclas');
```

A raiz MIDI 60 corresponde à gravação na velocidade original. Uma oitava acima, a velocidade duplica. Para ouvir um WAV antes de salvar, usar `prepareSamplePreview(player, file, rootNote)` e associar a referência temporária com `setLiveSampler`. A pré-escuta de uma pista usa o piano da DAW com um dono próprio para suas notas. `setLiveSampler(player, null)` devolve a parte ao Synth.

- [Modelo](../web/sampler-instrument.js) contém validação, edição por ID, compilação e explicação de uma nota. [Biblioteca](../web/sampler-library.js) importa originais, publica revisões, resolve caminhos, verifica integridade, revincula e reúne dependências em outra pasta. O índice deriva dos manifestos.
- [Preparação](../web/sampler.js) verifica o conteúdo e envia PCM16 em blocos de até 32.768 valores. O [runtime](../web/sampler-runtime.js) compartilha a amostra por hash e retém as revisões em uso. O [leitor estéreo](../wasm/sampler-voice.h) usa os slots do alocador e os barramentos do host. As notas sequenciadas têm ID e canal. O transporte guarda a seleção das notas sustentadas nos pontos de seek/loop. Ao buscar, as amostras sustentadas recomeçam no ataque.
- Limites iniciais configurados no host: 64 MiB de arena PCM, até 16 revisões residentes, 128 regiões por mapa preparado e 256 vozes **compartilhadas**. A biblioteca pode listar instrumentos sem reservá-los. Importar PCM16 de 48 kHz preserva o WAV original; para reprodução direta a representação preparada deve estar a 44,1 kHz.
- Um projeto v4 ou preset salva referência por biblioteca, instrumento, revisão e caminho e conserva um patch neutro de apoio do host. O player faz a carga em frio da raiz cadastrada. Em uma revisão publicada, arquivos originais, derivados e descrições vivem no disco convencional. O armazenamento da DAW continua recuperando tomadas e projetos.

## Evidência musical e reprodução

O [gerador de fixtures](../tests/sampler-studio/fixtures.mjs) produz um instrumento com impulsos estéreo e um piano de três raízes com duas camadas, duas tomadas por camada, uma segunda articulação e som de soltura. As amostras são geradas localmente. Para persistir a biblioteca de demonstração, usar uma pasta nova:

```sh
node tests/sampler-studio/fixtures.mjs /tmp/waswan-piano
node tests/sampler-studio/library.test.mjs
node tests/sampler-studio/project.test.mjs
node tests/sampler-studio/host.test.mjs
node tests/sampler-studio/piano.test.mjs
node tests/sampler-studio/browser.mjs
```

As suítes Node de biblioteca exercitaram diretórios reais, concorrência, falha de gravação, reabertura após mover, corrupção e coleção portátil. O ensaio WASM preservou L/R e transposição, reconstruiu seleções e atingiu 256 vozes estéreo e a 257ª alocação. O piano renderizado está em `.local/validation/sampler-studio-1/piano-demo.wav`.

No Chrome 157, a suíte conferiu reabertura fria do projeto, monitor MIDI, captura interna e WAVs do master e da pista com as alturas e canais esperados. Controles de mute/solo e pista vazia deram silêncio. A captura do Synth passa pelos efeitos e panorama da parte: medir a separação da fonte exigiu neutralizar esses controles na própria sessão. A pasta de teste do Chrome usa OPFS como dublê do diálogo nativo. A suíte de disco do Node cobre o filesystem convencional.

Na primeira medição do Chrome, 24 vozes estéreo ficaram dentro do orçamento nos 690 blocos observados e 256 ultrapassaram a janela de 2,90 ms em 10 deles, com relógio quantizado. A medição descreve o WAV residente e o equipamento da execução. Repetir com várias fontes, filtros, transporte e captura na onda de desempenho. Faltam escuta no controlador e seleção pelo diálogo nativo. Próxima entrega: processamento não destrutivo e análise offline. [Roadmap](sampler-studio-roadmap.md)
