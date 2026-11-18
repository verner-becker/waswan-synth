# DAW — fase 3: instrumentos e primeira fatia musical

Branch `feat/daw-wave-3-instruments`, pai `29efef6`. Estado: concluída como fatia instrumental e playback básico.

Gate inicial: provar mais de quatro instrumentos simultâneos em uma instância, sem alterar pool256, limite SUPER5 ou32 hits DRUM-X. Só depois conectar a primeira UI musical e o roundtrip ao motor.

## Desenho da prova runtime

Assessment Sol6.1 xhigh: ampliar slots de execução para8, manter `NTRK=4` e formatos Legacy. Extras4–7 aceitam ANALOG (incluindo capacidades SUPER existentes), com saída somente pelo tap seco; slots0–3 mantêm suporte DRUM-X/presets/Legacy e saída original. Oito é carga/limite inicial de execução, não teto conceitual de trilhas.

Guardas necessárias na cópia derivada: ledger MIDI e timers DRUM continuam4; arrays/rotinas DRUM continuam4; seq_engine_reset/seq_q8_now rejeitam extras; swap mixer e reset de expressão Legacy só alcançam4. APIs `waswan_studio_*` e contexto/presets existentes permanecem4. Extras precisam de ponteiros `pt`, inicialização própria, ativação explícita e RNG separado; não consumir RNG Legacy quando inativos. Não alimentar arp/transposição/saída MIDI Legacy por notas DAW. Taps e worklet devem consultar capacidade runtime.

Critérios: seis timbres simultâneos, patch/expressão de um isolados dos demais, pedal/note-off/Stop com posse própria, patch inválido rejeitado integralmente, saturação do pool sem OOB, referências Legacy iguais com extras inativos e regressões de etapas de voz pertinentes. A navegação continua só apresentação. Se não houver causa isolável para regressão, preservar prova e parar a dependência instrumental.

Após o gate: primeira superfície DAW integrada ao mesmo app, grafo/mix mínimo, reprodução pelo relógio de áudio e Save → fechar → reabrir → ouvir. Arrangement/editor completo fica nas fases seguintes. Não mostrar recursos inexistentes como implementados.

## Implementado

- `patches/daw-runtime.patch` aplicado somente à cópia de build256, depois da extensão de polifonia. As demais etapas e a referência de UI continuam com quatro partes. Uma instância WASM e o mesmo AudioContext; oito saídas secas de notas com posse DAW, além do estéreo original. O tap mantém alinhamento com o buffer interno256 e os quanta128.
- `seq_owned=3` separa notas e caudas DAW do caminho Legacy e Studio; DRUM-X usa os hits existentes. Stop cancela apenas notas próprias e restaura a última tecla física em MONO/UNISON conforme o firmware. Uma parte compartilhada continua sendo um único instrumento MONO/UNISON: duas origens na mesma parte não viram dois instrumentos independentes.
- Atribuição de trilhas por ID: ANALOG prefere slots4–7, depois0–3; DRUM-X usa0–3. Mais de oito instrumentos ou mais de quatro DRUM-X gera erro recuperável; 32 trilhas lógicas continuam possíveis. Nenhum aumento de256 vozes, SUPER5 ou32 hits.
- `DawPlayer` cria ganhos/pan por trilha, mute/solo ao vivo, Master e fontes de áudio agendadas, sem reiniciar o instrumento ao navegar. Relógio no worklet e gate de áudio compartilhado fecham também o áudio nativo quando Stop/fim ocorre, mesmo com UI atrasada. Dependência de ganho zero garante ordem host→bus em projetos só de áudio. Automação Volume/Pan já salva é reproduzida; edição completa segue no plano.
- Transporte DAW exclui execução/gravação Studio e Legacy. Guardas antecedem agendamento de fontes/click Studio, incluem audição de tomada e preparação assíncrona, e bloqueiam restauração de contexto durante DAW.
- UI mínima real na aba DAW: trilhas, presets, notas numéricas, clipes, mixagem e arquivo v3/Save As/recuperação com escolha de projeto. Teclado original oculto por padrão e disponível por ação explícita. Selecionar DAW não muda mappings nem libera notas. Undo coalesce gestos de volume/pan.
- Edições aceitas de timbre no Synth compartilhado são observadas pelo host e sincronizadas ao projeto; Save captura o estado aceito. Uma alteração offline ainda pendente (preset/Undo) não é substituída pelo snapshot antigo da ligação. Reboot invalida a ligação antes que os bytes do motor novo possam ser tomados por edições do projeto.
- Open/Recover valida primeiro e só assume o handle após troca bem-sucedida; o cache anterior é liberado após parar suas fontes e drenar autosave. Falha de limpeza anterior não invalida o projeto aberto.

## Evidência e correções de revisão

Evidências em `.local/validation/daw-mvp-wave-3/`; testes de baseline também escrevem nos diretórios históricos próprios. Build completo e build das referências de UI passaram. `check-upstream.sh` passou, submódulo e main preservados. Todas as **35 suites Node** passaram, incluindo as seis etapas de alocação, presets/tone editor, MIDI/profile/pickup, DSP, Studio e domínio DAW.

`daw-runtime.test.mjs`: seis timbres independentes audíveis; saída Legacy exatamente zero para notas DAW; áudio físico bit a bit igual com extras ativos e LFO aleatório; saturação/roubo de256 vozes entre oito slots; SUPER5; DRUM32; patch inválido sem aplicação parcial; Stop preserva nota física POLY e restaura MONO/UNISON4; hit físico DRUM em outra lane sobrevive. `daw-outputs` mantém provas de alinhamento e tap pré-mixer.

O assessment Sol6.1 xhigh identificou uma fila que poderia repetir para sempre a entrada inválida, restauração física MONO/UNISON, captura de timbre compartilhado, reboot e sobreposição Studio. Correções adotadas e verificadas pelo agente principal. A fila avança **antes** de descartar o evento; `daw-fault.c` permite injetar255 e slot inativo7 sem expor esse recurso em produção. Processo separado com timeout passa e a nota válida seguinte toca. Para reproduzir: build completo → `sh tests/build-daw-fault.sh` → `node tests/daw-fault.test.mjs`. Compilar antes de `build-ui-reference.sh`, que substitui a árvore preparada pela referência de quatro partes.

Chrome dirigido: três presets reais E-PIANO/FAT BASS/SYNC LEAD → Save → New → Open → Play; timbres/notas preservados e audíveis, um contexto/um motor, teclado oculto, navegação sem comandos, Stop/Open preservam nota física. Prova adicional com seis trilhas: edição aceita de cutoff na parte0 modifica somente a trilha correspondente no arquivo; Studio com clipe de áudio preparado rejeita Play antes de criar fontes; reboot seguido de Save conserva os seis patches.

Passaram também as 12 suites Chrome: UI Foundation v1/v2, Tone Editor/Selector, pickup, diagnóstico MIDI, Studio Sequence/Audio e DAW Session/Files/Instruments/Ownership. O primeiro diagnóstico MIDI falhou por servidor8738 ausente; iniciado o servidor específico, o teste passou sem mudança de código. As 35 suites Node e as regressões Chrome funcionais foram executadas após o build, sem compilador concorrente; não usar esses resultados para certificar latência física.

Duas verificações Chrome adicionais passaram: `browser-polyphony-256` e `browser-dsp-monitor`. Com256 vozes mantidas, o ensaio prolongado percorreu180,135 s de áudio/180 janelas, heap retido aproximadamente3,1–3,3 MB. O relógio disponível é `Date.now`, grosseiro: p99 de histograma2,025 ms, máximo4 ms e274 blocos classificados acima de2,902 ms entre62.065. Isso **não** mede underruns físicos. O benchmark mede CPU de todos os renderers (inclui UI), não DSP isolado; não deduzir melhoria pelos pequenos contrastes entre monitor desligado/ativo/capturando. Nenhum outro Chrome ou compilador concorria nesse ensaio.

## Limites e próximo passo

Isto fecha a fatia instrumental, não o MVP. A UI numérica é fundação temporária; Arrangement, gravação, importadores/editor completo, cadeias de FX/export e painéis destacados seguem nas próximas fases. Cadeias FX novas salvas são preservadas, mas Play informa que precisam da fase de efeitos; não são ignoradas silenciosamente. Migração v1/v2 avisa que FX/expressão Legacy ainda precisam de adaptação e força Save As para preservar o original.

Os testes de arquivos simulam a seleção de handles e usam OPFS real; não certificam interação do seletor nativo. Não houve teste físico de controlador/dispositivo de áudio, Windows/macOS ou certificação de latência/underruns. Não há promessa de dez instrumentos nem de execução ilimitada. A prova de mídia longa continua a da fase2, sem recertificação de carga com FX nesta fase.

Próximo passo: publicar esta branch e iniciar fase4 sobre seu SHA final: Arrangement central, régua/seek/intervalo, marcadores e painéis recolhíveis/redimensionáveis na mesma janela. Sem integração na main.
