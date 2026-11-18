# WASWAN Studio — roteiro de uso e validação

Implementação disponível na `main`, integrada com aprovação do usuário em 17/11/2026. Estado por etapa: [controle das ondas](studio-waves.md). Cada fechamento registra implementação, testes, limitações, decisões e próximo passo.

## Executar

```sh
sh scripts/setup-tools.sh
sh scripts/build-simulator.sh
python3 scripts/serve-simulator.py
```

Abrir `http://localhost:8737/simulator/` em Chrome/Chromium desktop. Start audio inicia o único instrumento; conectar o controlador em Settings. As telas em inglês compartilham o synth e as atribuições existentes. Não é preciso parar notas para navegar.

## Fluxo direto no SEQ

1. **New project** inicia uma composição vazia: limpa tomada, notas, clipes, automações e fontes em memória; pede confirmação ao descartar trabalho. Os sons, mixer e mappings vivos continuam disponíveis. As recuperações no navegador permanecem separadas.
2. Escolher **Record into Part A–D** e clicar **Record MIDI**. Tocar no controlador: notas temporárias aparecem em laranja no roll, centrado em C3 (MIDI 48). O destino define onde guardar notas; o som vivo segue o roteamento existente.
3. **Stop** finaliza e incorpora a captura. Também pode usar Stop recording em Studio. Play reproduz a composição; Loop permite acompanhamento repetido ao gravar camadas.
4. Selecionar uma nota abre **Note inspector**; **Clear MIDI notes** limpa só as notas/clipes MIDI, com Undo. **Center C3** volta à região de captura sem mudar a posição horizontal. New volta também ao compasso 1.
5. **Save project** exporta composição, contexto, tomada e fontes. **Open project** pede confirmação antes de substituir trabalho válido. Mixer/clipes, automação, áudio e exportações/recuperações ficam nas seções abaixo do roll.

[Pesquisa, auditoria e validação da reforma](studio-seq-ux.md).

## Gravar e compor

1. Escolher timbre em TONES e tocar normalmente. Em Studio, Record take captura a saída estéreo e os eventos. Stop recording encerra sem panic: espere a cauda antes de parar se quiser incluí-la.
2. Listen to take reproduz a referência gravada. Export WAV, Export MP3 e Save project salvam localmente. O encoder MP3 mostra progresso e pode ser cancelado sem parar o synth.
3. Em SEQ, Use take input notes converte a entrada MIDI externa; comandos de teclado virtual e notas geradas internamente não são transcritos. Ou criar notas no piano roll. A lista permite selecionar e editar pitch, parte, velocity, início e duração.
4. Partes A–D são as quatro partes reais do instrumento. Mover/duplicar clipes e fazer overdub compõe camadas dentro dessas partes; não cria synths adicionais. Mute/solo da sequência controla suas notas. Nível/pan usam o mixer real e também afetam a execução ao vivo da parte.
5. Play usa os timbres vivos atuais. Loop, BPM, métrica e metrônomo pertencem ao Studio. Parar Legacy antes de iniciar Studio. Abrir projeto não muda sons automaticamente: Apply saved tones/mixer é explícito, substitui RAM após aviso e não escreve slots. TONES Save/Save as mantém sua semântica original.
6. Em Automation, escolher alvo e adicionar lane/pontos. Use take applied controls importa mudanças de valor realmente observadas após mapeamento/pickup. Valores e limites são nativos; pitch/modulação mantêm o alcance compartilhado do motor. Stop deixa o último valor aplicado.
7. Em Audio clips, importar WAV PCM16 mono/estéreo em 44,1 kHz, ou Use recorded take audio. Selecionar a região, ajustar início, offset, duração, ganho, balanço e mute; Apply audio clip edit confirma. A fonte permanece intacta. Há quatro fontes/120 s e 32 regiões, com orçamento de 240 s somados. MIDI sem áudio suporta até 20 minutos.
8. Record arrangement grava uma passagem mais Tail seconds (0–30 s). Inclui clipes, synth e o que tocar ao vivo; metrônomo/mute de escuta ficam fora. Depois exportar o resultado em Studio. SMF exporta MIDI e não carrega áudio nem todas as curvas nativas de parâmetros.

Save project exportam `.wsproj`; v2 inclui fontes de áudio e aceita v1 ao abrir. Save browser composition guarda uma cópia explícita neste navegador. Recover browser composition restaura essa cópia; Recover local take busca a última gravação progressiva, inclusive interrompida. Isso não é autosave contínuo de todas as edições. Guardar arquivo portátil antes de limpar o navegador/mudar origem.

## Avaliação musical física pendente

Os testes automatizados usam WASM e AudioWorklet reais, com MIDI simulado. Antes de integrar, avaliar com SMK-37 Pro e a saída de áudio que será usada:

- Tocar enquanto grava, trocar telas e operar knobs/faders; conferir pickup, ausência de notas presas, estalos e alterações involuntárias de timbre/mapeamento.
- Comparar referência WAV com a execução, inclusive sustain, bend, trocas de parte e caudas. Ressíntese depende do contexto vivo, estado dos efeitos e controles compartilhados; não é prometida igualdade com a referência.
- Compor/editar/overdub nas quatro partes, ouvir loop e sobreposição de áudio/MIDI, exportar e reabrir projeto. Ajustar ganho se a soma saturar.
- Fazer uma gravação longa na máquina real, testar suspensão/interrupção e recuperação; registrar navegador, sistema, interface, taxa e resultado audível. Precisão por frames de software não mede latência acústica nem certifica ausência de underruns físicos.

## Verificações de software

As suites são `tests/studio-*.test.mjs` e `tests/browser-studio*.mjs`. Chrome precisa do setup Playwright documentado no repositório. Para a regressão da interface: `sh tests/build-ui-reference.sh`, `node tests/ui-foundation.test.mjs`, `node tests/browser-ui-foundation.mjs` e `node tests/browser-ui-foundation-v2.mjs`. Se alterar timbres/host, executar também suites de timbres, MIDI/pickup, DSP Monitor e 256 vozes conforme AGENTS.md. Evidências ficam em `.local/validation/studio-wave-*/`.

Fontes principais: `studio-format.js` (projetos), `studio-worker.js`/`studio-capture.js` (gravação), `studio-clock.js` (MIDI), `studio-automation.js` (alvos), `studio-audio.js`/Worker (PCM/regiões), `studio-mp3-worker.js` (encoder separado), `ui-studio*.js` (edição). Nada exige serviço externo. Fontes/licenças LAME são servidas com o aplicativo.
