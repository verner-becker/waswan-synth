# Parecer do Astra sobre a interface do Synth e da DAW

GPT-6.2 Astra, high. Auditoria da branch de aceite do MVP em `21bd5bc`, no Chrome em Linux, com perfil temporário e telas emuladas. As capturas, medições JSON e roteiros estão em `.local/validation/ux-daw-astra/`. Os nomes de arquivo abaixo identificam as evidências nessa pasta.

A DAW já permite compor, gravar, reabrir o projeto e exportar áudio. Eu começaria o redesenho pela primeira tarefa musical. **Ao criar um clipe MIDI, o músico deve ver e poder editar sua primeira nota.** Hoje, em 1920×960 úteis, o Piano Roll começa em `y=983`, abaixo do limite inferior do editor em `y=931`. Expandir o editor revela a grade, mas exige que o usuário descubra a solução. Evidências `05-midi-clip.png` e `07-piano.png`.

| Etapa | Saúde | Evidência |
|---|---|---|
| 1. Iniciar e tocar | Funcional. O diálogo aceita continuar sem controlador. A navegação oferece 13 destinos antes de o usuário tocar. | `02-midi-setup.png` |
| 2. Editar e salvar ANALOG | O editor reúne sete grupos e o Save as informa o programa que será sobrescrito. Abas globais como FILTER e MIX levam a superfícies planejadas, enquanto TONES já oferece um filtro funcional. | `33-tones-filter.png`, `34-tones-save-as.png` |
| 3. Criar pista, clipe e nota | Criação funcional. A grade fica escondida sob comandos e campos. O estado ainda orienta iniciar o áudio e criar uma pista depois de ambas as ações. | `05-midi-clip.png` |
| 4. Armar, gravar e parar | Gravei a saída interna e obtive um clipe. A entrada e o modo de monitoramento ficam no painel chamado Browser, inicialmente recolhido. Em Full HD útil, foi preciso rolar dentro dos seus 220×286 px para revelar a origem. | `13-routing-input.png`, `15-recorded.png` |
| 5. Editar e mixar | Piano Roll e waveform têm ampliação. O Mixer do projeto e o MIX global têm o mesmo nome acessível. O segundo conduz a uma tela planejada. Automação precisa de edição dos pontos por teclado. | `09-mixer.png`, `10-daw-mixer.png` |
| 6. Abrir, salvar e exportar | Importei um WAV de 176.444 bytes, salvei e reabri o projeto com o clipe e exportei um WAV de 1.764.044 bytes. Usei os botões reais com arquivos em OPFS e seletores de destino simulados. | `36-reopened.png`, `workflow.json` |
| 7. Destacar e devolver | A DAW e o Mixer voltaram ao mesmo projeto. O Mixer perde o tema mesmo depois de carregar as 401 regras CSS. Em 3440×1440, destacar a DAW reduz a largura do arranjo de 3127 para 1287 px. O botão de teclado na aba filha exibe o teclado no host. | `38-mixer-css-loaded.png`, `26-ultra-detached.png` |
| 8. Configurar e diagnosticar | Settings, diagnósticos e perfis contextuais existem. Configuração de porta, atribuição de controle, contexto de foco e roteamento da pista estão espalhados. Os separadores responderam às setas, `?` abriu ajuda e Espaço iniciou e parou a DAW com foco no separador. | `30-settings.png`, `29-diagnostics.png` |

## Ordem recomendada pelo Astra

1. **Dar prioridade ao Synth e à DAW.** Colocar Performance e edição de timbre no Synth. Abrir diretamente o grupo existente ao escolher Osciladores, Filtro ou Envelopes. Na DAW, manter projeto, transporte e posição perto do arranjo. Abrir a grade ou a waveform ao selecionar o clipe, com propriedades exatas sob demanda.
2. **Tornar a gravação legível na pista.** Exibir destino, entrada, monitoração, armar e modo de substituição no mesmo contexto. Colocar marcadores na timeline e configuração de controladores em Settings. Dar aos botões M/S/R, hoje com apenas 19–20 px de largura, nomes e dicas acessíveis também por foco.
3. **Corrigir o layout e as janelas antes de refinamentos estéticos.** Full HD deve comportar arranjo e edição simultânea. Em espaço curto ou zoom alto, alternar entre arranjo e editor mantendo o transporte alcançável. No ensaio de zoom real a 200%, a viewport tinha 960×468 CSS px e o arranjo só começava em `y=653`. No ultrawide, liberar a largura na aba separada e oferecer disposição lateral opcional. Evidência `32-200-real-chrome-zoom.png`.
4. **Remover a experiência Legacy com paridade musical verificável.** Há dependências concretas de Power, Mute, Panic, teclado, pads, bancos e handlers originais. Mapear também DRUM-X, patterns, split/layer, rodas, faders, mixer de partes e saída de MIDI MODE. O teste de retirada deve sustentar notas e pedal enquanto se alternam superfícies e comprovar a continuidade da instância, das 256 vozes, dos mapeamentos e do pickup. [Shell](../web/ui-foundation.js) · [Integração de foco e MIDI](../scripts/stage-simulator.sh)
5. **Consolidar o Studio após comparar projetos antigos.** O importador já converte notas, áudio e automação de nível/pan. Expressão, FX compartilhados e outras lanes permanecem guardados no projeto original sem equivalência integral no playback DAW. Preservar gravador rápido, tomada de referência, log, snapshot e recuperação. O critério de saída é reabrir projetos representativos, comparar seu resultado musical e identificar qualquer dado ainda dependente do Studio. [Migração](../web/daw-format.js) · [Semântica da automação Studio](studio-wave-4.md)

## Observações complementares do Astra

- Manter a identidade escura. Usar vermelho acompanhado de texto para gravação ativa. Usar nomes distintos para Mixer de partes e Mixer do projeto, e dar dicas de mouse e foco a M/S/R, volume, pan e reordenação. Distinguir papel musical, tipo técnico MIDI/Audio e nome da pista.
- Uma tela física emulada de 1920×1080 apresentou 1920×937 úteis a 100% e 1536×750 a 125% de zoom real. Em 1920×960, a timeline tinha altura de 235 px e o editor inferior de 260 px. Evidências `32-100-real-chrome-zoom.json`, `32-125-real-chrome-zoom.json` e `05-midi-clip.json`.
- A janela do Mixer carregou a folha de estilos, mas seu `body` ficou sem a classe que define os tokens. A aba DAW tem os tokens e fica limitada a 1.600 px. O teclado solicitado pela aba DAW aparece no host. Evidências `38-mixer-css-loaded.png`, `workflow.json`, `40-keyboard-request-child.png` e `41-keyboard-host.png`.
- A automação Studio mantém o último valor ao parar. A DAW restaura o valor-base. A migração de arquivo preserva fontes, eventos e contexto mesmo quando a reprodução ainda difere. [Automação Studio](studio-wave-4.md) · [Migração DAW](../web/daw-format.js)

Permanecem pendentes as provas com controlador físico, leitor de tela, seletor nativo de arquivos e movimentação entre monitores reais. A auditoria terminou com o checkout limpo. O [plano de etapas](ux-evolution-plan.md) registra as entregas e os critérios posteriores.
