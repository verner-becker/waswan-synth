# WASWAN DAW — controle do desafio

Data: 2026-11-17. Base conferida por fetch: `8575f766df9043d53c51265e1fdc68c97cb61189` (`main` e `origin/main`). Branch desta análise: `docs/daw-mvp-wave-0`.

## Fontes e prioridade

O [pacote original](source/README.md) foi extraído de `/home/vernerb/Downloads/WASWAN-DAW-MVP-Discovery.zip`, preservando os cinco documentos e as quatro imagens. Não foi editado. [SPEC](source/SPEC.md) define o produto; [UX](source/UX-REFERENCE.md) explica as imagens; [ROADMAP](source/ROADMAP.md) permanece fora do MVP. [Relatório e plano](assessment.md).

ZIP SHA-256: `b3e09df9e4e73f45192f5a6ef216cf12255d64d49793ab32648699172c6e32f7`. Os nove arquivos extraídos foram conferidos byte a byte.

Esta série DAW é distinta das ondas Studio 0–5 já integradas. O histórico Studio continua em [studio-waves.md](../studio-waves.md).

## Orientações do usuário nesta sessão

- Analisar, trazer considerações e discutir como organizar antes de implementar. O pacote também exige aprovação humana após o diagnóstico.
- Uma branch por fase, empilhada sobre o fechamento da anterior. A primeira parte da main atualizada; as seguintes herdam seus commits. Isto substitui, para esta série, iniciar cada fase novamente da main.
- Pode consultar um assessor **GPT-6.1 Sol, extra high (`xhigh`)** para dúvidas e revisão do planejamento. Assessment consultivo; o agente principal continua responsável pelas decisões e verificações.
- Se entrar em loop sem solução, interromper a frente bloqueada, preservar trabalho e evidências e trazer o problema ao usuário. Não insistir indefinidamente nem trocar a arquitetura silenciosamente.
- O trabalho noturno é uma intenção a ser delimitada nesta conversa, não autorização já concedida para implementar todo o MVP ou promessa de conclusão em uma noite.
- Não integrar na main, ampliar polifonia ou alterar capacidades DSP sem aprovação explícita. O Discovery pede capacidades novas; a implementação e sua estratégia ainda precisam ser acordadas.

## Protocolo de execução proposto

Antes de cada fase: anotar escopo, branch, SHA pai e critérios de saída. Durante: commits pequenos, validação dirigida ao risco, evidências em `.local/validation/daw-mvp-wave-N/`. No fechamento: implementado, validação realmente executada, limitações, decisões, SHA final e próximo passo. Commitar e publicar a branch; só então criar a próxima a partir daquele fechamento. Nenhuma integração automática, squash, tags ou remoção de branches empilhadas.

Uma hipótese que falha só justifica outra tentativa com evidência ou abordagem nova. Se a mesma falha reaparecer sem avanço, registrar reprodução, tentativas, alternativas e decisão necessária; parar a dependência. Uma falha crítica de áudio, recuperação ou integridade impede declarar a fase concluída.

## Estado

| Etapa | Estado |
|---|---|
| Recebimento e leitura | Concluído; ZIP e imagens preservados |
| Inspeção do código/manual e baseline dirigido | Registrados no relatório; alcance e limites explícitos |
| Assessment Sol 6.1 xhigh | Consultado nesta sessão; síntese no relatório |
| Plano e decisões de arquitetura | Propostos para discussão |
| Implementação funcional DAW | Não iniciada; aguarda fechamento do escopo |

Ao retomar: ler este controle, o relatório, AGENTS.md e o pacote; conferir Git e a última evidência. Não interpretar sugestões do assessor nem o backlog como autorização.
