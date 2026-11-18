# Fechamento dos critérios do MVP

A branch `feat/daw-mvp-acceptance` parte da fase 9 em `d558119`. A rodada retoma as quatro lacunas identificadas na conferência do SPEC e prepara o aceite presencial. O assessment consultivo com Astra 6.2 high revisou a aba conectada, o compartilhamento de estado e a rota interna de gravação.

| Critério | Entrega |
|---|---|
| Volume independente do metrônomo | **Click volume** regula click e count-in de 0 a 100%, inclusive durante a reprodução e a tomada. O ajuste fica neste navegador. O click mantém sua saída separada do Master e das capturas. |
| Medidores no Mixer | Pico por trilha junto aos faders e leitura estéreo L/R do Master, com clipping e indicador de limiter. A janela destacada usa os mesmos medidores do projeto. |
| DAW em outra aba | **Open DAW in new tab** move o workspace existente para uma superfície leve. A aba conecta pelo vínculo criado pelo Synth. Ela usa o mesmo projeto, histórico, arquivos e transporte. **Focus Synth** leva ao instrumento. Fechar a aba DAW devolve a interface ao host mantendo o áudio. Fechar o host encerra a sessão. |
| Captura interna | **Synth output (internal)** é uma entrada de trilha de áudio. Ela registra a saída estéreo do Synth antes do mute/ganho de saída, sem passar pela soma da DAW. O áudio do Synth continua pelo seu monitor original. Os clipes em reprodução, o click e o microfone têm caminhos separados. A tomada usa o gravador, o checkpoint e o Undo existentes. |

A URL `/simulator/?workspace=daw` abre a DAW diretamente. Quando outra aba já tem o áudio, o Web Lock impede uma segunda inicialização e indica o botão para abrir a aba conectada no Synth. A conexão é criada a partir do host, com um documento da mesma origem e um identificador de uso único. A aba independente digitada na barra de endereço mantém o fluxo de acesso direto. Conexão arbitrária a uma sessão sem esse vínculo e transferência de áudio após fechar o host exigiriam outro protocolo.

Para a captura interna, desative **DAW MIDI input** e toque o Synth na parte selecionada. A gravação reserva essa parte antes de atribuir os instrumentos do acompanhamento. Com oito instrumentos ocupados ou quatro kits DRUM-X quando uma parte de bateria precisa ser reservada, libere o slot indicado. A compensação manual por dispositivo é usada na captura externa. A captura interna segue o relógio compartilhado do áudio.

## Validação de software

No Chrome 157/Linux, o teste `tests/browser-daw-mvp-acceptance.mjs` manteve um AudioContext e um host, com zero inicializações de áudio na aba ligada e na outra aba bloqueada pelo lock. Moveu a UI durante uma nota física simulada, editou o mesmo projeto, importou um File criado na aba filha, salvou e reabriu o projeto, usou o Mixer destacado e retornou durante o Play. Fechar o host encerrou a aba ligada. Os seletores nos testes devolvem handles OPFS. Dessa forma a prova cobre o fluxo e os bytes do arquivo sem validar a interação com o seletor do sistema.

O nível medido do click foi 0,1248 a 80%, 0,0312 a 20% e zero a 0%, sem alterar o pico de 0,125 do acompanhamento. As duas tomadas internas tiveram 88.200 frames cada. Com acompanhamento de WAV, bateria DRUM-X e click, o trecho sem performance ficou no piso de quatro unidades PCM do Synth. A tomada tocada chegou a aproximadamente 4.000 unidades PCM, mesmo com saída global em mute. A parte do Synth manteve seu timbre. Nenhum microfone foi solicitado. Undo restaurou a primeira fonte.

**52 suítes Node e 14 suítes Chrome passaram.** A rodada inclui UI Foundation v1/v2, posse de áudio, gestos de clipe, navegação, editores, arquivos, gravação, Mixer, perfis e exportação. Evidências em `.local/validation/daw-mvp-acceptance/`. O [manual em português](../../MANUAL-WASWAN-SYNTH.pdf) foi atualizado. Os ensaios de cinco e vinte minutos da [fase 9](wave-9.md) validaram o caminho de reprodução e captura sintética que serve de base a esta entrega.

## Aceite com equipamentos

Esta rodada verificou o comportamento musical com dispositivos sintéticos. Na sondagem da API real no Linux, o Chrome listou três entradas de áudio e a solicitação MIDI retornou `NotAllowedError`. O ensaio não abriu uma captura física. A tabela indica o que executar com hardware e no Chrome de cada sistema disponível, incluindo Windows e macOS. Registre navegador, sistema, dispositivos, reprodução e arquivo resultante por linha.

| Prova | Procedimento e resultado esperado |
|---|---|
| Controlador MIDI | Conecte o SMK-37 Pro, escolha a porta real, sustente uma nota e alterne entre Synth, aba DAW e Mixer. A nota continua até seu note-off/pedal. Teste troca de perfil, pickup e reconexão na mesma identidade. |
| Microfone ou interface | Grave um pulso em trilha armada com acompanhamento. Compare o ataque gravado com a régua, ajuste o offset em ms e repita. O WAV contém só a entrada física. |
| Synth interno | Selecione **Synth output (internal)**, desative a entrada MIDI DAW e toque por cima do projeto. O WAV contém a performance Synth. Compare com a gravação externa e confirme o Undo. |
| Arquivos do sistema | Em cada superfície, abra um projeto local, faça Save As, cancele outro Save As e reabra a cópia. Exporte WAV e stems e inspecione os arquivos locais. |
| Monitores | Ponha o Mixer destacado na outra tela, redimensione, compare os medidores e feche o painel. Mova a aba DAW e confirme o retorno ao Synth com o projeto em andamento. |
| Sessão e estabilidade | Grave e reproduza por uma sessão real. Teste perda do dispositivo, interrupção recuperável e fechamento do host. Confira que outra aba só obtém áudio depois da liberação da posse. |

A integração à `main` exige aprovação explícita.
