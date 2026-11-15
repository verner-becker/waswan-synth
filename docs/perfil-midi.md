# Perfil MIDI de entrada — primeira expansão

A entrega inicial está preservada pela tag local `v0.1.0`, no commit `e0c9543`. O projeto não tem remoto configurado; não houve push. A expansão foi desenvolvida na branch `feat/smk37-midi-profile`.

## Usar

Recompile com `sh scripts/build-simulator.sh` ou, se o WASM já existe, atualize apenas a interface com `sh scripts/stage-simulator.sh`. Execute o servidor conforme o README e recarregue a página.

1. Inicie o simulador e conecte `SMK-37 Pro-Master`.
2. Abra **WASWAN · Mapeamento de knobs e faders**, abaixo da entrada MIDI.
3. Marque **Ativar meu perfil MIDI**. A opção vem desativada no primeiro uso.
4. Escolha F1–F4 ou K1–K8 e o formato enviado pelo controle físico.
5. Clique em **Aprender controle** e mova somente o knob/fader correspondente. A primeira mensagem registra porta, canal e CC, sem alterar o som.
6. Mova novamente para testar. Repita com os outros controles. Notas e pitch continuam com o comportamento original.

Se uma entrada ainda não estiver selecionada, o painel solicita a conexão. Cancelar, mudar o destino/formato, perder foco, desconectar ou usar Soltar tudo encerra o aprendizado e descarta a posição anterior dos knobs.

Faders aceitam valores absolutos 0–127 e respeitam o modo JUMP/CATCH do instrumento. Knobs aceitam três formatos:

| Formato | Interpretação |
|---|---|
| Absoluto | Usa a diferença entre posições sucessivas. Depois de uma liberação, o primeiro valor estabelece a referência, evitando saltos. |
| Relativo 65/63 | 64 é neutro, 65 aumenta um passo, 63 diminui um passo; 0 é ignorado. |
| Relativo 1/127 | 0 é neutro, 1 aumenta um passo, 127 diminui um passo, em complemento de dois. |

Os knobs operam os controles da página atual do display, como os knobs virtuais. O master converte a faixa absoluta para passos de 24 do firmware. O modo absoluto não estabelece um valor exato de cutoff ou posição de preset: opera por diferenças, preservando o contrato de encoder existente.

Um CC pode controlar somente um destino; reaprender substitui a associação anterior desse CC ou destino. O perfil inclui o nome da porta e o canal: um CC igual em outra porta/canal mantém seu comportamento original. Portas diferentes com nomes idênticos não podem ser distinguidas por esse perfil; a configuração atual tem nomes distintos.

O remapeamento tem prioridade sobre a função MIDI original. Mapear CC64 retira o sustain daquele CC/porta/canal; mapear CC1 substitui sua função de modulação. Ativar/desativar o perfil e remover associações libera notas, pedal e rodas antes da mudança. CC120–127 não podem ser aprendidos; as mensagens de panic existentes continuam disponíveis. Desativar o perfil restaura a entrada original.

O perfil fica em `localStorage['waswan-midi-profile-v1']`, separado da sessão de fábrica e dos timbres. Não integra o arquivo de exportação de sessão do simulador. Se o armazenamento for bloqueado, o painel informa que as alterações duram somente na sessão atual. Não há comunicação de saída nem alteração de firmware.

## Implementação e verificação

`web/midi.js` estende `MidiInputController` do upstream. `scripts/stage-simulator.sh` copia a classe original como `midi-original.js` e adiciona o adaptador ao diretório de execução. Não altera nenhum arquivo rastreado do submódulo, o DSP, o WASM ou o formato de memória. O painel é acrescentado pelo adaptador, sem duplicar a interface original.

```sh
sh scripts/stage-simulator.sh
node tests/midi-profile.test.mjs
sh scripts/check-upstream.sh
```

Os testes do perfil cobrem aprendizado, limites/reversão, formatos relativos, escala do master, persistência, perfis inválidos, armazenamento bloqueado, isolamento de porta/canal, CC64 sem sustain duplicado, foco, desconexão e panic. Também verificam notas, pitch, modulação e alteração do master no WASM recompilado através da classe original com o novo adaptador.

Os testes MIDI e musicais originais continuam passando. O usuário confirmou no hardware o aprendizado e funcionamento dos quatro controles da tela em knobs físicos e de um slider. Também confirmou o teste de liberação/retorno das notas ao trocar de janela. A associação dos demais controles continua disponível no painel; não se criou um mapa presumido com base na captura coletiva da primeira entrega. Esta expansão não remapeia pads nem adiciona novos motores.

No Chrome, eventos MIDI sintéticos exercitaram o aprendizado, o consumo exclusivo de CC64, diferenças de knobs e persistência após recarregar. O AudioWorklet permaneceu ativo a 44,1 kHz, com sinal não nulo e sem exceções JS. O painel foi inspecionado em larguras de 1440 e 390 px. Evidências locais: `.local/validation/midi-profile-*`. Esse teste automatizado não substitui a associação física pelo usuário.

## Precisão do cutoff observada no hardware

No teste com knob em modo absoluto, o usuário relatou passos crescentes no cutoff exibido em Hz. Há duas características distintas na base original:

- `firmware/src/obervave.c`, `param_value`, apresenta o cutoff pela tabela musical `CUT_HZ[(v+8)%137]`, em `firmware/gen/obv_tables.h`. O parâmetro interno possui valores 0–127; os passos em Hz crescem com a frequência. Por exemplo, os valores internos 40 e 42 exibem 131 e 147 Hz. Isso não é uma escala linear em Hz.
- O tratamento dos quatro encoders da tela em `obervave.c` multiplica deltas de módulo maior que 1 por 3 e aplica passos de 2 a parâmetros com máximo de pelo menos 100, como cutoff. Reproduzido no WASM recompilado com cutoff inicial 40 e modo absoluto: delta MIDI +1 → cutoff 42; +2 → 52; +3 → 58. Portanto, saltos ou agrupamentos de valores MIDI também podem produzir aceleração, além da escala em Hz.

O adaptador conserva esse comportamento de encoder. Não foi alterado o DSP, a tabela de frequências ou a aceleração original a partir desse relato. Um controle fino no host é uma melhoria identificada: deve preservar a escala musical e tratar a aceleração dos eventos sem presumir que suavizar o texto em Hz aumentaria a resolução real do parâmetro.
