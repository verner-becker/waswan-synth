# Polifonia — etapa de 8 vozes

Escopo autorizado: utilizar as oito vozes existentes no OberVave. Não foram implementadas 16, 32, 64 ou 128 vozes. O trabalho anterior de mapeamento está preservado na tag pública `v0.2.0`; esta etapa está isolada na branch `feat/polyphony-8`. O controle fino de cutoff ficou adiado em favor desta etapa.

## Causa do comportamento monofônico

A sessão de fábrica usada pelo simulador carrega a parte A com programa 71, nome INIT, osciladores OSC1/OSC2 em SAW e `P_MODE = M_MONO`. Essa sessão contém um snapshot: o nome INIT não significa que seus parâmetros atuais coincidam com os defaults do preset INIT.

Reprodução automática: oito note-ons distintos na mesma rodada de processamento, com essa sessão intacta, resultam em uma voz sustentada na última nota. Alterar somente `P_MODE` para POLY permite oito notas sustentadas. Não foi identificado um limite de uma voz na entrada Web MIDI: o mesmo controlador passa as oito notas ao DSP após a mudança de modo.

Uma sessão pessoal restaurada pode conter outros modos. A interface consulta o estado real do motor e não força POLY ao iniciar ou carregar presets, preservando as escolhas armazenadas. Para esta validação, selecione explicitamente POLY no painel WASWAN.

## Implementação isolada

- `wasm/waswan-sim.c` inclui o simulador original, sem editar o submódulo, e acrescenta setters específicos de modo/unison e telemetria de slots, gates e envelopes. Usa o mesmo `set_param_in` do editor original. Uma asserção de compilação exige `NV == 8`.
- `web/engine.js` estende a classe original com as mensagens `voice-mode` e `voice-unison`, e acrescenta o estado de polifonia aos frames já enviados pelo AudioWorklet/Worker. O renderizador de áudio é herdado sem alteração.
- `web/polyphony-panel.js` mostra os modos da parte selecionada por K6, contagem global de vozes, posições/notas, vozes sustentadas e caudas de release. Em UNISON, permite escolher de 1 a 8 vozes sobre a mesma nota. A interface distingue o limite SUPER.
- `scripts/stage-simulator.sh` cria a cópia executável com um único hook explícito na função de frames do app original. O script verifica o ponto de integração e falha se o contrato upstream mudar.
- `scripts/build-simulator.sh` mantém a compilação original como referência (`SMKSYNTH-1.2.0.wasm`) e compila a extensão host separadamente (`waswan-8.wasm`). Somente a extensão é servida nesta etapa.

Nenhuma alteração foi aplicada ao firmware físico, ao alocador original, ao número de vozes, às formas de onda, aos envelopes, aos efeitos, aos formatos de preset/sessão ou à chave de armazenamento do perfil MIDI.

Trocar modo ou quantidade UNISON pela interface chama a liberação já existente de notas/pedal/rodas antes da edição. Modifica o timbre em execução; não substitui o preset, não muda a sessão de fábrica e não faz SAVE automático. Para preservar a edição em um preset, use o fluxo SAVE original. Os outros parâmetros do saw permanecem iguais.

## Orçamento de vozes

| Modo | Uso das vozes | Notas simultâneas máximas, com o pool livre |
|---|---|---|
| POLY | Uma voz por nota | 8 |
| MONO | Uma voz, prioridade da última tecla | 1 |
| DUAL | Duas vozes por nota | 4 |
| UNISON | 1–8 vozes sobre a mesma nota | 1 |

As oito vozes melódicas são compartilhadas entre A–D, incluindo sequenciador e split/layer. Release também ocupa o pool. Em POLY, a nona nota substitui uma voz: o alocador prioriza uma voz livre, depois a mais antiga liberada, depois a mais antiga sustentada, respeitando a proteção existente de grupos MONO/UNISON de outras partes.

SUPER/Supersaw mantém seu limite global de cinco vozes, contando release e grupos. O indicador global continua mostrando o pool de oito; a descrição da parte mostra o teto SUPER de cinco quando aplicável. DRUM-X utiliza vozes independentes e não é contado como um slot melódico do indicador.

## Verificações técnicas concluídas

```sh
sh scripts/build-simulator.sh
node tests/polyphony.test.mjs
node tests/midi-profile.test.mjs
sh scripts/check-upstream.sh
python3 scripts/serve-simulator.py
```

O teste de polifonia verifica:

- Causa MONO reproduzida com o snapshot de fábrica; prioridade da última nota e retorno à anterior.
- Acordes simultâneos de 1–8 notas, slots distintos, note-off e caudas de release.
- Nona nota, preferência por vozes liberadas e note-off de nota roubada sem interromper sua substituta.
- Sustain CC64, soltura do pedal, note-on com velocity zero, retriggers e panic sem vozes presas.
- Orçamentos de MONO/DUAL/UNISON, UNISON de oito vozes e transições de modo.
- Pool compartilhado com sequenciador e preservação do teto SUPER de cinco vozes.
- Preservação de todos os parâmetros exceto o modo editado, das demais partes, do banco e da ausência de SAVE automático.
- Áudio estéreo idêntico amostra por amostra à compilação original enquanto as novas edições não são usadas; blobs de sessão iguais.
- Integração do adaptador MIDI com oito notas, mapeamento de knob e desconexão segura.

Na medição desta máquina, dez segundos de áudio com oito notas sustentadas renderizaram em aproximadamente 116 ms no Node, pico 0,4392, sem NaN/Inf ou saturação de saída. É uma medição local de processamento, não uma garantia de latência ou ausência de xruns em qualquer navegador.

Os testes MIDI e musicais originais passaram sobre o WASM estendido, preservando cinco patterns e oito favoritos. O teste do perfil MIDI também passou.

No Chrome, uma entrada MIDI sintética exercitou os quatro modos, acorde de oito notas, nona nota, sustain, release, UNISON de oito e preservação do mapeamento. AudioContext ativo a 44,1 kHz, áudio não nulo, nenhuma exceção JS e painel inspecionado em 1440 e 390 px. Evidências locais ignoradas pelo Git: `.local/validation/polyphony-*`. A validação musical no teclado físico ainda depende da confirmação do usuário.

## Validação objetiva no SMK-37 Pro

1. Recarregue `http://localhost:8737/simulator/`, inicie o simulador e conecte **SMK-37 Pro-Master**. Mantenha a janela em foco. Confira GLOBAL/MIDI CH em OMNI e MIDI MODE desligado.
2. Selecione a parte A e **POLY** no painel WASWAN. Não carregue outro favorito/pattern durante a verificação: esses snapshots podem restaurar MONO. Os knobs mapeados continuam disponíveis.
3. Com o sequenciador parado e sem LAYER, toque e segure C3, E3, G3, C4, E4, G4, C5 e E5: devem soar juntas e aparecer **8/8**, disponíveis 0. Solte uma tecla: ela deve entrar em release e depois liberar seu slot.
4. Segure as oito e acrescente G5: o indicador deve continuar em 8/8, substituindo uma nota antiga. Soltar a tecla da nota roubada não deve cortar a nova nota. Ao soltar todas, o indicador deve retornar a 0 após o release; a reverb pode continuar audível sem ocupar vozes melódicas.
5. Se tiver pedal configurado como CC64, pressione-o, toque um acorde, solte as teclas e depois solte o pedal. As vozes devem permanecer sustentadas até a soltura do pedal e então terminar o release. Se CC64 estiver aprendido como slider no mesmo canal/porta, ele foi remapeado: desative o perfil para testar o pedal original ou remova somente essa associação.
6. Compare MONO, DUAL e UNISON. MONO deve tocar uma nota; DUAL permite quatro notas com oito vozes; UNISON empilha o número escolhido de vozes na mesma nota. Volte a POLY e confira que os quatro knobs e o timbre saw continuam utilizáveis.
7. Segure um acorde e troque de janela ou desconecte a entrada MIDI: as notas devem ser liberadas. Use **Soltar tudo** se necessário. Reconecte e teste novamente.

## Limite da fase e próximas aprovações

Esta fase não autoriza a etapa 8 → 16. Aguarda-se validação musical e técnica e uma autorização explícita antes de qualquer aumento.

Antes de uma expansão futura, revisar ao menos: `vc[NV]`, `grp_v[NPART][NV]`, índices, o bitmask `taken` de 32 bits e deslocamentos `1u << pick` em `group_pick`; `NHELD=16`, filas de eventos `NQ=64`, buffers de áudio de até 1024 frames, matrizes de envelopes/estado por voz, tabelas de oito voice cards e caminhos de mix/acumulação. Preservar ou justificar separadamente `SUPER_LIMIT=5`; medir custo DSP e margem por quantum de áudio real no navegador. Essa revisão não equivale à implementação de nenhuma dessas expansões.
