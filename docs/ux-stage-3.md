# Etapa 3 da evolução de UX do WASWAN

Implementada em `feat/ux-stage-3-recording` sobre `5b0f19c`. [Plano de evolução](ux-evolution-plan.md)

- **Track inspector** reúne armação, monitor, fonte, canal MIDI, latência e destino da tomada. A fonte de áudio usa a preferência do navegador e a pista armada define o destino da gravação. Selecionar a saída interna do Synth oferece acesso direto ao roteamento MIDI para o Synth.
- O transporte informa pista armada, fonte e criação ou substituição de clipe. Mostra o destino MIDI, o ajuste necessário quando faltar uma entrada e os estados de preparação, count-in, gravação ativa e finalização. A gravação ativa usa texto e vermelho. A tomada preserva a seleção de substituição capturada ao apertar Record.
- **Settings** reúne porta, atribuições e perfis contextuais. O inspetor dá acesso ao Settings do Synth. Abrir a entrada física ou gravar dela mantém a preferência de roteamento MIDI. A sessão de monitoramento de áudio e a de MIDI compartilham o mesmo host e podem ser abertas separadamente.

O Chrome validou gravação MIDI, cancelamento no count-in e durante preparação, escrita de áudio com entrada simulada, troca de tomada com Undo/Redo, preservação após falha de permissão e recuperação de checkpoint interrompido. A captação interna passou com acompanhamento e click ativos, mantendo ambos fora do WAV. Também passaram o Monitor MIDI, o perfil contextual em Settings, a gravação com painel destacado e as regressões de Arranjo, editores, FX e exportação do projeto de exemplo. A entrada física foi simulada por fluxo Web Audio, e o aceite com dispositivo real continua pendente.

Evidências em `.local/validation/ux-stage-3/`, incluindo `count-in.png`, `browser-recording.json` e os logs do aceite. A etapa seguinte é **Ultrawide e novas abas**.
