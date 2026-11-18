# WASWAN DAW — Especificação funcional do MVP

**Versão:** Discovery 1.0 · 17/11/2026  
**Status:** requisitos aprovados; viabilidade e sequenciamento técnico sujeitos à Onda 0.  
**Fonte principal:** decisões de Discovery do WASWAN.  
**Projeto:** WASWAN Synth com workspace DAW integrado.  
**Navegador alvo:** Chrome Desktop; Ubuntu, Windows e macOS.

> **Princípio:** código para evoluir, não para impressionar; interface para fazer música, não para expor a implementação interna.

## 1. Objetivo e fronteiras

### 1.1 O que queremos

- Compor músicas simples e completas, gravando uma trilha por vez enquanto as demais tocam.
- Usar teclado MIDI com instrumentos tocáveis, gravar áudio de entradas compatíveis ou da saída interna do instrumento quando disponível e editar o resultado.
- Importar stems/arquivos WAV e MP3, arranjar, editar e mixar.
- Exportar música mixada, trechos selecionados, trilhas isoladas e MIDI; possibilitar material **autoral para o Suno**.
- Ter uma DAW com experiência profissional, coerente, previsível, responsiva e recuperável, em notebook, monitor 1080p, ultra-wide ou múltiplos monitores.
- Incorporar a DAW **ao mesmo WASWAN**, sem acoplá-la à interface visual Legacy do SMKSYNTH.

### 1.2 O que não queremos neste MVP

- Outra aplicação/produto independente, outro repositório ou outro synth obrigatório.
- Visual Legacy como base da nova interface, teclado virtual sempre ocupando rodapé ou controles de oitava inoperantes.
- Session View, gravação simultânea de banda, comping de múltiplas tomadas, Punch In/Out obrigatório, time-stretch, roteamento arbitrário, buses/grupos de trilhas, edição de partitura, professor musical ou uma LLM atuando no loop de áudio.
- Padrões enterprise, múltiplas camadas sem valor, dependências desnecessárias, compatibilidade multi-browser/mobile ou promessa prematura de performance ilimitada.

### 1.3 Diretrizes de produto e UX

1. **Arrangement-first:** a timeline é o eixo central; nunca exigir que o músico compreenda o sequenciador Legacy para compor.
2. **Drill-down:** primeiro o essencial; detalhes quando solicitados.
3. **Interação direta:** mouse e teclado para editar; campos numéricos como complemento.
4. **Feedback claro:** tudo que pode ser arrastado, cortado, duplicado, armado, recolhido ou destacado deve ter affordance/tooltip/estado explícito.
5. **Não destrutivo e reversível:** clipes editados referenciam originais intactos; Undo/Redo cobre mudanças críticas.
6. **Músico no controle:** não quantizar automaticamente nem apagar nuances de performance.
7. **Pensar em múltiplas telas:** painel recolhível/redimensionável e janela destacável por botão, sem assumir ultra-wide.
8. **Evoluir sem quebrar:** reconhecer a base existente, medir regressões, preservar dados e capacidade de diagnóstico.

## 2. Modelo conceitual do sistema

### 2.1 Termos

- **Projeto:** composição editável, timeline, trilhas, clipes, MIDI, áudio, instrumentos, FX, mixagem e automação.
- **Trilha tipada:** `Audio Track` ou `MIDI Track`. **Tipo técnico** não é a identidade musical: uma trilha `Guitarra` pode ser áudio ou MIDI.
- **Instrumento:** processador tocável associado à trilha MIDI; poderá usar o WASWAN Synth hoje e outros motores no futuro.
- **Clipe:** instância de conteúdo numa região da timeline; clipes de áudio referenciam fontes; clipes MIDI contêm eventos editáveis.
- **Master:** saída estéreo final que recebe as trilhas, passa por FX próprios e gera exportações.
- **Painel:** superfície de UI (Arrangement, Browser, Piano Roll, Mixer, FX etc.), acoplada ou destacada.
- **Contexto MIDI:** conjunto de funções para as quais controles físicos são atribuídos (Performance, Mixer, Instrumento/Envelope etc.).

### 2.2 Contextos de aplicação

- O produto oferece **Synth** (tocar e desenhar timbres) e **DAW** (compor, gravar, editar, mixar).
- Um botão **DAW** no Synth pode abrir o workspace em **nova aba**. A DAW também deve ter URL própria e ser acessível diretamente.
- Os workspaces **compartilham a mesma sessão musical**; não devem inicializar por engano instrumentos concorrentes ou projetos divergentes.
- É desejável navegar entre workspaces na mesma aba. Uma sessão de áudio tem **um único dono lógico**; a tecnologia específica do host/processo é **decisão de engenharia da Onda 0**.
- Não confundir janelas com processos do Chrome: comunicação e posse de áudio devem funcionar independentemente da distribuição de processos.
- A continuidade do áudio ao fechar a janela que o hospeda exige desenho cuidadoso; **não declarar resolvido sem prova**.

## 3. UX do workspace

### 3.1 Hierarquia e layout

- **Topo persistente:** projeto/arquivo, Undo/Redo, transporte, posição, BPM, fórmula, loop, metrônomo e ações essenciais.
- **Centro prioritário:** Arrangement (trilhas e clipes), régua e playhead.
- **Painel lateral opcional:** instrumentos/presets/recursos, recolhível.
- **Painel inferior:** alterna editor de clipe/Piano Roll, automação, Mixer, FX da trilha. A princípio, **não exibir todos ao mesmo tempo**.
- **Master** visível no Mixer.
- **Sem teclado virtual permanente**; quando útil, acessível sob demanda sem ocupar sistematicamente espaço.

### 3.2 Painéis adaptativos (DEC-047)

Cada painel compatível suporta, quando fizer sentido:

- **Recolher:** não mostrar conteúdo; manter uma aba ou ícone reconhecível.
- **Redimensionar:** divisórias arrastáveis, com largura/altura mínima; duplo clique na divisória restaura tamanho padrão.
- **Expandir/maximizar:** ocupar a área de trabalho disponível e permitir voltar.
- **Destacar:** botão explícito abre nova janela/aba Chrome; usuário a move ao outro monitor. **Não exigir drag de painel para fora da janela**.
- **Reintegrar/recuperar:** retorno ao layout, ou reabertura pelo menu `Exibir → Painéis`.
- **Reset Layout:** volta à disposição padrão sem tocar na música, nos timbres ou nos FX.
- **Persistência local de layout:** tamanho, visibilidade e disposição por computador/perfil Chrome, sem impor layout de outro monitor/computador.

**Adaptação:** em notebook, Arrangement grande e painéis recolhidos; em 1080p, Arrangement + um editor inferior; em ultra-wide, mais espaço e eventual composição lado a lado; em múltiplos monitores, painéis destacados. Não fixar breakpoints arbitrários antes de testes de usabilidade.

### 3.3 Navegação e zoom — requisito crítico (DEC-008/009)

- **Scrollbars visíveis e utilizáveis:** vertical de trilhas, horizontal de timeline; independente no Piano Roll.
- **Zoom horizontal** no Arrangement e editor de áudio; **horizontal e vertical** no Piano Roll.
- **Zoom centrado na posição do ponteiro** (quando aplicável) e opções `+`, `−`, **Fit to content** (enquadrar).
- Gestos consistentes, com pistas visuais nos botões/cursores; sem dependência exclusiva de `Ctrl + roda`.
- O rolar e o zoom de um painel não devem mover involuntariamente outro.
- Valores de posição, duração e escalas devem permanecer legíveis nos extremos de zoom.
- Estado/foco claros para que atalhos não acionem comandos de outra região.

### 3.4 Biblioteca de ícones de trilha (DEC-010)

- Trilha possui **nome, ícone, cor e tipo técnico**.
- Biblioteca inicial sugerida: bateria, baixo, guitarra, violão, piano, teclado/synth, órgão, voz, backing vocal, cordas, percussão, FX, microfone e papéis genéricos.
- Iconografia é **personalizável**; ícone e cor não substituem texto nem são únicos meios de distinguir trilhas.
- Uma trilha MIDI de `Guitarra` e uma trilha de áudio de `Guitarra` são possíveis e não geram tipos técnicos diferentes.

## 4. Transporte, tempo e navegação musical

### 4.1 Transporte único (DEC-002/003)

- **Play**, **Stop**, **Record**, **Loop** e **playhead** globais para a DAW.
- BPM ajustável e fórmula de compasso.
- Régua alternável entre **compassos/tempos/pulsos** e **minutos/segundos**, sem mudar a posição real do material.
- Clique na régua posiciona playhead; seleção de intervalo serve a loop, edição e exportação.
- Impedir conflito com relógios/transportes Legacy paralelos; comportamento e migração serão avaliados na Onda 0.
- Mudar tempo **não estica automaticamente áudio importado** (seção 6.5).

### 4.2 Metrônomo (DEC-040)

- Ativar/desativar click.
- **Count-in** de 1, 2 ou 4 compassos antes da gravação.
- Volume independente.
- Acentuação do tempo forte conforme métrica.
- **Não incluir** click na gravação de áudio ou em exportações.

### 4.3 Marcadores (DEC-035)

- Marcadores editáveis na região superior do Arrangement, com nome e posição: `Intro`, `Verso`, `Refrão`, `Solo`, `Final` ou livres.
- Criar, renomear, mover e remover; persistem no projeto.

## 5. Trilhas e instrumentos

### 5.1 Trilhas tipadas (DEC-001)

**Audio Track**
- Fonte: arquivo importado ou entrada de áudio (dispositivo compatível); avaliar também captura interna da saída de instrumento para uma trilha de áudio.
- Clipes com waveform; gain por clipe, FX de trilha e mixer independentes.

**MIDI Track**
- Clipes de notas/eventos MIDI; um slot de instrumento tocável por trilha.
- Ao **selecionar** a trilha, o controlador pode tocar o instrumento conforme **Monitor**; **Arm** é necessário só para gravar.
- Parâmetros, estado, timbre e FX próprios da trilha; a persistência deve conservar o resultado.
- Evitar impor o limite conceitual de 4 partes do SMKSYNTH à DAW; **não assumir** que o motor atual consegue executar 10 instrumentos independentes sem adaptação. Auditar e propor evolução.

### 5.2 Cabeçalho compacto por trilha (DEC-007/044)

- Nome, ícone, cor, seleção e tipo; medidor de nível.
- Controles essenciais: Volume, Pan, Mute, Solo, Arm e acesso a Monitor/FX.
- Ajustes profundos ficam no Mixer/Instrumento.
- Criar, renomear, reordenar por arrasto, duplicar (instrumento/FX/mixer, com opção de clipes), excluir e alterar altura/recolher.
- Exclusão/duplicação/reordenação com feedback e Undo/Redo quando aplicável.

### 5.3 Perfis MIDI de controlador (DEC-027/028/029)

- Armazenamento **local no Chrome por computador** (IndexedDB ou mecanismo tecnicamente equivalente, sujeito à auditoria). Não sincronizar em nuvem.
- Ao conectar um teclado conhecido, **detectar e carregar automaticamente** o perfil apropriado para o dispositivo e contexto ativo.
- Perfis para cada controlador: SMK-37 Pro, Casio XW-P1, CT-S1000V, Arturia MiniLab 3 etc., **após teste real**, sem presumir capabilities de cada um.
- MIDI Learn para atribuir controls compatíveis; aceitar teclados com quantidades distintas de knobs/faders/pads.
- Contextos reutilizáveis (`Performance`, `Mixer`, `Instrumento`, `Envelope`, `Transporte`...), não exigir atribuição de todo controle em todo contexto.
- **Pickup/soft takeover:** evitar saltos de parâmetros ao mudar parte, timbre, trilha ou contexto.
- Identificação resiliente por `manufacturer`, `name`, `id` de porta quando disponível; se ambíguo ou alterado, permitir associação manual; não confiar exclusivamente em ID instável.
- **Clonar perfil** de outro teclado, ajustando diferenças.
- Perfis são configurações locais do ambiente, **não** conteúdo obrigatório do `.wsproj`.
- Biblioteca futura de perfis pré-definidos pelo projeto somente após validação com hardware real (roadmap).

### 5.4 Presets (DEC-046)

- **Preset de instrumento:** timbre + parâmetros do motor.
- **Preset de trilha:** instrumento + cadeia FX + mixer/configurações pertinentes, sem exigir clipes.
- **Projeto:** contém estado completo necessário para reabrir a composição.
- Presets independentes de **cadeia FX**, como biblioteca reutilizável, estão no roadmap.

## 6. Arrangement, clipes e áudio

### 6.1 Operações sobre clipes (DEC-004/005/034/043)

- Criar, selecionar, mover, copiar/colar, duplicar, excluir e dividir (`Split`).
- `Trim`: encolher/expandir borda sem apagar o conteúdo original; para áudio, preservar a fonte.
- **Undo/Redo** para essas operações e mudanças críticas; histórico consistente.
- **Snap** ao grid, desligável; handles, cursores e feedback visual de operação e duração.
- **Ripple editing DESLIGADO por padrão**; cortar, encurtar ou excluir não desloca automaticamente clipes seguintes. Ripple opcional poderá ser adiado se a Onda 0 recomendar — não ativar implicitamente.
- **Selecionar múltiplos clipes:** Ctrl+clique, Shift+clique, seleção por retângulo em área vazia; mover/copiar/excluir como uma única transação de Undo.
- Redimensionamento de clipe, alteração de comprimento e extensão de loop devem ter **gestos distintos e reconhecíveis**.

### 6.2 Loop de clipe

- Estender a borda/alça de loop para repetir conteúdo do clipe MIDI.
- Exibir divisões entre repetições e indicador (`Loop × 3`, por exemplo).
- `Duplicate` gera cópia independente que pode ser editada sem alterar a original.
- `Consolidate` transforma repetições em um clipe editável único.
- **Loop de clipe ≠ Loop do transporte**. Distinção explícita na interface.

### 6.3 Edição de áudio por clipe (DEC-006)

- Waveform visível, inclusive após abrir arquivo/projeto (picos podem ser reconstruídos ou cacheados).
- **Clip Gain** separado de **Track Volume**; valores/marcadores legíveis.
- Fade-in, fade-out e crossfade sobre regiões sobrepostas.
- Edição não destrutiva (referências e offsets; não alterar a fonte original).
- Evitar clipping na soma; o usuário deve conseguir ajustar antes do Master.

### 6.4 Ancoragem temporal (DEC-004)

- Por clipe, permitir posição ancorada em **tempo musical** (compassos/tempos) ou **tempo absoluto** (segundos).
- O comportamento ao alterar BPM deve ser previsível e expresso visualmente.
- Mudar BPM não modifica a duração nem a afinação do **áudio fonte**.
- Preservar referência de origem para edição posterior; auditoria deve definir a representação interna robusta (ticks + tempo absoluto, com conversão explícita).

### 6.5 Importação (DEC-018/045)

- **WAV e MP3** por seletor de arquivos do Chrome (obrigatório).
- **Arrastar do Explorer/Finder/Nautilus** para a trilha/timeline (desejável no MVP se impacto pequeno, sem sacrificar funcionalidades obrigatórias).
- Converter/decodificar internamente para o formato de processamento, sem obrigar conversão manual PCM16/44,1 kHz como na versão atual.
- Importar MIDI padrão `.mid` (SMF) por seletor, preservando notas, alturas, início, duração, velocity e estrutura disponível por canais/trilhas; associar instrumentos após importação.
- Posicionar o clipe na timeline de forma explícita; fornecer progresso e mensagens de erro úteis.

## 7. Piano Roll e edição MIDI

### 7.1 Edição direta (DEC-030)

- Desenhar nota, selecionar uma/múltiplas, mover, redimensionar duração, copiar/colar, excluir.
- Teclas laterais do piano fazem **audition** (pré-escuta) com o instrumento da trilha.
- Faixa inferior **recolhível** de velocity; edição visual das barras; inspector pequeno para valores exatos (pitch, início, duração, velocity).
- Scroll e zoom horizontal/vertical independentes do Arrangement; `Fit to content`.
- Operações em grupo preservam intervalos e deslocamentos relativos, salvo limites explícitos.

### 7.2 Atalhos de notas (DEC-031/032)

| Atalho em foco no Piano Roll | Ação |
|---|---|
| ← / → | deslocar notas selecionadas pela divisão do grid |
| ↑ / ↓ | transpor notas selecionadas por semitom |
| Shift + ↑ / ↓ | transpor por oitava |
| Shift + ← / → | reduzir/aumentar duração por passo do grid |
| Alt + ↑ / ↓ | alterar velocity em ±1 |
| Alt + Shift + ↑ / ↓ | alterar velocity em ±10 |
| Delete/Backspace | remover seleção |
| Ctrl/Cmd + Z / Ctrl/Cmd + Shift + Z | Undo / Redo |

- Aplicar a um conjunto selecionado; ao aumentar velocity, **preservar diferenças relativas** quando possível, saturando apenas no limite MIDI 1–127.
- Modificador de deslocamento fino pode ser proposto na Onda 0, sem conflitar com atalhos globais.
- Atalhos só agem quando o editor está em foco; **não** capturar setas em campos de texto, sliders ou outros contextos.

### 7.3 Grid, Snap e quantização (DEC-033)

- Grid configurável (1/4, 1/8, 1/16, 1/32 e divisões pertinentes).
- Snap ativável/desativável, independente do comando de quantizar.
- Quantização **manual** de notas selecionadas; **intensidade 0–100%**; reversível com Undo.
- **Não quantizar na captura** por padrão; preservar a interpretação tocada.
- Não usar correção rítmica como desculpa para eliminar diferenças naturais de tempo/velocity.

## 8. Gravação e monitoração

### 8.1 Modelo de trabalho (DEC-013/014/015/016/017)

- **Gravação sequencial de uma trilha por vez.** As outras reproduzem como acompanhamento (*overdub* no sentido do processo de composição em camadas).
- **Um botão Record** no transporte, comportamento determinado pela trilha armada e seu tipo.
- Selecionar trilha para tocar **não** exige Arm; Arm habilita gravação.
- Regravar **substitui** a tomada/trecho de destino; a versão anterior pode ser restaurada por **Undo**. Não implementar gerenciador de takes/comping.
- Histórico deve preservar áudio/arquivos necessários à operação de Undo, e não apenas a representação gráfica.
- Punch In/Out automático: **roadmap**; no MVP pode-se recortar/substituir manualmente um trecho.
- A gravação não deve capturar como notas novas o playback das outras trilhas.

### 8.2 Entradas e monitor (DEC-013)

- **Input:** escolher fonte compatível com o tipo de trilha: MIDI externo para notas; áudio da interface/microfone para Audio Track; avaliar rota interna de gravação de instrumento para áudio.
- **Monitor `In`:** ouvir continuamente a entrada.
- **Monitor `Auto`:** monitorar entrada conforme Arm/Record e reprodução, com regra consistente e visível ao usuário.
- **Monitor `Off`:** desliga monitoração da entrada, **não** a reprodução dos clipes existentes.
- Evitar eco/dupla monitoração desnecessária; documentar limitações do navegador e da interface de áudio.
- Count-in funciona em gravações MIDI e áudio, sem vazar click para o arquivo gerado.

### 8.3 Latência (DEC-041)

- Preservar tempos capturados antes de qualquer quantização.
- Compensação de latência **manual** em milissegundos, separada para MIDI e áudio, com persistência local por dispositivo quando identificável.
- Instrumentar e testar precisão da posição gravada vs. referência.
- Calibração automática fica no roadmap.

## 9. Mixer, efeitos e Master

### 9.1 Mixer (DEC-007/038/039)

- Controles compactos de Volume, Pan, Mute, Solo e medidor no cabeçalho; **Mixer dedicado** com faders verticais, medição e FX.
- Mixer como painel inferior redimensionável, recolhível e **destacável por botão** para outra janela Chrome.
- Alterações do Mixer impactam imediatamente o projeto/Arrangement, sem duplicar estados.
- **Roteamento MVP:** fonte/instrumento → FX da trilha → Volume/Pan → Master → saída.
- Sem buses arbitrários, sends auxiliares por usuário ou grupos no MVP.

### 9.2 Efeitos por trilha (DEC-020/037)

- Cadeia de FX por trilha: adicionar, remover, **reordenar**, bypass por efeito, editar parâmetros por drill-down e persistir.
- **MVP obrigatório:** EQ (equalizador), Compressor, Reverb, Delay, Chorus, Limiter e Overdrive/Saturation.
- **Phaser e Tremolo:** desejáveis **somente** se reaproveitamento/implementação tiver custo baixo; caso contrário roadmap, sem bloquear MVP.
- Rotary/Leslie, amp/cab sim, flanger, biblioteca de presets de FX: roadmap.
- Reaproveitar FX DSP existentes quando possível; **efeitos atuais compartilhados do Legacy não equivalem automaticamente a cadeias independentes por trilha**.

### 9.3 Master (DEC-021)

- Master com volume, medidores estéreo L/R, indicador de clipping e cadeia própria de efeitos.
- Limiter opcional na Master; indicar claramente quando está ativo.
- Distinguir **Clip Gain → FX da trilha → Track Volume/Pan → Master**; reduzir fader depois de clipping prévio não restaura áudio danificado.
- Medidores/nomes corretos; não confundir peak dBFS com loudness LUFS.

## 10. Automação (DEC-022/023)

- Curvas **desenhadas** (não gravadas de knobs) para Volume e Pan por trilha, editáveis na timeline.
- Criar/mover/remover pontos; exibir/ocultar a lane por contexto; Undo/Redo.
- Reprodução e Stop com comportamento determinístico dos valores vivos; indicar quando automação está ativa.
- Gravação de movimentos MIDI de knobs/faders e automação livre de FX: **roadmap**.

## 11. Importação, exportação e integração com Suno

### 11.1 Exportação (DEC-019)

- **Música completa mixada:** WAV e MP3.
- **Intervalo selecionado:** WAV e MP3.
- **Uma trilha isolada:** WAV e MP3.
- **Todas as trilhas isoladas / stems:** WAV (com nomes identificáveis, duração/alinhamento consistente).
- **Clipes ou composição MIDI:** arquivo `.mid` quando aplicável.
- Ação **Exportar seleção** acessível perto do clipe/seleção, sem exigir exportar música inteira.
- Áudio exportado não deve conter click do metrônomo; efeitos/caudas precisam de comportamento documentado.
- Definir se stems são pré ou pós-FX/mixer e manter comportamento legível e consistente (propor na auditoria, não inventar silenciosamente).

### 11.2 Objetivo musical

O fluxo deve permitir gravar oito compassos de piano, uma melodia ou um solo, mixar ou isolar, exportar e usar o arquivo como material autoral no Suno. Não implementar integração `Send to Suno` via API no MVP.

## 12. Salvamento e recuperação (DEC-025/026)

- **New / Open / Save / Save As** com experiência de arquivo local no Chrome Desktop, usando **File System Access API** ou solução equivalente comprovada no alvo.
- Projeto portátil `.wsproj` (revisar schema e versionamento); salvar e reabrir trilhas, clipes, MIDI, fontes de áudio, FX, timbres, mixagem, marcadores, automações e contexto necessário.
- **Autosave local** em armazenamento do Chrome (OPFS/IndexedDB ou equivalente), separado de `Save` explícito no arquivo do usuário.
- Identificador claro de projeto alterado (`unsaved/dirty`); prevenir descarte silencioso ao abrir novo projeto/recarregar.
- Estruturar escrita e recuperação de forma resiliente a falha, quota, permissão revogada e fechamento inesperado. Não prometer atomicidade sem validar a API.
- Dados críticos (presets e projetos) não devem depender de uma única cópia invisível no navegador.
- **Perfil MIDI e layout são locais do computador**, não sincronizados pelo arquivo de projeto; projeto musical deve continuar abrível com outro controlador.
- Chrome Desktop apenas; não construir fallback para Firefox/Safari/mobile. **Ainda considerar falhas dentro do próprio Chrome** (API/permissão/armazenamento).

## 13. Atalhos e acessibilidade operacional (DEC-042)

| Atalho global (fora de campos editáveis) | Ação |
|---|---|
| Espaço | Play/Stop |
| Ctrl/Cmd + S | Save |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z | Redo |
| Delete | excluir seleção |
| L | alternar Loop |
| M | alternar metrônomo |
| ? | abrir ajuda de atalhos |

- Respeitar foco de inputs, MIDI virtual/teclado de computador e editores; teclas não podem disparar operações musicais inesperadas.
- Estados visualmente distinguíveis sem depender só de cor; tooltips e nomes de comandos consistentes.
- Manter feedback claro de ações destrutivas, seleção, edição, Arm/Monitor, Clip Loop, transporte e salvamento.

## 14. Arquitetura e engenharia: requisitos de qualidade, não receita

### 14.1 Princípio agent-friendly (DEC-049/050)

- **Codex atual deixa pistas para o Codex futuro.** Módulos coesos, contratos simples, pontos de entrada encontráveis, boa separação de comando/estado/visualização e do caminho crítico DSP.
- O repositório **já tem `AGENTS.md`**; ler e atualizar pontualmente se necessário, **sem reescrever ou duplicar desnecessariamente**.
- Evitar frameworks, camadas, serviços, padrões enterprise e abstrações especulativas sem ganho demonstrável.
- Preferir performance e código direto compreensível ao invés de pureza formal.
- Registrar **decisões que mudam a arquitetura**, trade-offs, comandos de build/teste e limitações; documentação curta e viva.
- Exigir testes de regressão em transporte, tempo, gravação, edição, arquivo e áudio; cobertura guiada por risco.
- Não confiar em números de polifonia como sinônimo de desempenho; medir callbacks de áudio, p95/p99, pico, memória, under/overruns quando observáveis.
- **Não gerar logs/IO pesado no callback de áudio**; observar por buffers/telemetria fora do caminho real-time.
- Logs estruturados e contextuais, úteis para diagnóstico de erros, não um fluxo de spam. Preservar o que já funciona de DIAG/DSP Monitor.

### 14.2 Preparação leve para IA / MCP (DEC-051)

- Operações musicais (`createTrack`, `setInstrument`, `insertNote`, `setParameter`, `exportSelection` etc.) devem ser **invocáveis por comandos de domínio testáveis**, e não exclusivamente por listeners de botões.
- Estado consultável de projeto, transporte, trilhas, instrumentos e seleção.
- Contratos de comando, resultados e erros claros; Undo como transação quando aplicável.
- **Não** implementar servidor MCP nem LLM interna no MVP; apenas evitar aprisionar a lógica à camada de UI.
- Um agente futuro deverá pedir confirmação para operações destrutivas e nunca executar inferência no callback de áudio.

## 15. Jornadas de aceitação (end-to-end)

**J1 — Compor uma música simples**  
Criar projeto → adicionar Piano MIDI → tocar via controlador sem Arm → armar e gravar acordes com count-in → adicionar Baixo MIDI e gravar ouvindo Piano → editar velocity e quantizar parcialmente → adicionar bateria/terceira trilha → usar Mixer/FX → Save → reabrir → exportar WAV. Validar áudio, tempo, timbres e posição de notas após reabertura.

**J2 — Trabalhar com Suno**  
Criar Audio Track → importar WAV/MP3 pela caixa de diálogo → visualizar waveform → cortar, encurtar, ajustar Clip Gain, fade/crossfade → gravar uma trilha MIDI acompanhando a faixa → selecionar oito compassos → exportar seleção, trilha isolada e mixagem. Confirmar que não há click no arquivo e que o áudio fonte não foi alterado.

**J3 — Controlador por contexto**  
Conectar SMK-37 Pro → carregar assignments locais → editar cutoff do instrumento em Performance → alternar para Mixer e verificar nova função dos mesmos knobs e pickup → trocar para outro controlador (quando disponível) e recuperar outro perfil → reiniciar Chrome e verificar autoload. Não perder projeto por trocar dispositivo.

**J4 — Layout e múltiplas telas**  
Em notebook: recolher Browser, expandir Arrangement, abrir Piano Roll → ajustar divisor e scroll/zoom → destacar Mixer por botão → mover nova janela para outro monitor → alterar volume e confirmar sincronização → fechar painel destacado, restaurar pelo menu `Exibir → Painéis` → `Reset Layout`. Música e áudio não podem ser alterados pelo reset.

**J5 — Gravação e Undo**  
Armar uma trilha e gravar ouvindo acompanhamento → substituir trecho → Undo restaura tomada anterior **inclusive bytes de áudio** → Redo reaplica. Testar interrupção/recuperação, discrepância de latência e Monitor In/Auto/Off.

**J6 — Importação MIDI e edição**  
Importar `.mid` → conferir notas/duração/velocity → atribuir instrumento → mover notas por teclado, alterar velocity por atalho, quantizar com 50% → criar loop de clipe com feedback visual → Undo/Redo → exportar MIDI e reabrir.

**J7 — Qualidade e integridade**  
Repetir as jornadas com vários clipes, FX e instrumentos, usando diagnósticos existentes; medir áudio sem bloqueios perceptíveis; verificar logs úteis e dados salvos. Nenhuma etapa deve exigir interface Legacy ou conhecimento de estrutura interna do motor.

## 16. Critérios de aceite transversais

1. É possível completar **J1 a J7** no Chrome Desktop, com as restrições de hardware documentadas.
2. As ações têm consequências previsíveis e controles visíveis, sem telas vazias decorativas, zoom ausente ou teclado virtual ocupando área de produção.
3. Os projetos salvam, reabrem e recuperam dados necessários; Undo/Redo não é apenas cosmético.
4. O áudio permanece estável durante edição, transporte e troca de telas; métricas permitem atribuir problemas a componentes reais.
5. A DAW não roda dois motores concorrentes quando Synth e DAW são abertos em abas distintas; tal requisito precisa ser validado em demonstração.
6. Problemas, riscos e funcionalidades não implementadas devem ser **assumidos explicitamente**. Não simular implementações.
7. O roadmap permanece fora do MVP até decisão posterior.

## 17. Decisões e atualizações de escopo

Resumo do histórico. Consulte os capítulos anteriores para texto normativo e `ROADMAP.md` para adiamentos.

| DEC | Tema e situação |
|---|---|
| 001 | Trilhas tipadas Audio/MIDI — MVP |
| 002 | Arrangement único como fluxo principal — MVP |
| 003 | Timeline musical e cronológica — MVP |
| 004 | Operações de clipes e ancoragem — MVP |
| 005 | Edição não destrutiva; sem Ripple padrão — MVP; Ripple opcional |
| 006 | Waveform, gain, fades e crossfade — MVP |
| 007 | Mixer básico por trilha — MVP |
| 008 | Navegação, zoom e scroll por contexto — MVP |
| 009 | Arrangement + editor inferior redimensionável — MVP |
| 010 | Biblioteca de ícones/cor/nome — MVP |
| 011–012 | Sampler discutido; **escopo atualizado: Sampler pleno após estabilização**, roadmap |
| 013 | Monitor In/Auto/Off — MVP |
| 014–015 | Gravar uma trilha por vez, outras tocam — MVP |
| 016 | Substituição de tomada com Undo — MVP |
| 017 | Punch In/Out — roadmap |
| 018 | WAV/MP3 via diálogo; drag-and-drop se simples — MVP/desejável |
| 019 | Exportação mix, seleção, stems e MIDI — MVP |
| 020 | Cadeia de FX por trilha — MVP |
| 021 | Master com medição/FX — MVP |
| 022–023 | Automação desenhada de Volume/Pan — MVP; captura física roadmap |
| 024 | Grupos de trilhas — roadmap |
| 025–026 | Save/Open arquivos locais, autosave; Chrome Desktop alvo exclusivo — MVP |
| 027–029 | Perfis MIDI locais/contextuais/clonáveis — MVP; presets de fábrica roadmap |
| 030–032 | Piano Roll; atalhos de notas/velocity — MVP |
| 033 | Grid/Snap/quantização parcial manual — MVP |
| 034 | Loop de clipe com clues — MVP |
| 035 | Marcadores musicais — MVP |
| 036 | Sem time-stretch automático — roadmap |
| 037 | FX base + Overdrive — MVP; Phaser/Tremolo condicionais; outros roadmap |
| 038 | Mixer inferior/destacável — MVP |
| 039 | Roteamento direto ao Master — MVP |
| 040 | Metrônomo e count-in — MVP |
| 041 | Latência manual por entrada — MVP |
| 042 | Atalhos e ajuda contextual — MVP |
| 043 | Seleção múltipla no Arrangement — MVP |
| 044 | Gerenciamento e dimensão das trilhas — MVP |
| 045 | Importar `.mid` — MVP |
| 046 | Presets instrumento/trilha — MVP; FX presets roadmap |
| 047 | Painéis redimensionáveis/destacáveis; Reset Layout — MVP |
| 048 | Synth/DAW workspaces do mesmo produto — MVP |
| 049–050 | Qualidade de engenharia pragmática/agent-friendly — requisito transversal |
| 051 | Preparar comandos/estado para integração MCP/LLM futura — requisito arquitetural leve |

**Atenção:** qualquer limitação técnica identificada pela Onda 0 deve aparecer como **risco, alternativa e proposta de faseamento**, não como descarte silencioso de um requisito aprovado.
