# Sampler Studio · transformações avançadas offline

A Onda 4 acrescenta três operações à receita do Worker da Onda 2. `renderDerivative` produz um WAV físico com a mesma proveniência e histórico das demais edições. `beatSlices` devolve intervalos em frames por BPM e subdivisão, que podem alimentar regiões e pads.

| Operação | Exemplo de parâmetros | Resultado |
|---|---|---|
| `stretch` | `{type:'stretch', factor:1.5}` | Prolonga a duração em 50%. Alinha janelas por semelhança de forma de onda antes da sobreposição. |
| `pitchShift` | `{type:'pitchShift', semitones:-3}` | Muda a altura e conserva o comprimento. Combina o stretch e o conversor de taxa com filtragem da Onda 2. |
| `granular` | `{type:'granular', seconds:8, grainMs:120, density:30, positions:[0.2,0.8,0.3], jitter:0.1, seed:42}` | Renderiza uma textura com trajetória de leitura, envelope de grão e dispersão de posição/afinação reproduzível. |

As duas saídas estéreo usam o mesmo deslocamento de cada janela/grão. A implementação é do projeto, em módulos GPL-3.0-only. O processamento usa buffers limitados e pode ser cancelado encerrando o Worker. Stretch aceita fatores de 0,5 a 2, pitch-shift de −12 a +12 semitons e granular dura até 120 segundos, sujeito ao orçamento de memória. As medições abaixo cobrem um subconjunto musical dessa faixa. A técnica não corrige formantes.

**Critérios de ensaio.** Usar sinais sustentados, percussivos e polifônicos gerados localmente. Para uma senoide de 220 Hz, exigir altura dentro de 10 cents e comprimento exato. Para cinco ataques, conservar a contagem e ter deslocamento inferior a 45 ms por ataque. Num acorde, manter componentes dos três tons. Para estéreo, preservar a relação de amplitude e fase entre canais. Exigir a mesma textura para a mesma seed e nova textura para uma seed diferente.

**Resultado.** `node tests/sampler-studio/transform.test.mjs` passou para 0,75× e 1,5× a duração e ±3 semitons. O desvio do tom sustentado ficou abaixo de 0,5 cent. O maior deslocamento de ataque foi aproximadamente 8,85 ms em 0,75× e 18,33 ms em 1,5×. Os arquivos para escuta (duas frases de bateria, dois acordes, mudanças de altura e drone) ficam em `.local/validation/sampler-studio-4/`. Esses ensaios estabelecem limites de frequência, energia e tempo; a qualidade percebida de vozes e arranjos reais depende de escuta. O caminho offline preserva o orçamento de reprodução do instrumento e permite salvar instrumentos derivados. Próxima onda: exportar bancos e avaliar carga em bibliotecas maiores. [Implementação](../web/sampler-transform.js)

O teste `browser-offline.mjs` enviou uma receita de stretch, pitch-shift e granular a um Worker real no Chrome e verificou duração e presença de sinal. O teste `texture.test.mjs` cobre a sequência de gravação física, publicação, reabertura e reprodução da textura na raiz, na quinta e na oitava com o host do instrumento.
