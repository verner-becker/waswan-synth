# Quatro osciladores no ANALOG

Branch `feat/analog-four-oscillators`, baseada na `main` em `2b41567`. Ciclo autorizado para o instrumento web em 18/11/2026.

## Plano e aceite

1. Compilar a referência e preservar o caminho de renderização dos presets antigos. Acrescentar as formas do POLY D e senoide em OSC1/2 e dois osciladores opcionais antes do filtro. Manter o pool global de 256 vozes.
2. Integrar forma, afinação e nível ao editor TONES e ao patch de 80 bytes que acompanha presets, sessões e projetos. Abrir um preset antigo deve manter os parâmetros e o áudio originais.
3. Comparar áudio estéreo com a referência, editar e reabrir um timbre, medir blocos com dois e quatro osciladores em Chrome e executar regressões de MIDI, vozes, interface e áudio.

OSC1–3 oferecem triangular, híbrida triangular/serra, serra, quadrada, pulso largo, pulso estreito e senoide. OSC4 troca a híbrida pela serra invertida. OSC1/2 conservam também todos os modos originais. [Especificação do POLY D](https://www.behringer.com/en/products/0722-AAJ)

## Edição e armazenamento

Em TONES → Oscillators, escolha uma forma em OSC3 ou OSC4 para ativá-lo. A afinação individual vai de −15 a +15 semitons, com zero no centro. O nível tem 32 posições, com ganho quadrático. OFF retira o oscilador da renderização e conserva seus ajustes. As formas quadrada, pulso largo e pulso estreito usam larguras nominais de 50%, 25% e 12,5%. O PULSE original de OSC1/2 continua com largura variável e PWM. A senoide usa a tabela interpolada do instrumento. A híbrida combina triangular e serra digitalmente. As três novas posições de pulso usam a correção de descontinuidades do motor.

O editor amplia as opções de OSC1/2 mantendo os valores originais 0–4. Os CCs do instrumento conservam a escala original. OSC3/4 acompanham a afinação da voz e entram na mesma soma antes de drive, filtro e amplitude. Sync e X-MOD continuam ligando OSC1 e OSC2. As regulagens de OSC3/4 pertencem ao patch. O catálogo MIDI e as pistas de automação nativas continuam com os IDs originais.

A extensão usa os seis bytes finais do patch ANALOG e conserva os dois valores de mix SUPER quando o usuário edita um oscilador extra. O nome e a oitava mantêm seus offsets. O armazenamento de preset, sessão e projeto já copia o patch inteiro. O firmware físico e versões web antigas não implementam as novas formas.

## Validação de software

- Comparação com WASM recompilado da `main` em `2b41567`. Foram comparadas 204.800 amostras escalares dos canais esquerdo e direito, combinando OFF, SAW, PULSE, SAW+PLS e SUPER com PWM, sync, FM e release. O teste também isola as 35 escolhas audíveis distribuídas pelos quatro seletores e mede a mudança de frequência ao subir OSC3/4 uma oitava.
- O teste de projeto grava o arquivo no formato nativo da DAW, reabre o arquivo e aplica os 80 bytes a uma nova instância de teste. A interface foi exercitada em Chrome com Save as, Save, recarga, recuperação de falha de armazenamento e navegação durante uma nota sustentada. A validação do controlador usa MIDI simulado.
- Build integral e referência histórica de UI, suítes de editor, fundação e fundação v2, seleção de timbres, captura suave, perfil MIDI, DAW, 256 vozes, DSP Monitor e áudio do Studio. A comparação do editor também cobriu 256.000 amostras contra a referência anterior ao editor.
- Evidências locais em `.local/validation/analog-four-oscillators/`. Para repetir a comparação específica contra a main, defina `ANALOG_REFERENCE` com o caminho do WASM de 256 vozes compilado nessa revisão. Sem a variável o teste usa a etapa histórica de 128 vozes. Rode `node tests/analog-oscillators.test.mjs` após o build. Para medir o AudioWorklet, use o servidor do simulador e `node tests/browser-analog-oscillators.mjs`.

## Carga no Chrome

Chrome 157.0.8103.78 headless local, AudioWorklet a 44,1 kHz, blocos de 128 frames e pedal sustentado. O teste em DUAL ocupa duas vozes por nota, mantém OSC1/2 em serra e acrescenta senoide em OSC3 e serra invertida em OSC4. A liberação do pedal encerrou as 256 vozes. Cada linha abaixo reúne 1.725 blocos por configuração, cerca de cinco segundos de áudio.

| Vozes | Média com 2 OSC | Média com 4 OSC | Blocos acima de 2,90 ms com 2 OSC | Blocos acima de 2,90 ms com 4 OSC |
|---:|---:|---:|---:|---:|
| 16 | 0,15 ms | 0,15 ms | 0 | 0 |
| 64 | 0,31 ms | 0,34 ms | 0 | 0 |
| 128 | 0,45 ms | 0,51 ms | 0 | 0 |
| 256 | 0,74 ms | 0,84 ms | 10 | 34 |

Na primeira implementação, quatro osciladores a 256 vozes excederam o prazo em 422 blocos. A versão final seleciona uma rotina por forma antes de renderizar o bloco de OSC3/4. O DSP Monitor usa `Date.now` no worklet deste Chrome, com resolução nominal de 1 ms. As ultrapassagens medem duração do processamento e não contam falhas audíveis na saída física. O ensaio cobre um timbre e uma máquina. O aceite musical em controlador e saída físicos está pendente. Em 19/11/2026, os quatro commits de desenvolvimento, de `b037806` a `0b35c9c`, foram integrados à `main` por fast-forward com aprovação do usuário.

## Apresentação de Oscillators

O painel reúne quatro colunas de osciladores e uma de ruído e modulação. Sliders horizontais aceitam as setas do teclado, e os campos adjacentes permitem digitação exata. A afinação aparece centrada em zero. Em janelas de até 960 px de largura, um seletor alterna entre os quatro osciladores e a modulação.

Em Chrome, a 1366 × 768, a altura do editor passou de 1486 para 286 px. Com a ajuda e as opções de expressão recolhidas, o editor, o teclado e os pads couberam na janela a 1024 × 768, 1280 × 720, 1366 × 768 e 1536 × 750. A 390 × 844 a página permite rolagem vertical até o teclado. O teste de interface percorre as cinco seções móveis com uma nota sustentada e verifica que a troca de seção não envia comandos ao instrumento. Capturas e medições em `.local/validation/oscillator-layout/`.

## Fine e Pulse width em OSC3 e OSC4

Cada oscilador tem afinação fina independente. Fine usa a mesma escala do OSC2, com zero no centro. Cada passo equivale a 0,78125 cent, com alcance de −50 a aproximadamente +49 cents. Para ouvir o batimento, use duas serras na mesma oitava e desloque ligeiramente o Fine de uma delas.

Selecione PULSE para habilitar Pulse width. O controle tem 128 posições e começa em 64, próximo a uma onda quadrada. O oscilador lembra a largura ao trocar de forma. SQUARE, WIDE PULSE e NARROW PULSE oferecem as três larguras fixas. A largura de OSC3/4 é manual. As rotas de PWM por LFO continuam disponíveis em OSC1/2.

O patch salvo continua com 80 bytes. Com os novos ajustes neutros, a gravação usa a codificação anterior. Timbres que usam a nova forma, uma afinação fina deslocada ou uma largura memorizada diferente da inicial exigem esta versão ou posterior para reprodução correta. Favoritos, cenas de pattern, projetos da DAW e snapshots do Studio passam pelos mesmos conversores de leitura e gravação.

A comparação com a revisão anterior da branch (`1b4c3d4`) cobriu as sete formas anteriores de cada oscilador extra e reproduziu 143.360 amostras de canal idênticas. Para repetir, defina também `OSC_BANK_REFERENCE` com o WASM dessa revisão ao executar `tests/analog-oscillators.test.mjs`. O teste mede a afinação nos extremos, compara três larguras de pulso por oscilador e verifica a recuperação dos valores na DAW, em favorito e em pattern. Os testes do Studio e do editor verificam a restauração do snapshot e a recarga do preset no navegador.
