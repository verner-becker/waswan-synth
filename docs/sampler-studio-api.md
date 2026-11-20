# WASWAN Sampler Studio · proposta de modelo e API

O guia de [uso da API implementada](sampler-studio-uso.md) contém exemplos executáveis e módulos de origem. Este documento preserva o contrato de trabalho da discovery para as ondas do [roadmap](sampler-studio-roadmap.md). Os nomes abaixo descrevem operações propostas. A implementação deve usar módulos ES e funções de domínio invocáveis em testes, em Worker ou pela futura apresentação. Os contratos entram no código junto com o primeiro uso musical e seu teste.

## A biblioteca em disco

Uma pasta física escolhida em **Samples** contém coleções que o músico pode organizar. Exemplo de uma biblioteca depois de criar um piano e um kit:

```text
Minha biblioteca/
  library.json
  Instruments/
    Teclas/Piano da sala/
      instrument.json
      revisions/1.json
  Kits/
    Objetos/Cozinha/
      instrument.json
      revisions/1.json
  Samples/
    Originals/Sessão de sexta/piano-C4-forte-2.wav
    Originals/Cozinha/tampa-aberta.wav
    Processed/Cozinha/tampa-curta.wav
  Presets/
    Piano próximo.json
```

`library.json` identifica a biblioteca. O manifesto corrente traz o mapa, metadados e referências a arquivos relativas **à raiz da biblioteca**. Cada revisão publicada possui uma cópia identificável do manifesto. Um preset identifica instrumento e revisão e guarda os ajustes permitidos. Pastas intermediárias são livres. Grupos e articulações vivem no manifesto. Mover um instrumento de *Teclas* para *Acústicos* altera seu localizador. A identidade que o projeto usa continua a mesma.

| Operação proposta | Resultado consumível pela futura UX |
|---|---|
| `listChildren(root, relativeDir, {cursor, limit})` | Página ordenada de filhos imediatos com nome, tipo, caminho, ID quando conhecido e indicação de pasta expansível. Lê nomes e metadados pequenos. O catálogo não carrega PCM. |
| `search(root, {kind, tags, text})`, `inspect(ref)`, `dependencies(ref)` | Consulta incremental dos mesmos itens, detalhes e lista de referências com estado. O índice de metadados pode ser reconstruído a partir dos manifestos em disco. |
| `importOriginal(root, file, destination)` | Cópia preservada byte a byte, tamanho, SHA-256, metadados WAV e identidade. Checar colisões inclusive em volumes que ignoram caixa. Arquivos diferentes com o mesmo nome podem coexistir em pastas diferentes. |
| `publish(root, draft, {expectedRevision})`, `load(root, ref)` | Gravar dependências novas, verificar, fechar a revisão e publicar `instrument.json` por último. Responder com ID, revisão e caminho. Uma gravação interrompida mantém acessível a versão publicada anteriormente. |
| `verify(root, ref)`, `findCandidates(root, missing)`, `relink(ref, candidate, expectedRevision)` | Diagnósticos por arquivo para falta, divergência, ambiguidade e permissão. Reabrir raiz movida por ID. Propor amostras por tamanho/hash e confirmar a troca. Conteúdo diferente requer substituição explícita em nova revisão. |
| `collect(ref, destination)` | Exportar instrumento ou kit com todas as dependências, mapear caminhos relativos na cópia e verificá-la após reabertura. Preservar créditos e proveniência. |

Resolver cada segmento sob o handle raiz. Recusar caminhos absolutos, URLs, `..`, componentes vazios e escapes da raiz, inclusive no adaptador de testes em disco. Arquivos de áudio de biblioteca vivem exclusivamente no filesystem convencional. Somente o handle e pequenas preferências podem ser lembrados no navegador. Recusa de permissão produz um resultado acionável.

A publicação deve serializar escritores WASWAN da mesma biblioteca, comparar a revisão esperada e revalidar em caso de mudança externa. Uma transação de diretório envolvendo vários arquivos não é garantida pela API do navegador. Gravar com nomes novos, fechar cada writer e deixar a referência corrente para o fim permite ignorar sobras de uma operação interrompida. Repetir a mesma operação pode reusar dependências já verificadas. Versões usadas por outros projetos ou por uma voz em execução continuam disponíveis.

## Do arquivo à nota

| Entidade | Dados e semântica |
|---|---|
| Instrumento | `format`, versão, ID estável, revisão publicada, nome, tipo melódico ou kit, tags, grupos, articulações, regiões e destinos nomeados. Ganho, modulação e articulação inicial são propriedades do instrumento. |
| Amostra | ID local reutilizável, caminho, hash dos bytes, taxa, canais, comprimento em frames, procedência e licença quando conhecida. Um derivado identifica a origem, a receita ordenada e a versão dos algoritmos. |
| Região | ID e referências a amostra, grupo e articulação, condição ataque/release, intervalo de teclas, raiz, camada de velocity, parte do arquivo, modo, loop, ganho em dB, panorama e cents. Cada região seleciona uma fonte. |
| Camada de velocity | Intervalo MIDI inclusivo e larguras de fade, curva de amplitude independente do critério de seleção. Regiões de uma mesma camada podem ter zonas ou variantes diferentes. Uma amostra suave e outra forte podem soar juntas num fade. |
| Variação | Conjunto explícito de alternativas elegíveis com posição/ordem estável. Sequencial ou pseudoaleatória, seed e política de repetição. Ataques em camadas distintas podem especificar conjuntos independentes. |
| Grupo | Ganho, panorama, destino, regras de acionamento, envelopes, filtro e limite local de vozes. A identidade de exclusão/choke pode ser compartilhada entre grupos, por exemplo chimbau aberto e fechado. |
| Articulação | ID, grupo de exclusão de seleção, keyswitch ou intervalo de CC e modo de ativação. Começar por seleção persistente até nova troca. Ataque e soltura de uma mesma nota mantêm o contexto capturado no ataque. |
| Kit e pad | Um kit é um instrumento. Cada pad tem ID, índice físico 1–16, nota MIDI de entrada e referências aos grupos/regiões que aciona. Raiz, ganho, pan, tuning, envelope e modo do som são independentes da nota de entrada. |
| Modulação e saídas | Rotas tipadas com fonte, destino, polaridade, profundidade e unidade. Um grupo aponta para uma saída lógica que o host resolve na preparação. A primeira saída é a estéreo da parte. Saídas sem correspondência retornam diagnóstico antes de tocar. |

Exemplo mínimo de manifesto proposto. O digest é ilustrativo. O original contém 44.100 frames e a nota-raiz foi atribuída pelo músico.

```json
{
  "format": "waswan-sampler-instrument",
  "version": 1,
  "id": "piano-sala",
  "revision": 1,
  "kind": "instrument",
  "name": "Piano da sala",
  "outputs": [{"id": "main", "channels": 2}],
  "samples": [{
    "id": "c4-forte-2",
    "path": "Samples/Originals/Sessão de sexta/piano-C4-forte-2.wav",
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "sampleRate": 44100, "channels": 2, "frames": 44100
  }],
  "groups": [{"id": "piano", "output": "main"}],
  "regions": [{
    "id": "r1", "group": "piano", "sample": "c4-forte-2",
    "key": [0, 127], "root": 60, "velocity": [1, 127],
    "trigger": "attack", "mode": "gate", "frames": [0, 44100]
  }]
}
```

Os limites MIDI são inclusivos. Note On com velocity zero equivale a Note Off. Os intervalos de áudio e loop são `[início, fim)`, em frames por canal da amostra referenciada. Coordenadas de slices de um derivado pertencem ao derivado. Ganho e tuning somam em dB e cents, valores omitidos iniciam em zero, panorama central. Sem articulação explícita, a região participa da articulação padrão. Sem variação declarada, todas as regiões elegíveis com peso positivo soam. A nota fora de qualquer zona fica em silêncio. Validar IDs, referências, intervalos, loops e números finitos antes de compilar. Uma versão ou recurso essencial desconhecido requer diagnóstico e preservação do arquivo.

## Seleção, execução e edição

1. **Construir.** `createInstrument` cria o documento mínimo. `applyEdits(draft, edits)` recebe operações de adicionar/substituir amostras, regiões, grupos, articulações e pads por ID, devolve um novo documento ou erros localizados. Validar o lote todo permite atualizar uma referência e seu destino juntos. `planMapping(samples, hints)` propõe raízes e limites com base no nome ou na análise. A confirmação grava a escolha.
2. **Resolver.** `compile(instrument, capabilities, limits)` valida o mapa e produz candidatos por nota, envelope de memória/vozes e dependências. `explainNote(plan, event, state)` retorna IDs, condições, pesos e próximo estado. A consulta deixa o estado recebido intacto. O runtime e essa consulta devem passar pelos mesmos vetores de seleção para evitar divergência entre o que a UX apresenta e o que se ouve.
3. **Preparar.** `prepare(root, ref, {signal, onProgress})` verifica arquivos, decodifica fora da thread de áudio e transfere PCM em blocos limitados. Um token identifica a geração. `activate(prepared, binding)` publica em fronteira de bloco. Uma falha, cancelamento ou resposta atrasada descarta somente o preparo correspondente. O estado anterior continua tocável. Se faltar memória para manter duas gerações, informar a carga necessária antes de interromper a atual.
4. **Tocar.** O evento interno leva instante em frames, origem, binding de pista/parte, canal, identidade da nota e gesto. A pré-escuta usa um dono temporário identificável e libera apenas as próprias notas. A DAW usa seu transporte, monitor, gravador e exportador. Cada voz aceita no ataque retém o PCM, parâmetros e articulação daquela geração até terminar. Uma troca de apresentação visual não publica instrumento nem gera evento musical.
5. **Editar.** `analyze(sample, options)` devolve medidas e sugestões com unidades, confiança e motivo de abstenção. `renderEdits(source, recipe, destination)` aplica operações offline e publica um derivado identificável. Para fatiar, `regionsFromSlices(markers)` pode criar várias regiões do mesmo arquivo, viabilizando um kit sem cópias. Para um banco de fita, `exportTapeBank(ref, mapping, destination)` devolve um plano de conversão e relatório de perdas antes de gravar.

**Ordem de seleção proposta.** Atualizar controle/articulação, filtrar por trigger, grupo, nota e velocity, escolher uma alternativa por conjunto round-robin elegível, calcular o produto dos pesos dos fades de tecla e velocity, aplicar curva de resposta e ganhos. Pesos de potência constante para pares em crossfade são seno/cosseno entre zero e um. Uma sobreposição declarada como layer mantém ambos os ganhos. Contabilizar as vozes solicitadas e aplicar limites na ordem declarada das regiões para que a saturação do pool dê resultado estável.

**Exemplo verificável.** Um grupo de piano possui gravações suaves até velocity 80 e fortes a partir de 64, ambas com fade 64–80. Cada camada tem duas tomadas. Aos 72, no centro do fade, o primeiro ataque seleciona suave A e forte A, cada um com peso próximo de 0,707 antes da curva de amplitude. O segundo seleciona suave B e forte B. Um keyswitch consumido muda a articulação sem emitir som ou avançar os contadores. O Note Off do primeiro ataque usa seu grupo de soltura mesmo após o keyswitch.

O fragmento abaixo descreve uma das duas regiões suaves e sua articulação. Os identificadores apontam para entidades do mesmo instrumento. Na região simples do exemplo anterior, `velocity: [lo, hi]` define uma camada local com ganho unitário. Uma região com `layer` herda o intervalo da camada nomeada. O validador rejeita fornecer as duas formas na mesma região.

```json
{
  "layers": [{"id": "soft", "velocity": [1, 80], "fadeOut": [64, 80], "fadeLaw": "equalPower"}],
  "variations": [{"id": "soft-c4", "mode": "sequential", "order": ["a", "b"]}],
  "articulations": [{"id": "felt", "selectorGroup": "attack-style", "select": {"keyswitch": 24}}],
  "regions": [{
    "id": "soft-c4-a", "group": "piano", "sample": "soft-c4-take-a",
    "key": [57, 63], "root": 60, "layer": "soft", "articulation": "felt",
    "variation": {"set": "soft-c4", "member": "a"}, "trigger": "attack", "mode": "gate"
  }]
}
```

Uma árvore futura consulta `listChildren(root, "Instruments/Teclas", …)` para encontrar o piano. `inspect(ref)` expõe os grupos, articulações, camadas e regiões do manifesto. `dependencies(ref)` resolve os WAVs do grupo suave e relata uma tomada ausente. A pré-escuta é uma operação explícita sobre uma revisão preparada.

**Estado de execução.** Cada binding e canal guarda articulação, pedal, expressão, contadores e seed. Avançar a variação uma vez por gesto elegível de cada conjunto. Na escolha aleatória sem repetição, excluir o último índice se houver mais de uma alternativa. Persistir política e seed para gravação/render. Recomeçar uma música restaura estado inicial. Seek reconstrói controles e contadores pelos eventos anteriores. Proposta inicial para loop de transporte: restaurar o estado do início do trecho em cada volta. Um loop de áudio da região apenas move o cursor. Definir ordem estável para eventos no mesmo frame e preservar sucessão dos gestos gravados. No agendamento simultâneo sem ordem explícita, aplicar controles/keyswitch, solturas e então ataques.

**Ciclo da nota.** Gate respeita Note Off e sustain. One-shot percorre a amostra até o fim, sujeito a choke, panic e roubo. Proposta inicial para release sample: disparar uma vez no fim efetivo do gate, inclusive no pedal levantado. Capturar no ataque o grupo e o contexto de seleção. Dissociar a soltura física permite acrescentar depois um trigger próprio para ruído de tecla. Roubo, desconexão e panic limpam seus donos sem criar novos ataques de soltura. Vincular o ID da nota à sequência do slot impede que um Note Off atrasado solte uma voz reutilizada.

**Reprodução e modulação.** Início/fim, sentido, loop forward, reverso ou ping-pong, envelope de amplitude e crossfade são independentes. Um loop deve caber na região, com faixa de crossfade que caiba nos dois lados. Testar leitor e vizinhos nas bordas em ambas as direções. A matriz começa com velocity, wheel, bend, pressão disponível, envelopes e LFO, aplicados a ganho, afinação, cutoff, ressonância, panorama e, na onda avançada, posição. Definir Hz, cents, dB, ms e valores normalizados por destino, combinar profundidades e limitar antes do DSP. Defaults do instrumento passam aos grupos. Sobrescritas locais e rotas adicionais são explícitas. Legato e transições precisarão do histórico de notas sobrepostas e da identidade de origem. Introduzir as regras quando houver um instrumento e áudio de referência para exercitá-las.

**Contrato com a DAW.** Proposta de referência pequena na pista: `{type: "sampler", libraryId, instrumentId, revision, path}`, com o patch de apoio apenas se exigido pelo host. O slot se resolve por pista a cada preparação. Uma alteração de caminho com IDs/revisão conferidos permite carregar. Uma revisão diferente requer escolha explícita. Incluir a referência nos presets e undo/redo. Projetos existentes mantêm leitor, tomadas e recuperação atuais. Prever compatibilidade de leitura ao estender os eventos MIDI. Captura de áudio e exportações da DAW continuam operações próprias.

**Falhas observáveis.** Devolver código estável, IDs/campo ou caminho afetado e detalhe legível. Diferenciar `permission-required`, `missing-sample`, `digest-mismatch`, `revision-conflict`, `unsupported-feature`, `budget-exceeded` e cancelamento. Uma busca ou inspeção nunca precisa ativar o instrumento. Deve ser possível diagnosticar e corrigir um banco incompleto mantendo a música atual em execução.
