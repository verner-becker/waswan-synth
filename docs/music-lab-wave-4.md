# Music Lab · W4

O catálogo ganhou **Progressão pop**, **Acompanhamento pop** e **Improvisação pentatônica**. Em **Acompanhamento**, escolha metrônomo, baixo e pulso, ou baixo, acordes e pulso. Para estudar a mão direita com a parte grave do Lab, escolha **Direita** em **Mãos** e **Baixo e pulso**. A cifra mostrada segue o transporte do acompanhamento. Nas atividades guiadas, a pauta avança pelos ataques aceitos e o pulso serve de referência.

Em **Improvisação pentatônica**, toque uma pergunta, faça uma pausa e responda. O painel descreve extensão, direção, pausas, intervalos repetidos e faixa de velocity. Quando a relação de relógio permite, também descreve notas do acorde e tensões. Cromatismos são aceitos. Escolha **Gravar notas desta frase** antes da captura para habilitar escuta A/B e **Salvar tomada para DAW**. A análise descritiva funciona com a gravação desligada.

## Integração

O acompanhamento usa o relógio e proprietário de notas da prévia. O metrônomo reutiliza o processador de clique da DAW no mesmo AudioContext, com estado de transporte próprio. O nível muda o ganho do clique e a velocity dos ataques harmônicos. Silenciar solta as notas do acompanhamento e mantém seu pulso interno. Caudas e resposta à velocity dependem do timbre atual. O modo harmônico usa acordes e clique como seção rítmica.

O observador recebe somente a entrada externa já distribuída pelo controlador. Em improvisação, a referência harmônica depende do timestamp de saída e é omitida perto de mudanças de acorde. DAW, Legacy, Studio, Fusion e panic conservam prioridade. As até duas tomadas A/B ficam na aba, com até 256 notas completas por tomada quando a gravação está ligada. A cópia `.wsproj` cria um projeto v4 independente com pistas MIDI editáveis. Os ticks da frase são convertidos de 480 para 960 e o timbre é selecionado ao abrir a cópia na DAW.

## Validação

`tests/music-lab-backing.test.mjs` verificou padrões, relógio, silêncio, descritores e ida e volta de uma cópia DAW. `tests/browser-music-lab-backing.mjs` confirmou clique audível, Synth único, notas ao vivo preservadas, cromatismo aceito, gravação opt-in, reescuta e cópia aberta pelo leitor nativo. O navegador também exerceu a prática de mão direita sobre o baixo. As regressões do transporte da DAW e do Music Lab conferem as ondas anteriores. Relatório e captura em `.local/validation/music-lab/`.

O ensaio físico segue pendente. A [W5](music-lab-wave-5.md) acrescenta estudos de ouvido, conteúdo avançado e refinamentos de acessibilidade.
