# Tone Editor v1 — estudo inicial

## Referência e escopo

Base funcional: `eb9f2b26c6de28dcb4b0f1257ac243eb638bf44a`, integrada à
`main` por fast-forward com autorização do usuário. O seletor de timbres foi
publicado e sua branch temporária removida após confirmação de ancestralidade.
Nova branch: `feat/tone-editor-v1`. Este incremento contém somente estudo;
nenhum editor ou mudança musical foi implementado.

Objetivo: visualizar os parâmetros reais da parte selecionada, ajustar o timbre,
salvar no programa atual ou salvar com outro nome em um slot escolhido da lista.

## Mecanismos existentes confirmados

| Responsabilidade | Código a reutilizar |
| --- | --- |
| Catálogo, tipos, limites, defaults e páginas | `upstream/SMKSYNTH/firmware/src/obv_params.h`: `PDEF`, `PAGE`, `NPARAM` |
| Valores vivos por parte | `live_p[]`; `web/sim/sim.c`: `sim_param()` |
| Aplicação de parâmetros e Edited | `obervave.c`: `set_param_in()`, `set_param()`, `ed_patch()` |
| Leitura/carregamento dos 99 programas | `prog_get()`, `trk_load()`; adaptadores em `wasm/waswan-sim.c` |
| Nome, destino e gravação de preset | `obv_perf.h`: `preset_begin()`, `preset_turn()`, `preset_commit()` |
| Gravação persistente | `prog_put()`, `manual_store_request`, loop de armazenamento de `obervave.c` |
| Transporte e armazenamento no navegador | Engine/AudioWorklet existentes; mensagem `store` recebida pelo `app.js` original |
| Controles e tema | `web/ui-primitives.js`, `web/ui-foundation.css`, `web/ui-controls.js` |

O contrato semântico atual cobre somente parte dos parâmetros. O editor exigirá
um adaptador host isolado para metadados, leitura e edição por ID, sem alterar o
DSP nem expor ponteiros de memória à interface. Reutilizar os setters originais,
incluindo limites especiais, Edited e efeitos compartilhados. As assinaturas
definitivas e sua segurança contra comandos concorrentes ainda precisam ser
validadas durante a implementação.

## Organização visual proposta para revisão

Usar inicialmente o workspace TONES já reservado, com o seletor do cabeçalho
preservado. Mostrar parte, programa, nome e Edited; oferecer grupos compactos:
Oscillators, Filter, Envelopes, Modulation, Voice e Shared Effects.

Cada grupo apresenta valores reais, unidade/escala original e controles existentes
reutilizados. Mostrar parâmetros enumerados como seleções e os numéricos com
ajuste unitário. Não desenhar oito osciladores ou uma matriz inexistente.

O primeiro incremento recomendado contempla ANALOG. Em DRUM-X, identificar o
motor e oferecer Legacy SMK até existir um editor específico; os mesmos bytes
têm outros significados nesse motor. Efeitos devem indicar claramente que são
compartilhados, enquanto os sends e níveis pertencem ao mixer de cada parte.

## Save e Save as

- **Save:** confirmar número/nome do slot atual e sobrescrever usando o fluxo
  original. Slots de fábrica recebem uma substituição do usuário; não se altera
  o banco compilado no upstream.
- **Save as:** editar nome e escolher outro slot entre os 99 existentes; mostrar
  o nome atualmente armazenado no destino e confirmar a substituição. Não há
  acréscimo de um centésimo slot nem biblioteca paralela.
- Nome compatível com o editor original: dez caracteres, espaço, A–Z, 0–9 e hífen
  (`PRESET_CHARS`). Validar explicitamente; não truncar silenciosamente.
- Cancelar a preparação não altera nome, slot ou patch vivo. Conferir parte,
  programa, patch e destino antes de confirmar, para recusar intenções obsoletas.
- `preset_commit()` atualiza outras partes que usam o mesmo slot **se não estão
  editadas**. A confirmação deve informar esse alcance, preservando a regra.
- Distinguir aplicação em RAM de conclusão da gravação. O fluxo original pode
  aguardar transporte parado e áudio quieto; não forçar stop, panic ou flush para
  aparentar sucesso imediato. Falha/busy deve permanecer visível e recuperável.
- Somente concluir “Saved” com confirmação do mecanismo existente. A falha de
  persistência no navegador também deve ser comunicada, mantendo exportação de
  sessão como recurso de preservação já existente.

O adaptador deve reutilizar o fluxo de gravação original, sem simular longas
sequências de encoders ou criar outro armazenamento. A entrada nesse fluxo chama
`audition_off()` e altera contexto de painel; seu alcance musical precisa ser
testado antes de escolher o ponto exato da integração. Não prometer ausência de
efeitos sobre notas sem essa validação.

## Incrementos e validação recomendados

1. Snapshot e catálogo completos do ANALOG; visualização agrupada no TONES.
2. Edição por ID, sincronização Legacy/MIDI, limites e indicação Edited.
3. Save/Save as com nome, destino, confirmação e estados de gravação.
4. Testes de restauração após reinício e exportação/importação, além das
   regressões de MIDI, áudio, polifonia e DSP Monitor.

Cobrir mudanças concorrentes de parte/preset, cancelamento, destino ocupado,
propagação para outras partes, falha/busy, espera por silêncio e atualização do
catálogo. Comparar áudio deterministicamente sem edições e validar Chrome em
desktop/viewport estreito. Nenhum desses testes futuros está declarado como
executado neste estudo.

Para consolidar o seletor, `node tests/tone-selector.test.mjs` foi reexecutado e
passou: catálogo, A–D, consentimento, intenções obsoletas, rename/SAVE-as original,
restauração e duas comparações de 128.000 amostras escalares idênticas. As demais
evidências anteriores estão em `docs/tone-selector-v1.md`. Não houve teste físico
novo com o SMK-37 Pro.

## Limites

Sem novo DSP, formatos de presets/sessões, bancos, busca, favoritos, undo,
comparação A/B ou editor DRUM-X neste estudo. A branch será revisada antes de
qualquer integração à `main`.
