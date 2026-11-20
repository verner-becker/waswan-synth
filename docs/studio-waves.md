# WASWAN Studio — controle das ondas

Em 20/11/2026, o usuário solicitou o discovery do **WASWAN Sampler Studio** e a apresentação da arquitetura antes da Onda 1. A Onda 0 foi concluída na branch `docs/sampler-studio-discovery`, sobre `5c2338b`. A auditoria inclui regressões Node, WASM e Chrome da base. O usuário aprovou a execução do roadmap em branches empilhadas e a publicação dessas branches no GitHub. A [Onda 1](sampler-studio-wave-1.md) implementa e testa instrumentos tocáveis. [Roadmap e critérios de aceite](sampler-studio-roadmap.md) · [Auditoria e evidência](sampler-studio-discovery.md) · [Modelo e API](sampler-studio-api.md)

Novo desafio em análise: [WASWAN DAW MVP — controle, orientações de autonomia e branches empilhadas](daw-mvp-discovery/README.md). Série separada das ondas Studio abaixo; a autorização histórica do Studio não aprova automaticamente sua implementação.

Em 19/11/2026 foi solicitado o [roadmap do Mellotron e do sampler tocável](mellotron-sampler-roadmap.md) e o usuário pediu prosseguimento. O [Marco A](mellotron-sampler-a.md) confirmou no host WASWAN e no Chrome a reprodução de um WAV externo, a gravação interna e a exportação por pista e master. O [Marco B](mellotron-sampler-b.md) entregou dois bancos, transporte de fita por tecla e atribuição por pista na branch `feat/mellotron-sampler-b`. O usuário priorizou o ensaio no instrumento. Aceite físico no SMK-37 Pro pendente.

Em 20/11/2026 o cadastro de pastas passou para **Instrument setup → Library folders** na branch `feat/synth-library-folders`, empilhada sobre o Marco B. O usuário pediu os samples do SMKTRON. Os quatro bancos ML1 foram preparados para uso local com os créditos das gravações. O Chrome recuperou os cadastros após reiniciar e produziu áudio com os quatro bancos. O próximo ensaio é tocar as fitas no SMK-37 Pro. O sampler continua previsto no Marco C. [Uso e evidências](mellotron-sampler-b.md#pastas-do-instrumento)

Em 20/11/2026, a revisão com o agente de UX reproduziu a escolha de VIOLINS enquanto o motor continuava em CELLO + CHOIR. **Instrument** passou a aplicar a escolha diretamente e **Layer** permite combinar uma segunda fita. Em Chrome, o ensaio com as gravações ML1 confirmou áudio distinto para a mesma nota e o teclado virtual visível com o painel aberto em 1366 × 768. A suíte verificou troca com tecla sustentada, reabertura e exportação. Evidência em `.local/validation/mellotron-selection-ux/`. A escuta física segue pendente.

A captura do usuário mostrou `CHOIR` cadastrada diretamente com o seletor vazio. O painel passou a reconhecer os WAVs nessa pasta e a recuperar o cadastro anterior após a leitura. No Chrome com os 12 WAVs do coral, o teste confirmou sinal na saída e os quatro timbres ao voltar à biblioteca principal. Evidência local em `.local/validation/mellotron-selection-ux/choir-folder.png`.

O usuário confirmou que conseguiu tocar os dois timbres com **Layer** e autorizou integrar à `main` a sequência dos marcos A e B até `6a63636`. O ensaio físico completo de pedal, bend e gravação continua previsto. O próximo marco de implementação é o sampler (C).

Atualizado em 2026-11-17. Referência inicial: `97ab4ecb4b12521aaac8db7c1e990d83db16d2fc` (main local). Branch de planejamento e investigação: `docs/studio-waves-plan`.

## Integração e encerramento Git — 17/11/2026

O usuário aprovou explicitamente integrar tudo na `main` e limpar as branches. As entregas preservadas são: planejamento `02ffe93`, ondas `4485a9d` a `c6e3c67`, revisão SEQ `04dc1c8` e manual PDF `feb3687`. A linha é descendente da main `97ab4ec`, permitindo fast-forward sem reescrita ou squash.

Validação conferida antes da integração: 19 suites Node, 12 Chrome distintas (onze de baseline mais a nova UX e repetições dos fluxos afetados), manual de 44 páginas com links/margens verificados e submódulo fixado. Não houve alteração funcional após essa validação; este encerramento atualiza referências documentais. Avaliação física/musical permanece distinta e pendente.

Após publicar a main e conferir todos os SHAs como ancestrais da referência remota, remover as branches temporárias `docs/studio-waves-plan`, `feat/studio-waves` e `feat/studio-seq-ux`, localmente e no origin. Não criar tags, não usar force push e não apagar commits. Os registros das ondas abaixo são históricos; nomes de branches não são instruções de checkout.

## Acordo de trabalho

- Preferir execução local no navegador; não migrar para nativo sem uma necessidade comprovada.
- A imagem e o texto de visão são referências, não uma especificação integral aprovada.
- Entregar experiências musicais completas por onda; não prometer uma mini-DAW inteira na primeira entrega.
- O usuário acompanha o fechamento do plano e autoriza a implementação por escopo. Autonomia cobre decisões rotineiras dentro do escopo aprovado, sem novas confirmações a cada passo.
- Discordar de propostas quando houver razões técnicas ou de produto, explicando consequências e alternativas.
- Diante de bloqueio real ou decisão fora do escopo, parar a parte dependente, preservar trabalho/evidências e pedir ajuda ou decisão. Não repetir tentativas sem uma hipótese nova.
- Não integrar na main sem aprovação explícita. Preservar uma instância, upstream fixado, formatos existentes, MIDI/pickup, escalas, 256 vozes e Legacy SMK. Mudanças adicionais no DSP ou polifonia exigem aprovação própria.
- Separar resultados automatizados, testes no navegador e validação física/musical. Nenhum substitui silenciosamente o outro.

## Estado e autorização

| Onda | Resultado utilizável | Estado |
|---|---|---|
| 0 — diagnóstico e viabilidade | Caminhos de áudio/MIDI, relógios, limites, riscos e escopo recomendado para a primeira entrega | Concluída como diagnóstico e prova curta; limites e decisões da onda 1 documentados |
| 1 — gravador de performances | Capturar áudio estéreo + eventos, ouvir o áudio, exportar WAV e recuperar a tomada | Concluída em software; [fechamento](studio-wave-1.md), ensaio real de 20 minutos e limitações documentadas |
| 2 — sequenciador MIDI editável | Piano roll, notas/velocity, transporte musical, loop, reprodução MIDI e exportação SMF | Concluída em software; [fechamento](studio-wave-2.md), 14 suites Node e sete Chrome |
| 3 — composição por camadas | Pistas e clipes, overdub, mover/duplicar, mute/solo, timbres compatíveis com o motor | Concluída em software; [fechamento](studio-wave-3.md), 16 suites Node e oito Chrome |
| 4 — automação e finalização | Automação editável e exportação da composição; MP3 após avaliar codificador/licença/custo | Concluída em software; [fechamento](studio-wave-4.md), 17 suites Node, nove Chrome e MP3 de 20 minutos |
| 5 — pistas de áudio | Importação, posicionamento, corte, ganho e reprodução sincronizada | Concluída em software; [fechamento](studio-wave-5.md), 18 suites Node, onze Chrome e carga no limite |

A numeração não aprova arquitetura nem promete datas ou quantidades de pistas. O marco de versão 0.4 será decidido junto com o escopo da onda 1.

## Onda 0 — critérios de conclusão

- [x] Identificar captura da saída estéreo e efeitos do ganho/mute na gravação.
- [x] Mapear entradas MIDI, teclado/pads, mapeamentos e eventos gerados pelo sequenciador/arpejador.
- [x] Identificar relógios, granularidade de renderização e caminho de agendamento de eventos.
- [x] Inventariar partes, pistas, timbres, efeitos compartilhados e limites do sequenciador existente.
- [x] Avaliar persistência, exportação, recuperação e limites de memória.
- [x] Executar baseline relevante e sondagem isolada de captura/sincronização/carga; registrar duração real, ambiente e limitações.
- [x] Separar viabilidade comprovada de hipóteses, testes pendentes e validação física.
- [x] Recomendar escopo e critérios mensuráveis para a onda 1; submeter as decisões de produto ao usuário no relatório de entrega.

Na prova curta da onda 0, somente a continuidade por frames foi verificada. Alinhamento MIDI/áudio e ensaio de 20 minutos foram tratados nas ondas seguintes; latência física continua pendente. Não confundir conclusão do diagnóstico com certificação dessas capacidades.

Resultados e comandos: [diagnóstico da onda 0](studio-wave-0.md). Evidências locais em `.local/validation/studio-wave-0/`.

## Critérios propostos para as ondas seguintes

### Onda 1

Selecionar timbre, iniciar captura, tocar, encerrar, ouvir o áudio gravado, exportar WAV e salvar/reabrir a tomada com os eventos e o contexto musical definido. Diferenciar ouvir áudio de ressintetizar MIDI. Capturar em blocos com limite explícito e encerramento íntegro; não manter crescimento ilimitado de RAM. Definir quais eventos são registrados e como ficam sustain, release, caudas de efeitos, mute e alterações de timbre. Preservar responsividade e regressões existentes.

### Onda 2

Reproduzir eventos pelo instrumento com agendamento pelo relógio de áudio; editar notas/duração/velocity, BPM, métrica e loop; exportar SMF. Definir coexistência com sequenciador/arp legados e fidelidade do contexto salvo antes de prometer reprodução equivalente ao áudio original.

### Onda 3

Compor por camadas sem confundir pistas lógicas com partes/timbres disponíveis. Definir overdub, seleção, cópia e repetição de clipes. Quantidade de pistas, independência de timbres e alcance de mute/solo/volume/pan dependem do diagnóstico e de decisões explícitas.

### Onda 4

Usar IDs estáveis e escalas originais para automação; distinguir eventos MIDI recebidos de mudanças semânticas efetivamente aplicadas após mapeamento/pickup. Exportar composição sem modificar o projeto. Avaliar MP3 local e efeitos existentes antes de acrescentar dependências ou capacidades DSP.

### Onda 5

Administrar arquivos de áudio e reprodução por blocos; validar importação, sincronização, memória e recuperação. Gravar a saída do synth não implica que já exista um editor de áudio. Time stretch, plugins nativos e gravação de microfone não estão aprovados.

## Decisões inicialmente abertas e resolução

1. Resolvido na [onda 1](studio-wave-1.md). Escopo: captura do áudio final e quais fontes/eventos precisam acompanhar a tomada.
2. Resolvido nas ondas 1 e 4. Semântica de ganho, mute, fim de gravação e caudas de efeitos.
3. Resolvido nas ondas 1 e 3. Contexto salvo: snapshot de timbres/estado, relação com sessão legada e limites de reprodução fiel.
4. Chrome desktop, limites documentados e ensaios nas ondas 1, 4 e 5. Plataforma inicial, duração mínima suportada, carga de validação e limites aceitáveis de sincronização/latência.
5. Resolvido nas ondas 2 e 3. Reutilização e convivência com sequenciador/arp existentes; papel das quatro partes na composição futura.
6. Pendente da avaliação física pelo usuário: o que deve ser validado pelo usuário com controlador e saída de áudio físicos antes de integrar.

Ear e Academy ficam futuros. Preparação inicial: dados musicais claros e versionados, sem arquitetura de plugins antecipada.

## Registro de decisões

| Data | Decisão | Origem |
|---|---|---|
| 2026-11-17 | Organizar evolução por ondas, com controle persistido no repositório | Solicitação do usuário |
| 2026-11-17 | Priorizar navegador e avaliar viabilidade antes de considerar nativo | Preferência do usuário |
| 2026-11-17 | Questionar propostas e pedir decisão diante de bloqueio, sem loops de tentativas | Solicitação explícita do usuário |
| 2026-11-17 | Executar a onda 0 | “vamos a onda 0” |
| 2026-11-17 | Recomendar navegador, gravador por blocos antes do mute e tratamento próprio do contexto vivo | Diagnóstico e sondagens da onda 0; recomendações aguardam aprovação para implementação |
| 2026-11-17 | Seguir pelas ondas planejadas, adotando recomendações da onda 0 e decisões rotineiras dentro do escopo | “Pode prosseguir” do usuário |
| 2026-11-17 | Fechar cada onda com implementado, efetivamente testado, limitações, decisões e próximo passo | Recomendação adicional do usuário |

## Continuidade

Ao retomar: ler este arquivo, o diagnóstico, status Git e evidências; continuar de onde parou. Antes de implementar outra onda, registrar escopo aprovado e seus critérios. Ao encerrar uma etapa, registrar resultados, limitações e próximo passo. Trabalho autônomo ocorre durante a execução da sessão; este documento não cria agendamento nem processo em segundo plano.

Próximo passo: avaliação musical física com o [roteiro de uso](studio-guide.md); ondas 0–5 concluídas em software. A integração na main foi aprovada explicitamente em 17/11/2026. Branch de implementação `feat/studio-waves`, baseada na main conferida e nos registros da onda 0. Sem merge automático.

## Decisões adotadas para a onda 1

- Chrome/Chromium desktop inicialmente; uma tomada por vez, duração máxima de 20 minutos e limites explícitos de eventos e arquivos.
- Captura estéreo depois de master/FX e antes do mute de escuta. Stop termina a captura, sem panic, release ou cauda automática; o músico pode esperar a cauda antes de parar.
- Registrar entrada MIDI suportada e comandos encaminhados ao instrumento, com origem e tempos distintos. Não prometer transcrição das notas geradas internamente nem confundir comando observado com parâmetro efetivamente alterado.
- Salvar áudio como referência e snapshot musical vivo junto da sessão legada; abrir projeto não substitui o estado do synth. Reprodução MIDI/restauração musical explícita será tratada nas ondas seguintes.
- Persistência local de recuperação separada do arquivo de projeto exportado. Importação é somente dados validados.
- Registro de fechamento por onda: implementado, efetivamente testado, limitações, decisões e próximo passo. Atualizar o estado e vincular evidências antes de avançar.

## Escopo adotado para a onda 5

Importar PCM16 WAV 44,1 kHz, quatro fontes/120 segundos, até 32 regiões, corte não destrutivo, posição/ganho/balanço/mute, loop e captura com MIDI. Mistura preparatória em Worker com buffers limitados; projeto v2 inclui fontes, conserva leitura v1 e cópia local recuperável. Sem microfone/time stretch. [Detalhes e limites](studio-wave-5.md); [roteiro de uso e validação física](studio-guide.md).

## Continuidade — revisão de UX do SEQ

Após as ondas, o usuário solicitou pesquisa de DAWs e reforma do SEQ, New project completo e C3 na captura, com advisor Sol 6.1 high. Implementação na branch `feat/studio-seq-ux`, preservando a dependência `c6e3c67` sem integrar na main. [Pesquisa, capturas, decisões e fechamento](studio-seq-ux.md). O roteiro de uso foi atualizado para New project → Record MIDI → Stop → Save project.

## Expansão do ANALOG

O usuário autorizou um ciclo para quatro osciladores e formas adicionais, com preservação dos timbres anteriores. O ciclo desenvolvido na branch `feat/analog-four-oscillators` foi integrado à `main` em 19/11/2026, até o commit `0b35c9c`, com aprovação explícita para a integração e a limpeza da branch. Em 19/11/2026, o usuário autorizou Fine e Pulse width independentes em OSC3/4. A extensão passou pela comparação de áudio, pela gravação e recarga de timbres e pela validação do editor compacto em Chrome. [Plano, formato dos timbres e validação](analog-four-oscillators.md)

## Módulo FM

Em 19/11/2026 o usuário autorizou criar o módulo DX7-like por timbre e pediu pesquisa nos repositórios do FM-1. O commit `5709a3e`, desenvolvido na branch `feat/dx7-fm`, incorpora o DSP do sloopDX, integra a edição dos seis operadores e mistura FM e Analog dentro da mesma voz. O usuário aprovou a integração à `main` e a remoção da branch. O aceite musical com controlador e saída físicos segue pendente. [Uso, referências, testes e carga de áudio](fm-layer.md)

## Bancos locais de timbres

1. No primeiro combo, **Bank → Choose library folder…** cadastra a pasta da biblioteca. Cada subpasta direta vira um banco, por exemplo `Meus bancos/DX7/` e `Meus bancos/Poly-D/`. Uma pasta antiga com arquivos `.wstone` na raiz também aparece como banco. O IndexedDB do Chrome guarda a referência da pasta e a lista de bancos nesse perfil e endereço do simulador. O navegador pode solicitar novamente acesso de leitura. **Refresh banks** atualiza a lista de subpastas.
2. Selecione **Internal**, **DX7** ou outro banco no primeiro combo. A seleção do banco relê sua lista e mantém o som da parte. Use o segundo combo, **Tone**, para carregar o timbre na parte indicada. Ao voltar a **Internal**, é possível escolher inclusive o slot original para restaurá-lo. A substituição de edições continua exigindo confirmação. Para buscar por nome, atualizar arquivos ou abrir um timbre avulso, use **Bank → Manage tones…**.
3. Edite o som em **TONES** e abra **Save to bank…**, ou escolha **Create bank tone** na janela do banco. Confira a pasta, a parte e o nome e use **Create tone file**. Na primeira gravação, o navegador pode solicitar acesso de escrita. Cada criação gera um arquivo independente, mesmo com nome repetido. Para distinguir arquivos homônimos, a lista mostra a ordem e a data de modificação. A lista passa a selecionar o novo arquivo.
4. Para gravar em um dos 99 programas do instrumento, use **Program → Save** ou **Save as…** em TONES. Um arquivo de banco guarda o timbre e a extensão FM quando presente. Os efeitos compartilhados, o mixer e o pattern pertencem à sessão.

Cada arquivo `.wstone` é JSON UTF-8 de até 4 KiB. O formato usa `format: "waswan-tone"`, `version: 1`, o nome exibido em `name` e o snapshot portátil em `patch`. Uma pasta pode ser publicada em Git com um arquivo por timbre. [Formato do snapshot](fm-layer.md#armazenamento)

A validação em Chrome conferiu a gravação e a recarga de um timbre FM, a abertura de arquivo avulso, a troca de pasta, a preservação dos 99 slots e dos efeitos compartilhados e o bloqueio do carregamento durante uma nota ativa. O teste automatizado usou uma pasta de teste no OPFS para exercitar a leitura e a escrita. A confirmação manual do seletor nativo do sistema operacional fica pendente. Evidências em `.local/validation/tone-banks/`.

O usuário confirmou que os bancos locais estavam funcionando e aprovou a integração do commit `01e0445` à `main` por fast-forward.

### Seleção e criação na interface

A captura do fluxo anterior mostrou o nome do arquivo apenas na janela do banco. Depois de carregar um timbre, o cabeçalho ainda apresentava o nome do programa. A branch `feat/tone-bank-workflow` aproxima o banco do seletor global, identifica o arquivo carregado na parte e mantém o programa interno visível. Ao editar o som, o cabeçalho passa a identificar o último arquivo carregado. O editor agrupa as ações do programa e oferece acesso direto à criação em disco.

O Chrome exercitou busca, arquivos homônimos, atualização da lista, confirmação de descarte, nota sustentada, carga nas partes A e B e arquivo avulso com o seletor de pastas desabilitado. As regressões cobriram FM, programas internos, persistência, áudio, MIDI e navegação. Capturas de antes e depois em `.local/validation/tone-bank-workflow/`. Próximo passo para aceite de uso é escolher uma pasta física, editar um timbre com o controlador e criar uma variante nessa pasta.

O fluxo aprovado usa dois combos no cabeçalho e uma única pasta de biblioteca. A configuração fica no IndexedDB, e cada timbre continua em seu arquivo `.wstone`. No Chrome, o teste configurou uma biblioteca com DX7 e Poly-D, recarregou a página, recuperou o cadastro, simulou uma recusa de leitura e selecionou **DX7 → Electric Piano**. Também gravou uma variante na subpasta DX7 e recuperou o som do mesmo slot interno após confirmação. A captura dos combos está em `.local/validation/tone-bank-workflow/bank-tone-combos.png`. O teste usa diretórios do OPFS do Chrome. A confirmação do diálogo nativo de acesso a uma pasta física fica para o aceite manual.

Após a confirmação de um programa interno, o foco voltava ao combo **Tone** e o navegador consumia as letras usadas para tocar. O Chrome reproduziu a falha com a tecla A. Agora os atalhos musicais também funcionam com **Bank** ou **Tone** fechado e focado. O teste mediu sinal após o master ao tocar A antes da troca, no banco de pasta e de volta ao programa interno, incluindo a soltura da nota. Também verificou navegação por seta e digitação do nome de um timbre. Evidência em `.local/validation/tone-bank-workflow/audio-fixed.log`.

Em 19/11/2026, o usuário confirmou que voltou a tocar com o teclado do computador após trocar de timbre e aprovou a integração. A `main` avançou por fast-forward até `022555d`. Após recompilar o simulador, o teste de bancos e teclado passou novamente no Chrome. Evidência em `.local/validation/tone-bank-workflow/integration-browser.log`. O aceite manual com um controlador MIDI físico e com o diálogo nativo de seleção de pasta segue pendente.

### Banco DX7 da comunidade

Em 19/11/2026, o usuário solicitou um banco DX7 em disco e a conversão para o formato WASWAN. A branch `feat/dx7-tone-bank` inclui o cartucho Aquanode Presets 1 sob CC0, o importador SysEx e 32 timbres para a biblioteca de pastas. A conversão usa o módulo FM existente. [Como tocar, converter e conferir a procedência](../assets/dx7/README.md)

O teste de importação reproduziu os arquivos distribuídos e mediu áudio em cada programa no WASM de 256 vozes. No Chrome, foi possível abrir o banco, tocar **SBass** pelo teclado e salvar uma variante na pasta de teste. Evidências em `.local/validation/dx7/`. A comparação auditiva com o DX7 físico segue pendente. Em 19/11/2026, o usuário autorizou a integração de `c4dd7d4` e o commit foi publicado na `main` por fast-forward.

### Importação DX7 no TONES

A pedido do usuário, a branch `feat/tones-dx7-import` acrescenta **TONES → Import DX7…**. O navegador e o terminal usam o mesmo decodificador. O usuário confere o número de timbres e escolhe um banco existente ou uma nova subpasta da biblioteca antes da gravação.

No Chrome com uma biblioteca de teste em OPFS, a importação do cartucho Aquanode produziu os mesmos 32 timbres do terminal e manteve o programa em execução. O ensaio também importou uma voz avulsa para um banco com um nome de timbre repetido, verificou o checksum e exercitou a recuperação de uma falha de escrita. Evidências em `.local/validation/dx7/`. A seleção da pasta física pelo diálogo nativo fica para o aceite manual da interface.

O teste de seleção reproduziu a volta de **Blow** para **SBass** quando o seletor tratava a carga do primeiro arquivo como uma edição pendente. O cabeçalho e o editor agora comparam o timbre da parte com o estado confirmado pelo motor após a carga. Ao cancelar o descarte de uma edição real, a parte conserva os ajustes e o seletor identifica o timbre editado. No Chrome, o teste conferiu a seleção visível, os parâmetros dos seis operadores, a saída de áudio e o retorno ao programa interno. Evidências em `.local/validation/dx7/`.

O [fechamento da Onda 2 do sampler](sampler-studio-wave-2.md) registra as operações offline, a prova de edição não destrutiva em disco e o teste em Worker real.

A [Onda 3 do sampler](sampler-studio-wave-3.md) acrescenta kits de 16 pads, choke por pista, filtros e envelopes no leitor WASM, MIDI expressivo e planejamento de tomadas de teclado externo.

A [Onda 4 do sampler](sampler-studio-wave-4.md) entrega stretch, pitch-shift, slicing por tempo e texturas granulares reproduzíveis em Worker. A textura foi salva em disco e tocada por três notas no WASM.

A [Onda 5 do sampler](sampler-studio-wave-5.md) fecha biblioteca física, presets, escala em 512 regiões, SFZ e geração de bancos para o Mellotron. O [guia de uso da API](sampler-studio-uso.md) reúne os contratos usados pela futura apresentação.

Com a aprovação do usuário, a `main` avançou por fast-forward de `5c2338b` até `b7cd64a`, incorporando o discovery e as cinco ondas do Sampler Studio. Na árvore integrada, passaram os 19 testes Node/WASM do sampler. O Chrome reabriu o projeto com subtrativo, FM, Mellotron e sampler após reiniciar o navegador e mover a biblioteca. Os quatro stems e o master foram exportados, e o áudio ativo do stem do sampler coincidiu amostra a amostra após alinhar o ataque em 128 frames. Evidência em `.local/validation/sampler-main/`.

### Sampler Studio UX · UX-0

Branch `docs/sampler-studio-ux-0`, base local e remota `6c0d936`. [Contrato, inventário dos módulos, decisões e aceites UX-0 a UX-5](sampler-studio-ux-spec.md). A auditoria confirmou a publicação de revisões e o trim parcial em Worker. Identificou as lacunas de sessão, visualização longa, preview de mapa provisório e render de Fusion. Capturas atuais do shell em Chrome a 1366 × 800 em `.local/validation/sampler-ux-0/`. Nenhuma alteração musical. Próxima entrega: UX-1 sobre esta revisão, com ensaio de sete minutos.

### Sampler Studio UX · UX-1

Branch `feat/sampler-studio-ux-1` sobre UX-0 `98128dc`. O músico pode escolher a pasta Samples, importar WAV, ouvir e extrair um intervalo, voltar à tomada para criar outros recortes, ajustar raiz, pitch e fades, salvar o trabalho, renderizar, publicar e atribuir a revisão à pista MIDI selecionada. O editor também abre a partir da DAW e de Performance. Acesso visual e escolha do som para o teclado são independentes.

O overview em Worker calcula extremos por canal em blocos de até 262.144 bytes. O preview de intervalo usa um Blob do trecho no contexto existente. O recorte usa trim inicial de processWav. Original, recorte e derivado conservam hash/procedência. Save Working verifica a geração do rascunho. A promoção prepara no host transitório e publica por revisão esperada. O último estágio fixo da UX-1 aplica os fades depois da mudança de pitch para preservar as bordas.

Chrome 157, teste `node tests/sampler-studio/browser-ux-1.mjs`: 18.522.000 frames estéreo → intervalo [13.230.000, 13.362.300) → 132.300 frames. Após +3 semitons, os tons L/R de 220/330 Hz mediram 262/392 Hz; primeiro e último valores PCM foram zero. Original da biblioteca e arquivo lido de disco coincidiram em SHA-256. Três preparações receberam 132.300 frames cada no único host e contexto. Houve som após Note On via Web MIDI simulado e a revisão foi adotada por ação explícita da DAW. Após reload o rascunho foi reaberto. A pasta de saída desse Chrome usa um handle de OPFS como dublê; os testes Node de biblioteca e de sessões usam diretórios convencionais.

Passaram 21 arquivos Node/WASM do sampler, os seis de UI Foundation, MIDI profile, pickup, polyphony, DSP Monitor e DAW monitor, a recompilação de referência, Chrome Foundation v1/v2, MIDI diagnostic, knob fine/pickup, DAW monitor e o ensaio de waveform. O teste de sessão injeta conflitos e falha entre revisão e ponteiro. O botão compacto cabe no cabeçalho de Performance; teclado até y=742,8 em 1536 × 750. Evidências em `.local/validation/sampler-ux-1/` (chrome.json, long-selection.png, playable-excerpt.png e logs). Sem aceite de controlador e saída físicos. Próxima entrega: histórico comparável e processamento ordenado em UX-2.

### Sampler Studio UX · UX-2

Branch `feat/sampler-studio-ux-2` empilhada sobre `4341bcc`. Working, Original, Official e três checkpoints recentes possuem miniaturas. O editor grande alterna entre a origem e o áudio processado em frames locais. Há checkpoints em disco, restauração para outra cópia, branches, descarte, retorno à origem, continuação sobre WAV renderizado e re-promoção de revisão. Undo/Redo registra deltas de metadados. O Processing Stack permite adicionar, ajustar, reordenar, desativar e remover 13 operações, ouvir antes/depois e analisar o resultado em Worker. A/B compartilha um único dono de escuta de WAV, independente do vínculo MIDI. Em mapas, a comparação de WAV está identificada como amostra de referência.

No Chrome, o teste `browser-ux-2.mjs` ouviu 220 Hz em A e 440 Hz em B, desfez e refez a edição, restaurou o checkpoint, criou branch, descartou mudanças e publicou r1 novamente como r3. O SHA-256 de r3 coincide com r1, e r2 conserva outro áudio. Zero comandos de troca do teclado no ensaio. O teste de etapas mediu o ganho antes/depois e bypass em PCM e exercitou a análise e a miniatura. Passaram 23 suítes Node/WASM de sampler e Foundation, browser-waveform e o percurso UX-1 de sete minutos no novo editor. Evidência em `.local/validation/sampler-ux-2/` com chrome.json e history.png. Save Working e Create Checkpoint persistem explicitamente; o [contrato avalia recuperação após fechamento abrupto](sampler-studio-ux-spec.md). Ausente ensaio físico. Próxima entrega: mapa visual e construção de instrumentos em UX-3.

### Sampler Studio UX · UX-3

Branch `feat/sampler-studio-ux-3` sobre `1cb821c`. O músico pode distribuir gravações por raiz e velocity, editar limites no teclado visual, consultar a região escolhida por nota, programar grupos, articulações, release, round-robin e modulações e montar kits por arquivo ou slices. O teclado pode tocar a cópia ou o oficial por escolha explícita. A adoção da revisão na pista MIDI também é explícita.

O Chrome construiu um instrumento com quatro WAVs, duas raízes e duas dinâmicas. O master e o stem da frase mediram 217, 331, 440 e 663 Hz e o master silenciado produziu zero. Após reabrir o oficial, MIDI 72 em velocity 100 reproduziu 660 Hz. Um segundo kit distribuiu 16 slices adjacentes pelas notas 36–51. O teste do mapa verificou arraste, release e peso central de crossfade 0,707. O inspector preservou sua seção aberta ao alterar parâmetros e recuperou os ajustes de articulação e modulação. Passaram 27 suítes Node/WASM e os percursos Chrome de UX-1, UX-2, mapa, grupos e UX-3. Evidências locais em `.local/validation/sampler-ux-3/` incluem mapping.png, builder.json, group-inspector.json, phrase.json, master.wav e stem.wav. O MIDI desses testes foi simulado. Próxima entrega é a captura de fontes combinadas no host existente.

### Sampler Studio UX · UX-4

Branch `feat/sampler-studio-ux-4` sobre `7cda61b`. A primeira entrega de Fusion foi validada antes de habilitar a automação de multisamples. O Chrome importou dois WAVs pela interface, capturou 33.075 frames, mediu 220 Hz à esquerda e 330 Hz à direita e reproduziu o resultado publicado após retirar ambas as fontes. O teste independente usou 220 e 517 Hz. Na janela após soltura mediu amplitude zero na versão seca e 0,210 com delay incorporado. A frase de um clipe MIDI preservou o andamento e produziu a segunda nota a 440 Hz. Cancelar devolveu o projeto, os slots e as conexões do mixer ao estado inicial. O ensaio usou um host e um AudioContext. Evidências em `.local/validation/sampler-ux-4/`: fusion-print.wav/json, fusion-host.json, isolation.json e sources.png.

O corte Single é `8435c05`. Em seguida o multisampling passou a usar planCapture e mapCaptureTakes. No Chrome, duas raízes × duas intensidades × duas repetições produziram oito WAVs, oito regiões e quatro conjuntos de round-robin. O ensaio do host somou 63.584 frames sem clipping. Ao cancelar após a primeira tomada, o WAV completo permaneceu legível e nenhum mapa parcial foi publicado. Restore source snapshots recuperou os dois panoramas opostos. Mudança visual com MIDI sustentado preservou o vínculo até o Note Off e a soltura do pedal.

Outro Chrome reabriu um projeto após mover a biblioteca, verificou os quatro stems e capturou Analog, FM, Mellotron e Sampler juntos. O pico da soma foi 0,0962 e cada fonte sozinha também produziu sinal. Áudio e relatório em `.local/validation/sampler-ux-4/mixed/four-engine-fusion.wav` e four-engine-fusion.json. Passaram 30 suítes Node/WASM e o teste Chrome de export WAV/MP3 da DAW. O monitor e a captura usam o player disponível da DAW. A independência de reprodução do WAV está verificada; reconstruir a receita requer os bancos/fontes correspondentes. Entrada de performance injetada no ensaio. Próxima entrega é o refinamento do editor, intercâmbio de biblioteca e verificação musical.

### Sampler Studio UX · UX-5

Branch `feat/sampler-studio-ux-5` sobre `4d55ca8`. O [guia do músico](sampler-studio-ux-uso.md) percorre a extração de uma tomada, histórico, loops, kits, construção, Fusion e adoção na pista. A janela destacada move a mesma interface; Performance e DAW têm player compacto com busca, escuta, seleção para o teclado e atribuição explícita em pista. A expansão de áreas e subseções é uma preferência local à janela. Original, Official e checkpoints podem ocupar a waveform principal sem ativar qualquer instrumento.

O editor usa frames exatos para cursor, limites, loops e slices. Tem controles independentes de zoom horizontal/vertical e rolagem, snap em grade, fatia ou cruzamento de zero, repetição de seleção e análise de transientes. Marcadores do WAV fonte integram Save Working, Undo e checkpoints. Em Chrome, o músico criou um loop ping-pong [4.000, 30.000) com crossfade de 220 frames e um kit de três slices. Ao reabrir, os marcadores 8.000 e 16.000 e o hash da origem coincidiram. Um resultado transitório exige materialização antes de ser vinculado ao mapa.

Library & Metadata verifica identidade, metadados e dependências de uma revisão, inclusive se ela não tocar. No Chrome, o relink conjunto de dois WAVs criou r2 e a publicação de metadados criou r3. Uma coleta foi reaberta como biblioteca portátil. O SFZ exportado foi reimportado com pré-validação no host e duas fitas MIDI 60/61 foram exportadas e reabertas. Permissão negada ou cancelamento no picker da janela destacada preservaram a sessão. Em diretórios POSIX reais houve rejeição de hash incorreto, revisão concorrente e falha de preflight sem substituição do oficial. O Chrome usou uma pasta OPFS como destino de teste.

Na navegação entre as duas janelas e os players compactos, uma nota de 275 Hz acionada por MIDI de teste continuou soando. O host, o AudioContext e o painel mantiveram a identidade, com zero comandos de interrupção. Evidência local em `.local/validation/sampler-ux-5/`, incluindo linked-player.json, wave-handoff.log, interchange-browser.json, as duas capturas dos players e window-waveform.png. O Chrome enumerou fisicamente SMK-37 Pro-Master e SMK-37 Pro-Private. A escuta do proprietário, a resposta de dinâmica e a ergonomia no controlador permanecem pendentes. O ensaio manual está no guia.

Também passaram A/B tocável de mapas completos (uma tecla forte em checkpoint e Official mediu 330 Hz, na Working mediu 550 Hz), sugestão de loop em tom e silêncio, retorno do render aninhado até a gravação de sete minutos e extração de um segundo recorte de 88.200 frames. O cálculo da sugestão de loop leu no máximo 768 bytes por bloco no caso ensaiado. O Chrome repetiu os percursos UX-1 a UX-4, Foundation v1/v2, diagnóstico MIDI, pickup, monitor da DAW, 256 vozes e monitor DSP por três minutos. O relatório DSP contém 181 janelas. O perfil do músico e o upstream são independentes dos perfis e fixtures de teste.
