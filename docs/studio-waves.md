# WASWAN Studio — controle das ondas

Novo desafio em análise: [WASWAN DAW MVP — controle, orientações de autonomia e branches empilhadas](daw-mvp-discovery/README.md). Série separada das ondas Studio abaixo; a autorização histórica do Studio não aprova automaticamente sua implementação.

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
