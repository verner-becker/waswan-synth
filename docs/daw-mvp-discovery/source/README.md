# WASWAN DAW — Pacote de Discovery para o Codex

**Status:** especificação de produto e referência de UX para auditoria técnica (Onda 0).  
**Data do Discovery:** 17/11/2026.  
**Idioma:** português brasileiro.  
**Produto:** WASWAN Synth + workspace DAW; **não é um produto ou repositório separado**.

## Comece por aqui

1. **`CODEX-ONDA-0.md`** — instruções para a **primeira tarefa**, que é auditar e propor um plano. Não implementar ainda.
2. **`SPEC.md`** — fonte de verdade dos requisitos funcionais, decisões e critérios de aceite do MVP.
3. **`UX-REFERENCE.md`** — referências visuais e, mais importante, o que é e o que **não é** válido nos mockups.
4. **`ROADMAP.md`** — funcionalidades conscientemente adiadas; não incluir no MVP por iniciativa própria.
5. **`assets/`** — imagens referenciadas pelos arquivos Markdown acima; **permanecem dentro deste pacote**.

O repositório do projeto **já possui `AGENTS.md`**. Leia e preserve-o. Não criar outro por padrão. Consulte também `MANUAL-WASWAN-SYNTH.pdf` e a documentação existente **no repositório** como linha de base da implementação real, sem tratá-los como a especificação da experiência futura. Manual de referência: **commit `04dc1c8`**; base SMKSYNTH documentada em `3f751bc`.

## Regras de interpretação

- **Requisito funcional aprovado** (`SPEC.md`) prevalece sobre sugestões visuais geradas por IA.
- **Decisão mais recente** prevalece sobre uma sugestão histórica anterior. Ex.: Sampler completo foi discutido inicialmente como MVP, mas foi **adiado explicitamente** em favor de estabilizar a DAW primeiro.
- **MVP** significa uma experiência realmente utilizável de composição, edição, gravação, mixagem e exportação — não uma coleção de botões demonstrativos.
- **Não presumir capacidade** só porque o manual antigo descreve uma função similar; auditar o código e testar.
- **Onda 0 é somente diagnóstico e plano**. Não abrir uma grande frente de refatoração sem discutir as consequências.

## Propósito

Laboratório musical **pessoal** — sem intenção de comercialização. O objetivo é criar músicas simples e completas e produzir trechos autorais, instrumentos, solos, acompanhamentos e stems para desenvolver músicas no Suno. O software deve ser agradável de tocar, editar e explorar. Engenharia pragmática, desempenho, legibilidade e facilidade de manutenção pelo **Codex do futuro** são critérios de qualidade.

**Alvo do MVP:** Google Chrome **Desktop** em Ubuntu, Windows e macOS. Não desenvolver compatibilidade para Firefox, Safari ou navegadores mobile. Não implantar backend em nuvem ou dependência de LLM para a DAW funcionar.

## Entrega deste ZIP

Este pacote é **autocontido quanto às decisões e imagens do Discovery**, mas não substitui uma auditoria do código-fonte atual. Imagens são conceituais; nenhum screenshot é evidência de recurso já implementado.
