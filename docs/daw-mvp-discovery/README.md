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
- Após a apresentação do diagnóstico, o usuário autorizou: “proceda fase a fase, vou dormir”, até 18/11/2026 às 07:30 America/Sao_Paulo (10:30 UTC). Pode parar diante de bloqueio ou decisão que deva caber ao usuário. Sua eventual visita durante a madrugada não é dependência de execução.
- A autorização cobre as fases propostas e adaptações de host/DSP necessárias ao MVP, preservando uma instância, upstream e pool global de 256. Não integrar na main nem ampliar polifonia. Multi-instância, redução dos requisitos e continuidade transparente ao fechar o host não foram decididas; parar a dependência se forem necessárias.

## Protocolo de execução proposto

Antes de cada fase: anotar escopo, branch, SHA pai e critérios de saída. Durante: commits pequenos, validação dirigida ao risco, evidências em `.local/validation/daw-mvp-wave-N/`. No fechamento: implementado, validação realmente executada, limitações, decisões, SHA final e próximo passo. Commitar e publicar a branch; só então criar a próxima a partir daquele fechamento. Nenhuma integração automática, squash, tags ou remoção de branches empilhadas.

Uma hipótese que falha só justifica outra tentativa com evidência ou abordagem nova. Se a mesma falha reaparecer sem avanço, registrar reprodução, tentativas, alternativas e decisão necessária; parar a dependência. Uma falha crítica de áudio, recuperação ou integridade impede declarar a fase concluída.

## Estado

| Etapa | Estado |
|---|---|
| Recebimento e leitura | Concluído; ZIP e imagens preservados |
| Inspeção do código/manual e baseline dirigido | Registrados no relatório; alcance e limites explícitos |
| Assessment Sol 6.1 xhigh | Consultado nesta sessão; síntese no relatório |
| Plano e decisões de arquitetura | Ordem aprovada; decisões rotineiras dentro do escopo delegadas |
| Fase 1 | Concluída como provas limitadas; [fechamento](wave-1.md). Branch `feat/daw-wave-1-session`, fechamento `54b88a8` |
| Fase 2 | Concluída como domínio/persistência: [fechamento](wave-2.md), `feat/daw-wave-2-project`, fechamento `29efef6` |
| Fase 3 | Concluída como fatia instrumental: [fechamento](wave-3.md), `feat/daw-wave-3-instruments`, `b61eea6` |
| Fase 4 | Concluída como Arrangement/transporte: [fechamento](wave-4.md), `feat/daw-wave-4-arrangement`, `aa6f21f` |
| Fase 5 | Concluída como gravação/Monitor: [fechamento](wave-5.md), `feat/daw-wave-5-recording`, fechamento `b6fbc2f` |
| Fase 6 | Concluída como editores/importação: [fechamento](wave-6.md), `feat/daw-wave-6-editors-import`, fechamento `6ea5dff` |
| Fase 7 | **Parcial**: FX, automação Volume/Pan e exportação MIDI implementados; WAV/MP3/stems pendentes. [Entrega e retomada](wave-7.md), `feat/daw-wave-7-mix-export`, pai `6ea5dff` |
| Fases 8–9 | Pendentes: janelas/foco/perfis, estabilidade prolongada, limpeza e manual |

Decisões de trabalho iniciais: host em documento com posse exclusiva por Web Locks; fechar o host interrompe áudio, sem failover automático ou promessa de continuidade. Carga inicial de prova: cinco minutos, três trilhas instrumentais e cinco de áudio; não representa limite suportado certificado. Stems propostos pós-FX/fader/pan da trilha e pré-Master, para validar na fase de exportação. Caso uma dessas escolhas não sustente os requisitos, trazer evidência ao usuário.

Ao retomar: ler este controle, o relatório, AGENTS.md e o pacote; conferir Git e a última evidência. Não interpretar sugestões do assessor nem o backlog como autorização.

## Entrega da sessão — 18/11/2026, limite 07:30

Fases0–6 fechadas e branches publicadas em sequência. Fase7 preservada como entrega parcial na branch acima; o MVP completo não está concluído. Main continua em `8575f766df9043d53c51265e1fdc68c97cb61189`, sem integração. Upstream continua em `3f751bc2be066414f204cf44e1aa05d9c7467d7f`. Não houve alteração de polifonia nem segunda instância de instrumento.

Retomar **na fase7**, pelo handoff, antes de abrir a8: implementar exportação de áudio com render/cancelamento/limites/caudas e fidelidade ao mix; validar mix/range/trilha/stems WAV/MP3 e só então fechar a fase. A branch8 deve nascer do futuro fechamento integral da7. Evidências locais de cada fase ficam em `.local/validation/daw-mvp-wave-N/` (ignoradas pelo Git); testes e registros de resultados estão versionados. O PDF oficial permanece o da main; manual DAW atualizado faz parte da fase9.
