# Music Lab · W2

No **Music Lab**, inicie o áudio, escolha a entrada em **Configurar MIDI** e clique em **Iniciar prática MIDI**. **Automático** segue o canal do primeiro ataque. O seletor também permite escolher um dos 16 canais antes de iniciar ou retomar.

Nas escalas, cada acerto avança a pauta. Uma nota fora do alvo é exibida ao lado do destaque e deixa o alvo disponível para outra tentativa. As tríades exigem que as teclas estejam pressionadas juntas e que os ataques ocorram na janela da lição, de 120 ms na tríade de Dó maior. **Encerrar tentativa** mostra os alvos que faltaram se já houve atividade. A duração medida vai do ataque à soltura da tecla. A referência de duração usa o andamento selecionado no início da tentativa. Pedal e duração da tecla aparecem separadamente. As três lições atuais usam correspondência estrita de alturas sem pontuação de ritmo. O dedilhado continua como orientação.

## Integração

A prática assina `subscribeDawInput` apenas enquanto está ouvindo. O Lab usa a porta selecionada e a geração de conexão do controlador. O callback recebe cópias dos eventos, e a avaliação roda em lote no próximo quadro. Os eventos consumidos por perfis ficam com os próprios perfis. A DAW e o Fusion mantêm o roteamento e têm prioridade sobre a avaliação. A troca de workspace preserva as teclas do Synth.

Desconexão, mudança de entrada, aba oculta, panic ou tomada do instrumento por outro transporte pausam a prática e limpam apenas as teclas pendentes da avaliação. A retomada conserva os alvos já reconhecidos e as durações já medidas. As demonstrações, o teclado virtual e o playback interno seguem caminhos independentes do observador.

O **Progresso local** guarda contagem e até oito resumos por lição, versão e tonalidade. A chave `waswan-music-lab-progress-v1` contém agregados de correspondência e duração. Alturas, sequência de eventos e identificadores do dispositivo ficam fora do histórico. Uma tentativa vazia ou descartada fica fora da contagem.

## Validação e continuidade

- `tests/music-lab-assessment.test.mjs` cobre normalização, velocity zero, canais, CC64, CC120/123, repetições, sequência, acorde, duração e persistência defensiva.
- `tests/browser-music-lab-assessment.mjs` usa MIDI simulado e o WASM real. Cobre nota extra, nota ausente, acerto com avanço visual, retomada após troca de workspace, dispositivo e panic, uma única emissão ao Synth, janela do acorde e recuperação do progresso após recarregar.
- As regressões da W1, do shell e do monitor DAW verificam continuidade do áudio, perfis, pickup e propriedade da rota. Relatório e capturas da W2 ficam em `.local/validation/music-lab/`.

O usuário aprovou a W2 e autorizou a implementação da W3. O ensaio físico documentado no SMK-37 Pro segue pendente. A próxima onda amplia o catálogo e acrescenta exercícios de duas mãos com verificação de alcance.
