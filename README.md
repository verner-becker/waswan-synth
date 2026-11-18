# WASWAN Synth

Sintetizador web em desenvolvimento a partir do [SMKSYNTH](https://github.com/4t59m4f784-creator/SMKSYNTH), com áudio e execução pelo SMK-37 Pro validados localmente. Preserva o DSP, a interface, a autoria e o histórico originais. Sem alterações de firmware ou grandes refatorações.

O código original está em `upstream/SMKSYNTH`, como submódulo fixado no commit `3f751bc2be066414f204cf44e1aa05d9c7467d7f` (release declarada: 1.2.0). A árvore original permanece intacta.

## Manual de uso

[Manual completo em PDF](MANUAL-WASWAN-SYNTH.pdf), na raiz: 44 páginas em português, com sumário clicável, capturas reais, referência dos 63 parâmetros ANALOG, Studio/SEQ, recursos Legacy, exercícios e ficha de avaliação de usabilidade. A edição descreve a revisão `04dc1c8`, incluindo Studio e a revisão do SEQ integrados à `main` por aprovação do usuário. A referência `04dc1c8` identifica a implementação descrita, preservada no histórico.

Fonte editável: [docs/manual-waswan-synth.html](docs/manual-waswan-synth.html). Para gerar novamente com o Chrome/Playwright já preparado no projeto: `node scripts/build-manual.mjs`. O gerador verifica imagens, links e conteúdo fora dos limites de página antes de escrever o PDF.

## UI Foundation v0.3

A `main` reúne a UI Foundation v0.3 com seletor de timbres, MIDI Setup e modos de voz na Performance, o motor de 256 vozes, o DSP Monitor, as correções de knobs e o WASWAN Studio com SEQ revisado. A interface, baseada na versão funcional `7dc36c8`, abre o novo cockpit em inglês: Performance, oito knobs reais, quatro níveis de partes, MIDI Learn por controle e navegação por workspaces. O botão **Legacy SMK** alterna o painel original na mesma sessão de áudio. Os futuros editores aparecem identificados como planejados.

```sh
git switch main
sh scripts/build-simulator.sh
python3 scripts/serve-simulator.py
```

Abra http://localhost:8737/simulator/, use **Start audio** e conecte MIDI em **Settings**. Perfis existentes são preservados; nenhum mapeamento é instalado automaticamente. A composição legada completa está em `http://localhost:8737/simulator/?legacy=1&lang=pt`. Consulte [arquitetura, testes, limites e cinco screenshots](docs/ui-foundation-v1.md).

## WASWAN Studio e SEQ

As ondas 0–5, a revisão de UX do SEQ e o manual foram aprovados e integrados à `main` em 17/11/2026, preservando os commits originais. O SEQ oferece New/Open/Save project, Record MIDI com preview e destino A–D, piano roll centrado em C3, clipes, overdub, automação e áudio importado limitado. STUDIO captura e recupera tomadas, exporta WAV/MP3 e projetos locais; o SEQ também exporta MIDI.

Comece por **SEQ → New project → Record MIDI → Stop → Save project**. Consulte o [roteiro de uso](docs/studio-guide.md), o [controle das ondas](docs/studio-waves.md) e a [revisão de UX](docs/studio-seq-ux.md). Validação física/musical e limites documentados continuam distintos dos testes automatizados; não houve atualização de firmware, submódulo ou criação de tag nesta integração.

## WASWAN DAW

A `main` inclui o MVP da DAW aprovado para integração em 18/11/2026. Use **DAW** para montar o Arrangement, editar clipes, gravar MIDI e áudio, mixar e exportar. **Open DAW in new tab** usa o mesmo projeto e a sessão de áudio hospedada no Synth. Consulte o [aceite do MVP](docs/daw-mvp-discovery/acceptance.md), o [parecer do Astra](docs/ux-evolution-astra.md) e o [plano de evolução de UX](docs/ux-evolution-plan.md).

## Executar no Ubuntu

Pré-requisitos: Git, Python 3, curl, patch e uv para preparar as ferramentas; Node.js para os testes. Chrome/Chromium com Web Audio e Web MIDI para tocar com o teclado.

```sh
git clone --recurse-submodules https://github.com/verner-becker/waswan-synth.git
cd waswan-synth
sh scripts/setup-tools.sh
sh scripts/build-simulator.sh
sh scripts/check-upstream.sh
node tests/midi-profile.test.mjs
node tests/polyphony.test.mjs
node tests/polyphony-16.test.mjs
node tests/polyphony-32.test.mjs
node tests/polyphony-64.test.mjs
node tests/polyphony-128.test.mjs
node tests/polyphony-256.test.mjs
python3 scripts/serve-simulator.py
```

Abra **http://localhost:8737/simulator/** e clique em **Start audio**. Use **Use keyboard & pads** para tocar com os controles virtuais. Para usar o SMK-37 Pro, abra **Settings**, clique em **Connect MIDI keyboard** e escolha **SMK-37 Pro-Master**. **Release all** libera notas e sustain. A Performance oferece POLY, MONO, DUAL e UNISON. As opções de diagnóstico ficam em **Settings → Diagnostics → Voice allocation & execution modes**.

Para ouvir os exemplos, use **Play / stop pattern** ou PLAY no **Legacy SMK**. Para tocar pela entrada MIDI na parte selecionada, mantenha `GLOBAL → MIDI CH = OMNI`. O `MIDI MODE` do painel simulado suspende o sintetizador. Use o modo Synth para produzir áudio.

As ferramentas ficam em `.tools/` e os resultados em `.local/`, ambos ignorados pelo Git. O servidor usa apenas o loopback e serve o simulador, a tradução e os avisos de licença. Os instaladores de firmware não são publicados por esse servidor. Os links originais de instalação no rodapé não possuem destino nesta execução local.

O build usa o script original `tools/build_controls_sim.sh`, Zig 0.15.1 e Binaryen 133, e compila separadamente a extensão host em `wasm/waswan-sim.c`. É possível fornecer executáveis próprios pelas variáveis `ZIG` e `WASM_OPT`. Não há npm install para executar o sintetizador; Node é utilizado somente na verificação.

## Tone Editor v1

Integrado à `main`, **TONES** apresenta os 63 parâmetros ANALOG em sete seções, com **Save** e **Save as…** na biblioteca existente de 99 programas. A gravação exige confirmação e informa a espera por silêncio e o resultado do armazenamento no navegador. Não há mudança no DSP ou nos formatos de presets/sessões. DRUM-X e controles especiais ainda usam Legacy SMK. Veja [arquitetura, limites e validação](docs/tone-editor-v1.md). A implementação foi aprovada pelo usuário e integrada preservando o histórico.

## Controle fino de knobs v1

O perfil MIDI, integrado à `main`, permite escolher **Normal / Fino** em cada mapeamento existente de K1–K4. Normal preserva os passos e a aceleração originais; Fino absoluto usa posição com captura suave; relativos finos alteram uma unidade interna por incremento lógico nos parâmetros diretos da tela. Presets e mapeamentos anteriores são preservados; o padrão continua Normal.

Após atualizar o repositório, execute `sh scripts/build-simulator.sh` uma vez e recarregue o navegador: esta fase acrescenta uma API host ao WASM. Depois, selecione Fino na linha do knob; não precisa reaprender. O cutoff mantém sua escala original em Hz. Veja [contrato, testes, limitações e teste no SMK-37 Pro](docs/knob-fine-control.md).

## Diagnóstico MIDI ao vivo

O painel **WASWAN · Diagnóstico MIDI ao vivo** registra CCs, interpretação do mapeamento e evolução dos parâmetros. **Iniciar captura ao vivo → Marcar problema → Encerrar** envia os registros somente ao servidor local e permite exportar JSONL. Atualize a interface com `sh scripts/stage-simulator.sh` e reinicie o servidor Python para habilitar a recepção. Não grava áudio ou notas.

A captura física confirmou um limite do controle absoluto por deltas: CC53 com parâmetro20 pode chegar a CC127 com parâmetro94. O Fino absoluto agora corrige esse desalinhamento com captura suave: gire até o CC indicado na linha do mapeamento e, após sincronizar, use todo o curso. Normal mantém o contrato original. Veja [evidência, uso e testes](docs/midi-diagnostic.md).

## DSP Monitor v1

O botão **Mostrar WASWAN DSP Monitor** em **Settings → Diagnostics** habilita a instrumentação opcional. Use **Iniciar captura → Encerrar captura → Exportar JSONL**. O monitor nasce desligado e não altera o DSP. No Chrome instalado, o relógio do worklet tem resolução nominal de 1 ms: percentis são aproximados e exceder o orçamento não comprova underrun. Veja [arquitetura, precisão, testes e resultados](docs/dsp-monitor-v1.md).

Use `sh scripts/stage-simulator.sh` para atualizar somente a interface após gerar os artefatos WASM e recarregue o navegador. As etapas anteriores estão preservadas no histórico e nas tags existentes.

## Resultados e próximo passo

Veja [a auditoria e a proposta de expansão](docs/auditoria-inicial.md). Os comandos acima reconstroem o WASM e executam os testes MIDI e musicais originais sobre esse artefato.

A primeira entrega está marcada como `v0.1.0`. A expansão acrescenta um [perfil MIDI optativo para knobs e faders](docs/perfil-midi.md): abra o painel WASWAN abaixo da entrada MIDI, ative o perfil e aprenda um controle por vez. O código original continua preservado no submódulo.

A fase de mapeamento está preservada em `v0.2.0`. A etapa seguinte expôs [POLY de até 8 vozes, MONO, DUAL e UNISON](docs/polifonia-8.md), com indicador de slots/gates/release. A sessão de fábrica abre o saw da parte A em MONO: selecione **POLY** no painel WASWAN para tocar acordes, preservando os demais parâmetros.

A etapa de oito foi validada e preservada na tag `v0.3.0`. A etapa [8 → 16 vozes](docs/polifonia-16.md) passou pelos testes por software e está preservada em `main` e na tag `v0.4.0`.

A etapa [16 → 32 vozes](docs/polifonia-32.md) foi testada por software, aprovada pelo usuário e preservada em main/tag `v0.5.0`.

A etapa [32 → 64 vozes](docs/polifonia-64.md) foi aprovada e preservada em main/tag `v0.6.0`.

A etapa [64 → 128 vozes](docs/polifonia-128.md), preservada no commit `00293b3`, alcançou o limite alvo inicial. Usa máscara de quatro palavras de 32 bits, listas de 128 notas e filas de 512 eventos. POLY oferece até 128 notas, DUAL 64, UNISON mantém oito vozes por nota e SUPER mantém cinco globais. O indicador mostra 128 slots; **Sustain MIDI** permite acumular notas em grupos menores. Testes automatizados e no Chrome passaram. Upstream, presets, perfil MIDI e firmware físico preservados.

Integrado à `main`, o [experimento autorizado de 256 vozes](docs/polifonia-256.md) passou nos testes do motor e do Chrome. O build serve 256 por padrão. O pool compartilhado suporta duas partes POLY com 128 notas cada ou uma parte DUAL com 128 notas. Cada parte continua limitada às 128 alturas MIDI; a interface distingue esse limite da capacidade de vozes. Máscara de 256 bits e filas de 1024, com UNISON de oito e SUPER de cinco preservados. A etapa de 128 permanece acessível pelo histórico; o limite experimental de 256 foi incorporado à `main` com autorização do usuário.

Para atualizar apenas a interface, sem recompilar o DSP, execute `sh scripts/stage-simulator.sh`. Verifique o perfil com `node tests/midi-profile.test.mjs`.

Fluxo Git: cada próxima etapa ocorre em branch isolada, com commits descritivos e push de implementação, testes e relatório. A incorporação à `main` exige aprovação do usuário; tags são criadas somente quando solicitadas. Branches concluídas podem ser removidas após confirmar que seus commits estão na `main`. Esse ciclo é parte do trabalho em todas as fases. Atualizar o submódulo apenas por decisão explícita de incorporar uma nova base. Não há CI/CD nesta etapa.

## Inspecionar o código

A branch principal contém a UI Foundation, 256 vozes, diagnósticos e controle fino. A consolidação de 16/11/2026 também incorporou a auditoria de UX e o guia de contribuição; as branches concluídas foram removidas sem descartar seus históricos. A tag `v0.1.0` preserva a primeira execução validada, anterior às expansões.

- [Auditoria de UX](docs/ux-audit.md): inventário, arquitetura, capturas e roadmap que orientaram a nova interface.
- [UI Foundation v0.1](docs/ui-foundation-v1.md): contrato dos controles, workspaces, validação e limitações.
- [Auditoria inicial](docs/auditoria-inicial.md): inventário, arquitetura, licenças e testes de áudio/MIDI.
- [Perfil MIDI](docs/perfil-midi.md): aprendizado, validação física e diagnóstico dos passos de cutoff.
- [Polifonia de 8 vozes](docs/polifonia-8.md): causa do modo mono, orçamento de vozes, testes e roteiro no SMK-37 Pro.
- [Polifonia de 16 vozes](docs/polifonia-16.md): revisão de estruturas, patch isolado, custo DSP e validação musical pendente.
- [Polifonia de 32 vozes](docs/polifonia-32.md): filas maiores, teste da máscara completa, benchmarks e teste reproduzível no Chrome.
- [Polifonia de 64 vozes](docs/polifonia-64.md): máscara de 64 bits, bit 63 validado, arpejo, regressões e custo DSP/memória.
- [Polifonia de 128 vozes](docs/polifonia-128.md): máscara de múltiplas palavras, faixa MIDI completa, sustain, voice stealing e custo de processamento.
- [Experimento de 256 vozes](docs/polifonia-256.md): duas partes POLY, DUAL completo, slot 255, limites de índices e medição no navegador.
- [Adaptador MIDI WASWAN](web/midi.js) e [lógica do perfil](web/midi-profile.js): extensões fora do upstream.
- [Fontes originais na revisão fixada](https://github.com/4t59m4f784-creator/SMKSYNTH/tree/3f751bc2be066414f204cf44e1aa05d9c7467d7f): consulte `web/simulator/`, `web/sim/sim.c` e `firmware/src/` para interface, integração WASM e DSP. O submódulo aparece como um link no GitHub; o clone recursivo baixa essas fontes.

O usuário confirmou o saw, áudio no navegador, quatro knobs e um slider, e POLY na etapa de oito. Em seguida autorizou as etapas de 16, 32, 64 e 128, delegando os testes de polifonia ao agente. As verificações automatizadas e no Chrome estão documentadas. Após alcançar 128, o usuário autorizou o experimento de 256 em branch isolada. Qualquer expansão acima de 256 exige nova autorização explícita. O controle fino percorre a escala original do cutoff. A fundação modular está disponível; os novos editores especializados permanecem planejados.

Código e adaptações: GPL-3.0-only; consulte [LICENSE](LICENSE). Preserve também [os créditos originais](upstream/SMKSYNTH/CREDITS.md) e [as licenças dos componentes](upstream/SMKSYNTH/LICENSING.md). Nenhuma alteração foi enviada ao teclado.
