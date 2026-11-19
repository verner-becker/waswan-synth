# Aquanode Presets 1 para WASWAN

O cartucho tem 32 programas, entre eles **SBass**, **Blow** e **Sweep**. Para tocar, inicie o áudio no simulador e use **Bank → Choose library folder…**. Selecione a pasta `banks` na raiz do projeto, escolha **DX7 - Aquanode** em **Bank** e um programa em **Tone**. Em **Sweep**, solte a tecla para ouvir o som. Para acrescentar este banco à sua biblioteca atual, copie a subpasta inteira para ela e use **Refresh banks**. [Timbres em formato WASWAN](../../banks/DX7%20-%20Aquanode/)

## Importar outro arquivo

Execute o comando na raiz do projeto com Node.js.

```sh
node scripts/import-dx7.mjs "/caminho/cartucho.syx" "banks/Meu DX7"
```

O importador aceita um dump Yamaha DX7 por arquivo, de uma voz (VCED, 163 bytes) ou de 32 vozes (VMEM, 4.104 bytes). Confere cabeçalho, tamanho, dados de 7 bits e checksum antes de criar a pasta. Use um nome novo para o destino. Cada arquivo recebe o número da posição original, inclusive quando dois timbres têm o mesmo nome. [Descrição dos formatos SysEx](https://github.com/francoiswnel/DX7Dump/blob/master/sysex-format.txt)

Cada timbre abre em FM puro. A conversão preserva o algoritmo, o feedback e, nos seis operadores, o modo ratio/fixed, frequência coarse/fine, detune, nível, sensibilidade à velocidade e os quatro pares de rate/level do envelope. O formato do WASWAN não representa a transposição do programa, o envelope de pitch, o LFO do DX7, o sincronismo dos osciladores, a sensibilidade à modulação de amplitude e o escalonamento de nível e velocidade de envelope pelo teclado. Esses ajustes podem mudar a altura, o ataque e a evolução do som em relação ao original. [Formato FM no WASWAN](../../docs/fm-layer.md)

## Origem

Aquanode publicou **Aquanode Presets 1** sob CC0 1.0. A cópia local `aquanode-presets-1.syx` preserva o cartucho da revisão `c050fabf402a60f1e8946b1bdc62bfb8ac2a6e92`. Seu SHA-256 é `b1ce630d7f6e8c4eec89f59fdb46fd0b623990fa0b97efe31f75dbfa7389b5f0`. Os 32 arquivos em `banks/DX7 - Aquanode` foram convertidos desse cartucho. [Original do autor](https://github.com/aquanodemusic/aquanode-soundscapes/blob/c050fabf402a60f1e8946b1bdc62bfb8ac2a6e92/dexed/Dexed%20Presets/Aquanode%20Presets%201.syx) · [Licença incluída](CC0-1.0.txt)
