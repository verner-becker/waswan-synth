# WASWAN Synth

Sintetizador web em desenvolvimento a partir do [SMKSYNTH](https://github.com/4t59m4f784-creator/SMKSYNTH), com áudio e execução pelo SMK-37 Pro validados localmente. Preserva o DSP, a interface, a autoria e o histórico originais. Sem alterações de firmware ou grandes refatorações.

O código original está em `upstream/SMKSYNTH`, como submódulo fixado no commit `3f751bc2be066414f204cf44e1aa05d9c7467d7f` (release declarada: 1.2.0). A árvore original permanece intacta.

## Executar no Ubuntu

Pré-requisitos: Git, Python 3, curl, patch e uv para preparar as ferramentas; Node.js para os testes. Chrome/Chromium com Web Audio e Web MIDI para tocar com o teclado.

```sh
git clone --recurse-submodules https://github.com/verner-becker/waswan-synth.git
cd waswan-synth
git switch feat/polyphony-32
sh scripts/setup-tools.sh
sh scripts/build-simulator.sh
sh scripts/check-upstream.sh
node tests/midi-profile.test.mjs
node tests/polyphony.test.mjs
node tests/polyphony-16.test.mjs
node tests/polyphony-32.test.mjs
python3 scripts/serve-simulator.py
```

Abra **http://localhost:8737/simulator/**, clique em **Iniciar simulador**, depois em **Conectar teclado MIDI**, autorize o acesso e escolha **SMK-37 Pro-Master**. Mantenha a aba em foco: o original ignora entrada MIDI em abas ocultas e solta notas ao perder o foco. `Soltar tudo` libera as notas e o sustain.

Para ouvir os exemplos, use PLAY no painel. Para tocar pela entrada MIDI na parte selecionada, mantenha `GLOBAL → MIDI CH = OMNI`. O `MIDI MODE` do painel simulado suspende o sintetizador; deixe esse modo desligado para produzir áudio.

As ferramentas ficam em `.tools/` e os resultados em `.local/`, ambos ignorados pelo Git. O servidor usa apenas o loopback e serve o simulador, a tradução e os avisos de licença. Os instaladores de firmware não são publicados por esse servidor. Os links originais de instalação no rodapé não possuem destino nesta execução local.

O build usa o script original `tools/build_controls_sim.sh`, Zig 0.15.1 e Binaryen 133, e compila separadamente a extensão host em `wasm/waswan-sim.c`. É possível fornecer executáveis próprios pelas variáveis `ZIG` e `WASM_OPT`. Não há npm install para executar o sintetizador; Node é utilizado somente na verificação.

## Resultados e próximo passo

Veja [a auditoria e a proposta de expansão](docs/auditoria-inicial.md). Os comandos acima reconstroem o WASM e executam os testes MIDI e musicais originais sobre esse artefato.

A primeira entrega está marcada como `v0.1.0`. A expansão acrescenta um [perfil MIDI optativo para knobs e faders](docs/perfil-midi.md): abra o painel WASWAN abaixo da entrada MIDI, ative o perfil e aprenda um controle por vez. O código original continua preservado no submódulo.

A fase de mapeamento está preservada em `v0.2.0`. A etapa seguinte expôs [POLY de até 8 vozes, MONO, DUAL e UNISON](docs/polifonia-8.md), com indicador de slots/gates/release. A sessão de fábrica abre o saw da parte A em MONO: selecione **POLY** no painel WASWAN para tocar acordes, preservando os demais parâmetros.

A etapa de oito foi validada e preservada na tag `v0.3.0`. A etapa [8 → 16 vozes](docs/polifonia-16.md) passou pelos testes por software e está preservada em `main` e na tag `v0.4.0`.

Nesta branch, a etapa [16 → 32 vozes](docs/polifonia-32.md) foi autorizada, com testes delegados ao agente. POLY oferece 32 notas, DUAL 16, UNISON mantém oito vozes por nota e SUPER mantém teto global de cinco. O patch é aplicado somente à cópia de compilação, com listas e filas ampliadas. O indicador mostra 32 slots e **Sustain MIDI** permite acumular notas em grupos menores. Não foram iniciadas 64 ou 128.

Para atualizar apenas a interface, sem recompilar o DSP, execute `sh scripts/stage-simulator.sh`. Verifique o perfil com `node tests/midi-profile.test.mjs`.

Fluxo Git: commits locais descritivos; atualizar o submódulo apenas por decisão explícita de incorporar uma nova base. Não há CI/CD nesta etapa.

## Inspecionar o código

A branch principal preserva a entrega de 16; esta branch contém a etapa de 32 testada por software. A tag `v0.1.0` preserva a primeira execução validada, anterior às expansões.

- [Auditoria inicial](docs/auditoria-inicial.md): inventário, arquitetura, licenças e testes de áudio/MIDI.
- [Perfil MIDI](docs/perfil-midi.md): aprendizado, validação física e diagnóstico dos passos de cutoff.
- [Polifonia de 8 vozes](docs/polifonia-8.md): causa do modo mono, orçamento de vozes, testes e roteiro no SMK-37 Pro.
- [Polifonia de 16 vozes](docs/polifonia-16.md): revisão de estruturas, patch isolado, custo DSP e validação musical pendente.
- [Polifonia de 32 vozes](docs/polifonia-32.md): filas maiores, teste da máscara completa, benchmarks e teste reproduzível no Chrome.
- [Adaptador MIDI WASWAN](web/midi.js) e [lógica do perfil](web/midi-profile.js): extensões fora do upstream.
- [Fontes originais na revisão fixada](https://github.com/4t59m4f784-creator/SMKSYNTH/tree/3f751bc2be066414f204cf44e1aa05d9c7467d7f): consulte `web/simulator/`, `web/sim/sim.c` e `firmware/src/` para interface, integração WASM e DSP. O submódulo aparece como um link no GitHub; o clone recursivo baixa essas fontes.

O usuário confirmou o saw, áudio no navegador, quatro knobs e um slider, e POLY na etapa de oito. Em seguida autorizou 16 e 32, delegando os testes de polifonia ao agente. As verificações automatizadas e no Chrome estão documentadas. Qualquer aumento acima de 32 exige nova autorização explícita. O controle fino de cutoff segue adiado; não há interface modular completa nesta etapa.

Código e adaptações: GPL-3.0-only; consulte [LICENSE](LICENSE). Preserve também [os créditos originais](upstream/SMKSYNTH/CREDITS.md) e [as licenças dos componentes](upstream/SMKSYNTH/LICENSING.md). Nenhuma alteração foi enviada ao teclado.
