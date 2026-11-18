# Etapa 1 da evolução de UX do WASWAN

Base `dfa6e1b` em `main`. Implementação em `feat/ux-stage-1-synth-shell`, para revisão antes da próxima etapa. [Plano de evolução](ux-evolution-plan.md)

## Entrega

- A navegação agrupa **Performance** e **TONES** no Synth, coloca **Open DAW in new tab** junto à DAW e mantém **SEQ**, **Studio** e **Legacy SMK** em uma área secundária. Os editores de osciladores, filtro, envelopes, modulação e efeitos compartilhados ficam nos grupos implementados de TONES. O **Mixer da DAW** e os **níveis das partes do Synth** têm contextos próprios.
- **Settings** reúne porta MIDI, atribuições, ferramentas de sessão e entrada de **Diagnostics**. O MIDI Setup oferece **Use keyboard & pads** na Performance e posiciona o foco na primeira tecla virtual. Outros workspaces permitem continuar e conectar o controlador depois.
- Teclado e pads vêm logo após os controles de Performance. Osciloscópio e níveis compartilham o painel de saída. O painel de instrumento preserva pattern, sustain e os modos de voz. **MIDI assignments** mostra as ações de mapeamento sob demanda. Pickup aparece com texto e cor quando um controle absoluto conectado espera sincronização. As dicas de ajuste dos knobs são visíveis e ligadas aos sliders por descrição acessível.
- A iconografia usou o símbolo de teclado já existente junto ao rótulo Performance. Botões com texto permanecem identificáveis. Contorno indica foco, realce turquesa indica seleção e texto âmbar identifica espera de pickup. O sinal vermelho da gravação pertence à etapa 3.

## Validação executada

| Ambiente | Resultado |
|---|---|
| Chrome Desktop, tela emulada Full HD, zoom real 100% | Área útil de 1920×937. Teclado em y=583–711 e pads em y=593–668, com rolagem zero. Tocou uma nota por Enter e soltou a nota ao soltar a tecla. |
| Chrome Desktop, mesma tela, zoom real 125% | Área útil de 1536×750. Teclado em y=581–709 e pads em y=593–668, com rolagem zero. Tocou e soltou uma nota, editou cutoff e concluiu Save as e Save com confirmação de escrita no navegador. |
| UI Foundation e Tone Editor no Chrome | Navegação com notas e sustain mantidos, mesma instância e mesmos nós de teclado e pads. Passaram MIDI Learn, pickup, conexão opcional, modos de voz, sessão exportada e reimportada, DSP Monitor com exportação JSONL, edição ANALOG, Save e Save as, falha de armazenamento e recuperação. |
| DAW e Studio no Chrome | Passaram aceite do MVP, sessão compartilhada e retorno durante reprodução, captura interna, Monitor MIDI, navegação entre workspaces e sequência Studio. |
| Node | Passaram UI Foundation, Tone Editor, perfil MIDI, MIDI contextual e polifonia de 256 vozes. O teste de referência comparou 256.000 amostras e preservou igualdade bit a bit. |

Evidências em `.local/validation/ux-stage-1/`, `.local/validation/ui-foundation/`, `.local/validation/ui-foundation-v2/` e `.local/validation/tone-editor-v1/`. As capturas `performance-100.png`, `performance-125.png` e `tones-filter-125.png` registram o layout com zoom real. O release e o foco foram exercitados com teclado virtual e MIDI sintético. Aceite com o SMK-37 Pro físico e leitor de tela segue pendente.

A próxima revisão é a etapa 2, **Arrangement e edição de clipes**.
