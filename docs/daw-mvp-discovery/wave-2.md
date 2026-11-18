# DAW — fase 2: projeto, arquivos e histórico

Branch `feat/daw-wave-2-project`, pai `54b88a8`. Estado: concluída como fundação de domínio/persistência; conexão à UI e ao motor começa na fase3.

Escopo: modelo independente das quatro partes, fontes imutáveis, posições musicais/absolutas, comandos transacionais com revisão, Undo/Redo que conserva áudio, arquivo v3 portátil com migração de v1/v2, Save/Save As por handle e recuperação OPFS separada. Sem mudanças no motor ou transporte nesta fase.

Critérios: rejeitar importação inválida antes de substituir projeto; roundtrip conserva bytes/timbres/dados; Undo de remoção/substituição conserva assets; escrita falha não marca documento salvo; edição concorrente durante Save permanece dirty; dois escritores locais não se sobrepõem. Validar módulo sem DOM e comportamento de persistência no Chrome. Seletor nativo depende de interação real e não será certificado por mocks.

## Implementação e decisões

- `daw-project.js`: trilhas tipadas com IDs, clipes ancorados em ticks ou segundos, fontes, instrumentos, FX, Master, marcadores e automação Volume/Pan. Orçamento explícito: 32 trilhas lógicas, 32 fontes, 512 clipes, 65.536 notas, fontes de até20min e total de30min PCM estéreo/44,1kHz. Isso não promete32 instrumentos simultâneos; a capacidade real do motor será medida na fase3.
- `daw-controller.js`: comandos com `projectId`, ID idempotente e revisão esperada; batches atômicos, Undo/Redo com retenção dos Blobs/Files e coleta só quando histórico libera referência. Histórico limitado a64 entradas/32MiB de metadados; cache de comandos também limitado. Snapshots e Map externo são cópias, não uma porta para alterar o estado por fora.
- `daw-format.js`: arquivo portátil `WASWAN-DAW-3`, manifesto limitado e fontes WAV canônicas concatenadas, com CRC32 por fonte e identidade nova por escrita. CRC detecta corrupção acidental, não autentica autoria. Migração de v1/v2 remapeia IDs, conserva bytes e o projeto original em `legacy`; nomes vazios válidos recebem fallback. Dados Legacy de expressão/FX ainda exigem adapter de playback.
- `daw-files.js`: Open/Save/Save As via handles, exclusão de escritores na origem, detecção de revisão do arquivo, abort em falha e dirty baseado no documento realmente salvo. Cancelar substituição não troca o destino de Save. Recovery/Autosave é separado e não limpa dirty do arquivo do usuário.
- Recuperação: subdiretório por projeto, áudio imutável escrito uma vez e gerações pequenas `.wsmeta`. Conservar a geração anterior validada, não simplesmente o segundo nome mais recente. Uma geração corrompida não pode expulsar o fallback íntegro. Fontes antigas de recuperação ficam retidas até limpeza explícita do projeto; quota gera erro, não apagamento silencioso de áudio.
- `daw-assets.js`: no Chrome, importar fontes para arquivos OPFS privados e imutáveis; não depender do arquivo portátil depois que ele for sobrescrito. O resultado de Open/Recover tem `dispose()`: chamá-lo só quando controller/export deixam de usar suas fontes. Lease Web Lock por diretório protege caches ativos; imports órfãos de documentos encerrados podem ser limpos sem tocar na recuperação.

## Investigação de Blobs grandes

O primeiro desenho fazia cópias imutáveis em Blobs. Na carga de cinco fontes de300s, o arquivo foi escrito e todos os checksums de origem passaram, mas a quinta cópia ficou ilegível (`NotReadableError`). Cópia em chunks, cópia contígua e perfil temporário persistente repetiram a falha. Cinco fontes originais + cinco cópias somam529.200.440 bytes, ligeiramente acima de500MiB; limite do backend de Blobs é hipótese forte, não causa confirmada. Não foi falta geral de RAM demonstrada.

A alternativa OPFS passou com as cinco fontes, tanto em perfil persistente temporário quanto privado. O caminho de produção Open/Recover usa essa alternativa. O fallback de cópia em memória permanece para testes sem navegador e lê um slice da cópia antes de retornar, para rejeitar um asset já ilegível antes da substituição do projeto.

Sondagem reproduzível: `node tests/browser-daw-project-load.mjs`; variante de perfil privado `DAW_LOAD_PRIVATE=1`. Para investigar a abordagem rejeitada, `DAW_LOAD_COPY=1` força cópias em Blobs; esse modo pode falhar deliberadamente no ambiente descrito e não é o caminho de produção.

## Validação em fechamento

Relatórios em `.local/validation/daw-mvp-wave-2/`. Snapshot instrumental aqui é um contêiner de80 bytes; a API host da fase3 deve validar tags/escalas integralmente antes de aplicar. Nenhum arquivo é executável. Estes módulos ainda não estão conectados à experiência de produção da DAW; a próxima fase entrega a primeira fatia musical.

## Fechamento — 18/11/2026

- **Implementado:** modelo/comandos/histórico, arquivo portátil com integridade e migração, handles com Save/Save As, recuperação incremental e cache imutável OPFS. Nenhuma alteração no motor, firmware, polifonia ou comportamento do Studio existente.
- **Node:** passaram11 suites dirigidas: daw-project, daw-format, daw-files, daw-session, daw-outputs, studio-format, studio-audio, studio-sequence, studio-context, studio-arrangement e studio-clock. As três novas cobrem conflitos de revisão/projeto/ID, rollback de batch, bytes mantidos por Undo/Redo, dirty com Save concorrente, permissão/quota/write/commit injetados, cancelamento, checksum e migração v1/v2 com IDs/nomes históricos.
- **Chrome:** passaram escrita/abort OPFS, import que sobrevive à substituição do arquivo original, recuperação após reload, leases de cache, projeto com prefixo semelhante, G1 íntegra/G2 corrompida/G3 nova, índice corrompido seguido de novo autosave e lock compartilhado entre leitura de recuperação/escrita. Revisão Sol identificou os riscos de limpeza e concorrência; foram corrigidos e testados antes do fechamento.
- **Carga:** cinco fontes de300s, oito trilhas lógicas, arquivo264.604.719 bytes,32 Undo e remoção/restauração de fonte grande passaram em perfis privado e persistente. O ensaio com recuperação incremental levou~11,65s no total; o segundo autosave levou~15,2ms e preservou tamanho/data dos cinco arquivos de áudio. Nenhuma reprodução musical foi medida nessa suite.
- **Limites:** seletor nativo interativo não testado; OPFS usa métodos reais, enquanto pickers/permissões são injetados nas suites apropriadas. Não há validação Windows/macOS/hardware, crash de processo durante commit nem quota fisicamente esgotada. Exclusão é por origem/perfil Chrome; não promete CAS atômico contra outro aplicativo externo. Fontes antigas de recuperação continuam retidas até limpeza explícita. Validação musical do patch será responsabilidade integral da API host na fase3.
- **Decisões:** rejeitar a abordagem de duplicar todo áudio como Blobs no Chrome; usar arquivos OPFS imutáveis com dono e descarte explícitos. Manter cópia portátil independente, autosave incremental e fallback validado por varredura mesmo com índice perdido. Recuperar usa o mesmo lock do autosave e só troca o vínculo do arquivo após aceitação.
- **Próximo passo:** prova e integração de instrumentos independentes em uma instância, pool256 preservado, primeiro arranjo com Save → fechar → reabrir → ouvir. Não integrar na main.
