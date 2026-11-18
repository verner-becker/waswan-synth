# WASWAN — Roadmap separado do MVP

**Status:** estacionamento de ideias, **não é backlog autorizado para implementação imediata**.  
**Prioridade:** ainda **não definida**. O usuário decidiu priorizar após a DAW estar funcional e estabilizada.

## Sequência aspiracional de evolução

1. **MVP da DAW** — compor, gravar, editar, mixar e exportar com qualidade, estabilidade e boa UX.
2. **“Olhos e ouvidos” do Ash** — capacidade de analisar MIDI/áudio/ritmo/espectro/harmonia e oferecer diagnósticos fundamentados; análise determinística primeiro, modelos externos ou locais apenas onde acrescentarem valor.
3. **Sampler e capacidades selecionadas de produção** — instrumento tocável a partir de pequenos WAVs, one-shot e pitched, depois slicing/multisampling e Instrument Builder (inclusive escala gerada no Suno, com correções humanas de afinação/corte).
4. **Refinamento do WASWAN Synth** — UX em drill-down, módulos de síntese e recursos instrumentais novos, eliminando dependência visual do legado.
5. **Módulo educacional integrado** — aprender teoria musical, interpretação e engenharia de áudio durante composições e exercícios, com explicação, experimentação, escuta e retorno.

Essa é uma visão geral, **não um cronograma**, e a priorização poderá ser revista conforme resultados reais.

## Produção musical e edição

- Session View / grade de performance por clipes (não é prioridade; o usuário prefere Arrangement).
- Gravação multitrilha simultânea e roteamento avançado de várias entradas.
- Punch In/Out automático e take management/comping.
- Time-stretch / warp de áudio ao mudar BPM, preservando afinação.
- Ripple editing avançado, quando fizer sentido e sem alterar o comportamento padrão não-ripple.
- Pastas/grupos de trilhas com mixer, Mute/Solo e faders de grupo.
- Buses auxiliares, sends/returns e roteamento arbitrário.
- Biblioteca de presets de **cadeias de FX** independentes, presets de gravação e templates de projetos.
- Captura de automação ao vivo por movimentos de faders/knobs MIDI; parâmetros de FX e instrumentos em lanes adicionais.
- Calibração automática de latência.
- Arrastar áudio diretamente de outros aplicativos ou websites, se houver caso de uso real; drag do gerenciador de arquivos já é desejável no MVP se trivial.
- Integração direta **Send to Suno**, somente após estudar a plataforma e o valor real.
- Renderização/bounce offline isolada, stems avançados, normalização/loudness e fluxos de masterização quando houver necessidade demonstrada.

## Instrumentos, síntese e sampler

- **Sampler básico:** importar/capturar pequeno trecho e tocar em One-shot ou Pitched usando MIDI; envelope de amplitude e FX da trilha.
- **Slicing:** mapear diferentes cortes de uma fonte para notas/pads.
- **Multisampling/Instrument Builder:** analisar notas e ataques de uma escala, identificar root pitch, separar e mapear samples; validação manual para material gerado pelo Suno.
- **Arpejador na DAW:** o motor Legacy já possui arp, mas a DAW ainda precisa de integração coerente ao transporte e da opção de **transformar o resultado em MIDI editável**. Não confundir existência do arp legado com gravação das notas geradas.
- Rotary Speaker/Leslie para órgão, Amp/Cabinet Simulator, Flanger.
- Phaser e Tremolo se não couberem facilmente no MVP.
- Editor modular com roteamento visual de síntese, mais LFOs/envelopes/vozes e avanços de DSP conforme testes reais.
- Instrumentos com capacidades especializadas, como Hammond tocável e sons de guitarra expressiva, baseados em mecanismos adequados (síntese, sample, modelagem física etc.) após Discovery próprio.
- Perfis MIDI **pré-definidos** distribuídos no produto, construídos a partir dos mapeamentos locais testados em SMK-37 Pro, Casio XW-P1, CT-S1000V, Arturia MiniLab 3 e outros controladores.

## Assistência musical / “olhos e ouvidos”

- Extração determinística de características mensuráveis: notas MIDI, envelope, BPM estimado, onset, picos, clipping, espectro, balanço tonal, RMS e métricas adicionais corretamente definidas.
- Exportação de relatórios acessíveis ao assistente, com evidências suficientes para analisar áudio sem inventar o que foi ouvido.
- Integração com MCP (Model Context Protocol) como ferramentas de projeto, MIDI, instrumentos, gravação, diagnóstico e exportação.
- LLM interna/local opcional para explicações, propostas de exercícios, interpretação harmônica e ensino; nunca como dependência do callback DSP.
- Registro de comandos do agente com confirmação para ações destrutivas, Undo e rastreabilidade do que mudou.

## WASWAN Academy — módulo educacional

- Aulas curtas e contextuais **durante a criação de música**, não curso separado obrigatório.
- Escalas, intervalos, acordes, inversões, funções harmônicas, arpejos, ciclo das quintas, progressões, transposição e desenvolvimento de melodias.
- Ritmo, expressão, quantização humana, timbre, arranjo, gain staging, equalização, dinâmica e engenharia de áudio.
- Exercícios tocáveis com avaliação de MIDI e, quando tecnicamente consistente, análise de áudio.
- **Partitura a partir de MIDI**, com limitações rítmicas e de notação adequadamente tratadas.
- Explicação acompanhada por demonstração musical dentro do WASWAN, sem substituir a autoria e a interpretação do usuário.

## Regra de priorização futura

Só após estabilizar o MVP, ordenar propostas por: **valor musical real**, repetição de uso, custo de implementação/manutenção, risco de regressão e oportunidades de aproveitar código já existente.

> Nada aqui autoriza o Codex a construir um laboratório de IA ou reescrever o sintetizador enquanto a DAW básica não estiver estável.
