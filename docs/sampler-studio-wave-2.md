# Sampler Studio · preparação e análise de amostras

Na branch `feat/sampler-studio-wave-2`, uma gravação PCM16 mono/estéreo de 44,1 ou 48 kHz pode virar instrumento ou coleção de slices. O Worker abre um File, faz a análise ou edita uma cópia. A publicação de um derivado verifica o original pelo hash e grava outro WAV em `Samples/Processed`. A descrição do derivado guarda origem, hash, versão e ordem da receita.

```js
const {sample} = await renderDerivative(root, original, [
  {type:'trimSilence', thresholdDb:-48, marginFrames:32},
  {type:'fade', inFrames:64, outFrames:128},
  {type:'normalizePeak', targetDb:-3},
  {type:'rate', sampleRate:44100}
], 'Samples/Processed/Caixa.wav');
const report = await runOffline(await readSampleFile(root, sample), {type:'analyze'});
const slices = instrumentFromSlices(sample, report.transients, {firstNote:36});
// O chamador pode mover os marcadores ou atribuir manualmente a raiz antes de publicar.
```

A API de [edição](../web/sampler-edit.js) trabalha com frames por canal e inclui trim, remoção de silêncio externo, ganho, fades, normalização, reverse, conversão de canais e taxa e crossfade de emenda. O RMS usa todos os canais e frames do trecho. O teto de pico limita o ganho e o relatório traz o RMS atingido. O downmix estéreo é a média L/R. O conversor de taxa utiliza interpolação sinc com janela e corte passa-baixas adequado à taxa menor.

A [análise](../web/sampler-analysis.js) retorna envelope RMS/pico, clipping por canal, transientes, sugestão de raiz/confiança e candidatos de loop. O detector de pitch compara períodos em três janelas e pede uma componente na fundamental estimada. Pode se abster em silêncio, ruído, material inarmônico ou instável. Sons com fundamental fraca também podem ficar sem sugestão. O mapeamento em lote aceita notas e intensidades declaradas, notas/velocities no nome e estimativa de altura. O corte automático funciona melhor em ataques separados. Os marcadores são editáveis. [Operações de arquivo e Worker](../web/sampler-offline.js)

**Validação.** Passaram `node tests/sampler-studio/edit.test.mjs` e `node tests/sampler-studio/derivative.test.mjs`. O primeiro confere ganhos e frames, teto RMS, silêncio, cancelamento de fase, tom, alias na redução de taxa, transientes e emenda de loop. O segundo importa um WAV de 48 kHz em pasta física, gera o derivado de 44,1 kHz, comprova a igualdade dos bytes originais e reabre o instrumento com a receita. No Chrome, `node tests/sampler-studio/browser-offline.mjs` exercitou trim, resampling, 22.050 frames, raiz 69 e cancelamento em Worker real. A fonte de teste reproduz um WAV externo de afinação conhecida. Não houve ensaio de microfone de celular. A próxima onda integra pads, choke e modulação.
