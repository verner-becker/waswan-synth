# Tone Editor v1

## Base e escopo

Branch `feat/tone-editor-v1`, derivada da `main` funcional em
`eb9f2b26c6de28dcb4b0f1257ac243eb638bf44a`. O estudo inicial está em
[tone-editor-v1-study.md](tone-editor-v1-study.md). Não houve merge desta fase,
criação de tags, atualização do submódulo ou alteração de firmware/DSP.

TONES agora contém um editor para o motor ANALOG, com **63 parâmetros reais** em
sete seções: Oscillators, Filter, Envelopes, Modulation, Voice, Arpeggiator e
Shared effects. O nome/programa continua no cabeçalho. Performance, Diagnostics
e Legacy SMK permanecem disponíveis na mesma instância do instrumento.

## Arquitetura

- `obv_params.h`: catálogo `PDEF`, tipos, limites e nomes originais.
- `wasm/waswan-sim.c`: adaptadores host para metadados, valores, apresentação,
  edição por ID e preparação da gravação. Nenhum algoritmo de síntese foi alterado.
- Edição chama `set_param()`, `auto_rec()` e `fx_sync()`: mantém Edited, rotas,
  automação existente em REC e efeitos globais. Valores não são linearizados em Hz.
- `web/engine.js`: valida mensagens, transmite catálogo uma vez por instância,
  snapshots de valores e recibos de edição/gravação. Formata valores novamente
  somente quando mudam valores, parte ou motor. Não depende de TextEncoder,
  indisponível no AudioWorklet do Chrome testado.
- `web/ui-tone-editor.js`: composição de `Panel`, `RotaryKnob`, seleções nativas,
  campos de passos internos e diálogo acessível de Save/Save as. O estado musical
  permanece no motor; só o rascunho de nome/destino fica no diálogo.
- `web/ui-foundation.js/css`: integração no workspace TONES e estilos reutilizados.
  Navegação não envia mensagens musicais nem reinicia o AudioContext.
- `scripts/stage-simulator.sh`: dois hooks na cópia gerada do `app.js` informam
  sucesso/falha da escrita **já existente** no localStorage. Não há outra chave ou
  mecanismo de persistência. A interface correlaciona o hash FNV dos mesmos bytes
  com o recibo de gravação do motor, incluindo falha de armazenamento do navegador.

Snapshots incluem tokens dos 99 destinos para detectar alterações concorrentes
mesmo quando o nome não muda. Tokens de 32 bits são guardas leves, não IDs
criptográficos. A agregação/formatação acontece no caminho de snapshots existente;
nenhuma mensagem, arquivo ou estatística extra é produzida por bloco DSP.
Não foi feito benchmark dedicado de overhead nesta fase.

## Escalas, partes e limitações musicais

Os campos numéricos editam unidades internas; knobs aceitam mouse/toque e teclado
com passos unitários. Seleções mostram os nomes originais dos valores enumerados.
O LFO usa a tabela original com duas casas na apresentação, permitindo mostrar
0,05 Hz em vez do arredondamento visual legado para 0,0 Hz.

Cada seção lê a parte A–D selecionada e acompanha alterações pelo Legacy ou MIDI.
Shared effects indica explicitamente que chorus/delay/reverb pertencem à parte A
/settings e atendem todas as partes. Não equivale a efeitos independentes por timbre;
sends e mixer continuam em Performance/Legacy. Editar um efeito compartilhado
marca a parte A, não uma cópia fictícia na parte B–D.

SYNC e FM ficam indisponíveis em SUPER, pois o DSP os ignora nesse modo.
**SUPER MIX**, drive paralelo/master, mixer completo e configurações globais ainda
ficam no Legacy. DRUM-X mostra aviso e não expõe os bytes como parâmetros ANALOG.
Os perfis MIDI existentes e as atribuições fixas da Performance são preservados;
esta entrega não cria 63 novos destinos de MIDI Learn ou reatribuições automáticas.

## Save e Save as

1. **Save** abre confirmação do slot atual, mantendo nome e destino bloqueados.
2. **Save as…** permite editar nome e escolher um dos 99 slots existentes.
3. O diálogo mostra parte, nome e programa de destino que será substituído.
   Cancela por botão ou Escape, sem alterar o patch.
4. O nome aceita 1–10 caracteres, com ao menos um não branco: A–Z, 0–9, espaço e
   hífen. Minúsculas digitadas são convertidas explicitamente para maiúsculas.
5. O adaptador valida escopo, fingerprint do patch e fingerprint do destino,
   contexto ANALOG e ausência de operações incompatíveis. Intenções obsoletas são
   recusadas, sem sobrescrever outro timbre.
6. Prepara nome/destino e chama **`preset_commit()` original**. Evita
   `preset_begin()`, que altera contexto/audition do painel; não simula gestos ou
   uma sequência de eventos MIDI.
7. O programa/nome vivo muda em RAM e Edited limpa conforme a rotina original.
   A gravação pode aguardar transporte parado e vozes em silêncio. O editor não
   envia stop, panic ou reboot para acelerar isso.
8. A interface diferencia pedido, espera, falha, escrita no instrumento e escrita
   no navegador. Após escrita, o feedback original de SAVE pode bloquear controles
   por cerca de 2,2 s antes de retornar à edição. Em uma falha nativa persistente, o diálogo original pode precisar ser fechado/revisado pelo Legacy SMK; a negação de localStorage tem tratamento independente no editor.

Salvar em um slot também atualiza outras partes usando esse slot quando não têm
edições pendentes. Partes editadas são preservadas. O diálogo avisa sobre as partes
potencialmente afetadas. Isso é comportamento original, não novo vínculo de dados.

Não há criação do slot 100: Save as substitui um destino escolhido. Slots de fábrica
recebem overrides do usuário; o banco compilado permanece intacto. Patterns não são
salvos por essas ações. Uma sessão/pattern pode restaurar seu próprio sound set;
SAVE de timbre e SAVE de pattern continuam sendo operações distintas. Após reinício,
o timbre salvo continua disponível no seletor mesmo se outro programa estiver ativo.

Se o navegador negar a escrita, aparece orientação para exportar a sessão em Settings.
A exportação original continua preservando os 21 setores. Não se promete persistência
apenas porque a alteração em RAM já foi aplicada.

## Validação

Evidências locais ignoradas: `.local/validation/tone-editor-v1/`.

| Teste | Resultado |
| --- | --- |
| `tone-editor.test.mjs` | PASS: 63 parâmetros/limites em A–D, SUPER, escopo/token obsoleto, Save/Save as, propagação para parte limpa e preservação de parte editada, DRUM-X bloqueado e restauração dos 21 setores |
| Comparação determinística com a v0.3 anterior | PASS: 256.000 amostras escalares idênticas, com notas, sustain e release; sessão também idêntica sem edições |
| Gravação com nota mantida | PASS: gate permanece ativo, gravação aguarda; após note-off conclui sem panic |
| `browser-tone-editor.mjs` | PASS: 63 controles, sete seções, mouse/teclado, Cancel, Save/Save as, recusa obsoleta, falha/recovery do localStorage, reload, partes/FX compartilhados, 390 px, mesmo AudioContext, reconstrução após reboot explícito sem duplicação e nenhum erro de página/console |
| Regressões Node existentes | PASS: MIDI/profile/diagnóstico, fino/pickup, modos, polifonia 8/16/32/64/128/256, UI Foundation, DSP Monitor e seletor |
| Regressões Chrome existentes | PASS: `browser-tone-selector`, `browser-ui-foundation-v2`, `browser-ui-foundation` (inclui sessão/preset e exportação DSP), `browser-polyphony-256`; sem exceções |

Durante desenvolvimento, os testes detectaram a necessidade de normalizar tokens
WASM como unsigned e evitar TextEncoder no AudioWorklet. Ambos corrigidos e cobertos. A captura de erros de console também identificou a sintaxe mais restrita do atributo HTML pattern no Chrome; a expressão foi corrigida e o teste confirma rejeição de nomes incompatíveis.
Uma asserção do teste de navegador inicialmente incluía o panic de inicialização
original; o teste agora delimita a sessão após startup e verifica ausência de novos
panic/reboot nos fluxos do editor. O servidor HTTP anterior parou durante uma
repetição: foi reiniciado e a sequência de navegador refeita.

Não foi realizado teste físico novo no SMK-37 Pro, medição de latência de hardware,
benchmark dedicado ou novo soak prolongado. Testes sintéticos usam contexto Chrome
isolado, sem ler/modificar a sessão e os mapeamentos pessoais do usuário.

### Reprodução

```sh
sh scripts/build-simulator.sh
# Antes de modificar o código, copiar o WASM da v0.3 para:
# .local/validation/tone-editor-v1/before-256.wasm
# Ou reconstruir a referência de forma reproduzível:
UI_REFERENCE_COMMIT=eb9f2b26c6de28dcb4b0f1257ac243eb638bf44a \
  UI_REFERENCE_DIR=.local/validation/tone-editor-v1 sh tests/build-ui-reference.sh
cp .local/validation/tone-editor-v1/reference-256.wasm \
  .local/validation/tone-editor-v1/before-256.wasm
node tests/tone-editor.test.mjs
python3 scripts/serve-simulator.py
# Em outro terminal, com Playwright/Chrome já instalados conforme os testes existentes:
node tests/browser-tone-editor.mjs
```

A compilação normal foi executada para todas as etapas existentes; a etapa 256 foi
recompilada após os ajustes finais de metadados/formatação. A referência local
anterior foi preservada antes de qualquer alteração.

## Capturas

[Editor desktop](assets/tone-editor-v1/editor-desktop.png) ·
[Viewport menor](assets/tone-editor-v1/editor-mobile.png) ·
[Save as](assets/tone-editor-v1/save-as.png).

## Arquivos e commits

Implementação: `69d654e`; testes: `80eedf9`. Arquivos funcionais: `wasm/waswan-sim.c`,
`web/engine.js`, `web/ui-tone-editor.js`, `web/ui-foundation.js/css`,
`web/ui-tone-selector.js` e `scripts/stage-simulator.sh`. Testes: os dois arquivos
`tests/*tone-editor*.mjs`. Documentação/evidências: este relatório, o estudo inicial,
`docs/assets/tone-editor-v1/`, README e AGENTS.

## Validação manual no Ubuntu

Abra `http://localhost:8737/simulator/`, Ctrl+F5 e Start audio. Conecte o controlador
no MIDI Setup se desejar; abra **TONES**. Selecione um timbre no cabeçalho, ajuste
um parâmetro, confira Edited e toque. Experimente Cancel no Save as; depois escolha
um slot que possa substituir e confirme. Solte as notas e pare o transporte se
houver espera de gravação. Aguarde a confirmação do navegador, recarregue e escolha
o programa salvo. Confira nome e ajustes. Exporte uma sessão para cópia de segurança
usando a operação existente em Settings.
