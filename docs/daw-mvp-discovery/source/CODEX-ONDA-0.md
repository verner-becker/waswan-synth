# Missão do Codex — Onda 0: auditoria e plano de implantação

## Contexto

Você está recebendo o pacote de Discovery do **WASWAN DAW**, workspace integrado ao projeto existente **WASWAN Synth**, com navegador-alvo **Google Chrome Desktop**. É um projeto pessoal para criação musical, não um software empresarial. O usuário quer código ágil e mantível, uma interface musical profissional e abertura para roadmap futuro, sem burocracia ou abstrações artificiais.

**Leia nesta ordem:**

1. `AGENTS.md` **já existente na raiz do repositório**. Respeite instruções atuais; não crie um duplicado.
2. `docs/waswan-daw/README.md` (este pacote, se copiado para essa pasta).
3. `SPEC.md` (requisitos funcionais e testes de aceite).
4. `UX-REFERENCE.md` (imagens e correções explícitas).
5. `ROADMAP.md` (itens **não** autorizados para o MVP).
6. Manual atual `MANUAL-WASWAN-SYNTH.pdf` e código relevante do repositório; manual funcional no commit `04dc1c8`, base SMKSYNTH `3f751bc` segundo o manual. Não pressuponha que a branch checkout corresponde ao manual.

**Objetivo desta onda:** entender o estado real do código e **propor o caminho mais curto e seguro para o MVP**. Não implementar o MVP nesta onda.

## 1. Tarefas de inspeção

### A. Linha de base verificável

- Identificar branch/commit/estado do working tree; **não mudar branch silenciosamente**, não sobrescrever trabalho existente.
- Mapear build, testes, testes de áudio/latência, servidor local e caminhos web/WASM; referenciar arquivos e funções reais.
- Documentar recursos **efetivamente implementados**, limitados ou parciais, incluindo o que funciona na UI mas não no backend.
- Verificar dependências/licenças da base SMKSYNTH, incluindo restrições GPL e bibliotecas relacionadas; não assumir alteração de licença.

### B. Dono do áudio e sincronização

- Quem cria e possui `AudioContext`? Onde roda WASM e DSP? O que acontece ao abrir duas abas e ao fechar a aba proprietária?
- Como o estado de transporte, MIDI, áudio, automação e FX é armazenado e aplicado? Existem relógios concorrentes (Legacy vs Studio)?
- Como garantir **um único dono lógico do motor** com múltiplas vistas/painéis? Comparar alternativas curtas (ex.: host principal + mensagens, worker apropriado quando suportado, etc.) sem assumir solução antes de validar restrições do Chrome/Web Audio.
- Qual contrato de comando/estado deve ser extraído da UI para ser reutilizado por painéis e futuramente MCP?

### C. Escalabilidade instrumental

- Hoje há 4 partes A–D e pool ANALOG de 256 vozes no manual; verificar código real.
- Identificar menor mudança viável para trilhas MIDI instrumentais independentes; avaliar custo de múltiplos patches/instâncias no mesmo motor e estado FX.
- Separar o que é dado MIDI/arranjo, o que é instrumento/DSP e o que é mixer.
- Não prometer polifonia ou número de instrumentos sem benchmark.

### D. DAW/Studio/SEQ e mídia

- Auditar captura de MIDI, importação/decodificação de WAV, MP3, áudio de dispositivo e possível gravação interna.
- Auditar piano roll e suas operações, undo/redo, quantização, envelopes, automação, pipeline de render/MP3/SMF, projeto `.wsproj` e recuperação OPFS.
- Mapear limitações **reais** de duração, fontes e clipes e propor tratamento para músicas completas.
- Verificar como salvar projeto com áudio grande e reabrir fielmente; avaliar versão do formato e possíveis migrações.

### E. UX/Chrome/janelas

- Confirmar a API File System Access **na versão-alvo do Chrome**; estratégia de handles/permissão, escrita segura e autosave local.
- Avaliar abordagem de painéis redimensionáveis/recolhíveis/maximizáveis e destacáveis por botão (mesmo estado, **sem outro motor**).
- Estudar o mínimo necessário para layouts de notebook, 1080p, ultra-wide e vários monitores.
- Projetar scroll/zoom independentes, foco de teclado, gestos de clipe e feedback de status.

### F. Qualidade e engenharia pragmática

- Avaliar estrutura de módulos, contratos e pontos de fragilidade. Não prescrever grandes frameworks.
- Inventariar logging/diagnóstico e monitor DSP já presentes; propor instrumentação útil com custo compatível com áudio real-time.
- Verificar testes existentes e listar **testes de regressão necessários**, priorizando perda de dados, áudio, MIDI, concorrência de janelas e relógio.
- Sugerir atualizações **mínimas** de documentação/`AGENTS.md` para facilitar sessões futuras do Codex.
- Preservar base existente quando possível. Não refatorar por preferência estética.

## 2. Saídas exigidas da Onda 0

Entregar **um relatório objetivo**, com links a paths/linhas reais do repositório:

1. **Inventário**: implementado / parcial / inexistente, alinhado aos capítulos de `SPEC.md`.
2. **Arquitetura atual simplificada**: quem possui áudio, MIDI, transporte, timbres, FX, projeto e UI; gargalos e acoplamentos.
3. **Riscos críticos** (com evidências), especialmente motor único/janelas, multipistas, arquivo com áudio, latência/tempo e FX por trilha.
4. **Proposta de ondas pequenas e testáveis**, com dependências, critérios de saída e pontos de rollback. A divisão sugerida ao final é um **rascunho**, não mandato.
5. **Plano de validação**: build/testes, sessões funcionais J1–J7, medições DSP/recursos.
6. **Trade-offs e decisões pendentes**: mostrar 1–2 opções por risco, justificar recomendação e indicar o que precisa de aprovação antes de mexer.
7. **Visão de futuro discreta**: como preservar pontos de extensão para MCP e LLM sem implementar nenhum deles agora.

O relatório deve ser **legível por humanos e por outro Codex sem histórico de chat**. Evite muralhas de texto, diagramação corporativa ou anexos produzidos sem necessidade. Explique causas e evidências, não apenas opiniões.

## 3. Diretrizes negativas importantes

- **Não sair codificando a DAW inteira nesta onda**.
- **Não atualizar firmware do SMK-37**; este projeto é web.
- **Não quebrar a interface legacy** sem decisão explícita de migração/descontinuação.
- **Não confundir** screenshots conceituais com requisitos exatos ou demonstrações de implementação.
- **Não aumentar escopo** introduzindo IA, sampler completo, Session View, buses, grupos, time-stretch, plugins de terceiros ou novo framework por entusiasmo.
- **Não criar dois processos musicais incoerentes** porque Synth e DAW abriram em janelas distintas.
- **Não usar logs no callback DSP** que prejudiquem tempo real.
- **Não maquiar** testes falhando ou apresentar benchmark não executado.

## 4. Planejamento preliminar sugerido (a revisar)

- **Onda 0:** auditoria e plano, sem mudanças funcionais.
- **Onda 1:** fundação de UX/Arrangement, painéis, zoom, scroll, foco e layout.
- **Onda 2:** modelo de trilhas/instrumentos, transporte/relógio e gravação confiável.
- **Onda 3:** clipes, Piano Roll, undo/redo, MIDI, automação, edição de áudio.
- **Onda 4:** Mixer/FX/Master, import/export/stems e persistência de projetos.
- **Onda 5:** estabilização, auditoria de jornadas, desempenho e regressões.

**Se as dependências técnicas indicarem outra ordem, proponha-a**. O objetivo é alcançar a experiência aprovadas com mínimo risco e código entendível.

## 5. Regra para o próximo Codex

> Se você encontrar um comportamento estranho daqui a seis meses, deve conseguir descobrir a origem, entender a intenção, reproduzir o problema e alterá-lo sem ler uma conversa de 200 mensagens.

Entregue o diagnóstico, apresente o plano e **pare para aprovação humana antes da implementação**.
