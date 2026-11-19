# FM no editor de timbres

Em **TONES**, abra um programa ANALOG e escolha **+ Add FM**. O programa começa com o nível original de Analog e o nível de FM em zero. Aumente **FM level** enquanto toca. Em **Mix**, ajuste a contribuição de cada fonte. Com **Analog level** em zero, o programa toca FM puro e abre na edição FM ao ser selecionado. **Save as…** grava a combinação em um dos 99 programas.

Na aba **FM**, escolha o algoritmo de 1 a 32. Os botões numerados mostram o caminho dos operadores até **Out**. Clique em um operador para editar sua frequência, nível de saída, sensibilidade à velocidade e envelope. **Ratio** acompanha a nota e **Fixed** usa uma frequência em Hz. **Rate 1–4** determina a velocidade de cada estágio e **Level 1–4** o nível a alcançar. O quarto estágio começa ao soltar a tecla ou o sustain. O feedback utiliza o caminho indicado sob o diagrama.

As duas fontes compartilham a nota, o pool de 256 vozes, o panorama e os envios da parte. O FM entra depois do filtro e do envelope de amplitude do Analog. A amplitude dos seis operadores evolui independentemente. O editor conserva os ajustes originais de osciladores, incluindo a modulação de OSC2 para OSC1.

## Fontes consultadas no GitHub

- O **FM1 Open** da M-VAVE documenta a biblioteca DX7, os bancos SysEx e a versão web. O fabricante atribui o modelo FM a MSFA/Dexed e distribui um SDK binário para o dispositivo. [Repositório oficial](https://github.com/m-vave/fm1_open) · [Atribuições do fabricante](https://github.com/m-vave/fm1_open/blob/main/THIRD_PARTY.md)
- O **sloopDX**, firmware alternativo para o FM-1, disponibiliza o núcleo dos operadores em C inteiro a 44,1 kHz. O WASWAN incorpora o núcleo e suas tabelas da revisão 8c1035b, com adaptações para os laços de feedback dos algoritmos 4 e 6 e para afinações extremas. A tabela dos 32 algoritmos é conferida contra a referência MSFA. [Código do sloopDX](https://github.com/zvenson/dxsloop/blob/8c1035b79d860edcb6f23556910206332669dac8/firmware/src/dx7_core.c) · [Tabela MSFA](https://github.com/google/music-synthesizer-for-android/blob/f67d41d313b7dc85f6fb99e79e515cc9d208cfff/app/src/main/jni/fm_core.cc) · [Licenças e atribuições locais](../wasm/vendor/sloopdx/NOTICE.md)
- O **FM1 Patch Librarian** documenta a edição e a transferência de vozes DX7 pelo MIDI do FM-1. É uma referência para um possível ciclo de importação de bancos. [Repositório do editor](https://github.com/benny-sparra/fm1-dx7-patch-importer)

## Armazenamento

Os timbres existentes continuam usando os 80 bytes do patch. Um snapshot portátil com FM acrescenta 89 bytes identificados pela versão 0xF1. O motor valida essa extensão antes de aplicar o projeto. Na sessão binária do navegador os parâmetros FM de programas, patterns e favoritos ocupam áreas reservadas, associados ao patch e protegidos por checksum. O tamanho da sessão continua em 21 × 16 KiB. Para reabrir timbres híbridos, use uma versão web com o módulo FM.

O instrumento web pode carregar os timbres convertidos de um cartucho SysEx pela biblioteca de pastas. [Banco DX7, importador e parâmetros compatíveis](../assets/dx7/README.md)

## Validação

O teste de áudio confere a tabela completa de roteamento, diferencia os 32 algoritmos com feedback, mede a afinação de portadoras em Ratio e Fixed e verifica sensibilidade à velocidade, sustain, release e independência do filtro. Com FM recém-adicionado em nível zero, compara as amostras com o programa original. Os testes de persistência percorrem programa, sessão, projeto DAW, contexto do Studio, favorito e pattern.

Execute `node tests/fm-layer.test.mjs` após o build. Com o simulador servido em localhost e o Playwright instalado, `node tests/browser-fm-layer.mjs` exercita o editor, grava capturas e mede os blocos no AudioWorklet em `.local/validation/fm-layer/`.

### Carga em Chrome

Chrome headless 157.0.8103.78, 44,1 kHz, quanta de 128 frames. O ensaio usa DUAL, duas serras e seis operadores com algoritmo 4, feedback 6 e pedal pressionado. O monitor registrou 1.035 blocos por configuração. O prazo de cada bloco é 2,90 ms.

| Vozes híbridas | Tempo médio por bloco | Blocos acima do prazo |
|---:|---:|---:|
| 16 | 0,21 ms | 0 |
| 64 | 0,52 ms | 0 |
| 128 | 0,86 ms | 22 |
| 256 | 1,49 ms | 417 |

A medição cobre uma máquina e um timbre. O contador mede duração de processamento. O aceite auditivo com instrumento e saída físicos está pendente. O teste de navegador também verificou a edição pelo diagrama, Save as, recarga de um programa FM puro, adição da fonte Analog e layout com 390 e 1366 px de largura.
