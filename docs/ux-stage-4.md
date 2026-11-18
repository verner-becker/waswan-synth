# Etapa 4 da evolução de UX do WASWAN

Implementada em `feat/ux-stage-4-daw-windows` sobre `6686a1f`. [Plano de evolução](ux-evolution-plan.md)

A aba ligada da DAW usa a largura disponível. O Mixer, editor de clipes, efeitos e automação continuam destacáveis, com os mesmos tokens de tema da DAW. O menu **View panels** oferece editor à direita a partir de 2100 px úteis, com largura ajustável por divisor e setas. A preferência se mantém ao redimensionar e volta ao arranjo vertical quando o espaço lateral fica insuficiente. Janelas curtas mostram botões para alternar entre Arrangement e editor.

A aba indica **Audio host · Synth tab**. **Focus Synth keyboard** leva ao teclado no Synth. Ações de retorno restauram a DAW e o foco em um controle visível. A aba e os painéis continuam usando o mesmo workspace, projeto e instância de áudio.

O Chrome verificou 2460 px de largura de linha do tempo em 2560×1080 e 3340 px em 3440×1440. O editor lateral voltou após redimensionar para uma janela de 1366×620 e reabrir a largura disponível, preservando tamanho e conteúdo do projeto. Passaram tema do Mixer destacado, retorno durante reprodução e gravação, notas mantidas ao abrir a aba, retorno de foco, controle de aba concorrente e encerramento da aba ligada quando se fecha o host. Também passaram as regressões de Arranjo, MIDI contextual e janelas. As dimensões foram emuladas no Chrome, com aceite físico ultrawide pendente.

Evidências em `.local/validation/ux-stage-4/`, incluindo `linked-2560.png`, `linked-3440.png`, `linked-side-editor.png`, `detached-mixer.png` e `browser-mvp-acceptance.json`. A etapa seguinte é **Retirada da interface Legacy SMK**.
