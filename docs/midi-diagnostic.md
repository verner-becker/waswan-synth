# Diagnóstico MIDI ao vivo

Extensão optativa na branch `feat/knob-fine-control`, sobre `6456eff`. Esta entrega acrescenta observação e transmissão local; mantém o comportamento Normal/Fino existente, o DSP, presets, mapeamentos e upstream.

## Operação

1. Recarregar com Ctrl+F5, iniciar o simulador e conectar a entrada MIDI.
2. Abrir **WASWAN · Diagnóstico MIDI ao vivo**, abaixo do perfil.
3. **Iniciar captura ao vivo** e aguardar **conexão local confirmada**.
4. Mover o controle. Ao observar o problema, clicar **Marcar problema** antes de fazer o movimento que destrava; avisar o assistente.
5. **Encerrar**, aguardar todos os registros enviados e opcionalmente **Exportar JSONL**. Manter a página aberta enquanto houver pendências de envio.

O assistente pode ler `.local/validation/midi-live-current.json` e o arquivo indicado, `midi-live-<UUID>.jsonl`. Não depende de acesso ao navegador pessoal via Playwright. Novas sessões criam arquivos distintos, sem sobrescrever a captura anterior. O navegador retém somente a sessão atual; os arquivos locais ficam disponíveis para análise posterior. Captura desativada por padrão, sem persistência automática da ativação.

## Conteúdo e limites

Captura somente mensagens CC de três bytes: status cru, canal (1–16), CC, valor e diferença desde o último CC dessa origem selecionada/canal. Inclui perfil habilitado, destino, formato, Normal/Fino, referência absoluta anterior e comandos gerados pelo mapeamento. Classifica aprendizado, referência inicial/valor sem delta, comando enviado, caminho original ou entrada ignorada por instrumento parado/aba oculta.

Também registra alterações dos quatro parâmetros diretos da tela e token de contexto, resets e marcações manuais. Valores são internos, não Hz. `latestFrame` no registro CC é a última telemetria recebida, com idade registrada; pode anteceder a aplicação do próprio CC em cerca de 40 ms. Registros `state` posteriores mostram evolução. `mapped-command-sent` significa entregue à função de envio da aplicação, não confirmação individual do WASM. O caminho original dos controles não mapeados é preservado; seus comandos de saída não são interceptados pelo diagnóstico.

Não grava áudio, mensagens de nota, pitch bend, framebuffer, nomes/IDs de dispositivos ou caminhos pessoais. CCs e valores de parâmetros são intencionalmente capturados para esse diagnóstico. Perfil/faders/notas/rodas continuam seguindo o mesmo caminho.

Buffer limitado a 10000 registros mais encerramento automático; não há armazenamento ilimitado no navegador. Sem console por mensagem. Contadores/preview de cinco registros e envio atualizam a cada 250 ms, em lotes de até 40. Essa cadência admite atraso se houver muitos eventos acumulados ou servidor indisponível; não é um relógio de áudio. Falha de envio aparece no painel e mantém a fila para nova tentativa. Exportação JSONL funciona também sem conexão com o receptor. Fechar/recarregar pode perder a fila não enviada; exportar ou aguardar o envio antes disso.

## Receptor local

`scripts/serve-simulator.py` continua em loopback, acrescentando POST `/diagnostics/midi`. Aceita lotes limitados (128 KiB, até 40 registros), origem localhost/127.0.0.1 na porta servida, UUID de sessão e sequência válida. Escrita serializada fora do callback de áudio. Reenvios são idempotentes; lacunas são recusadas. Evidências ficam fora da raiz HTTP servida. Não há transmissão para serviços externos.

O servidor precisa ser reiniciado após atualizar o script. Uma página que já tenha registros pendentes tenta reenviar quando o receptor volta. No teste físico, o primeiro receptor recusou o campo `disposition`; a whitelist foi corrigida e o reenvio recuperou a captura completa, incluindo marcação e encerramento, sem lacunas (727 registros). O teste end-to-end agora verifica igualdade integral entre o JSONL exportado e o recebido, cobrindo esse erro.

`--diagnostic-dir` permite diretório distinto para testes. Testes usam porta 8738 e `.local/validation/midi-diagnostic-server`, sem misturar dados do teclado real.

## Descoberta no teste físico

No episódio marcado, canal 6 / CC49, destino K2/ressonância, formato Absoluto e comportamento Fino:

| Momento | CC recebido | Ressonância interna |
| --- | ---: | ---: |
| Referência inicial | 53 | 20 |
| Último valor físico recebido | 127 | 94 (confirmado no frame seguinte) |

Os 74 incrementos explicam exatamente `20 + (127 − 53) = 94`. O contexto permaneceu constante e os comandos finos foram gerados. O SMK transmitiu a progressão até seu limite, compatível com a observação da tela física pelo usuário. A marcação veio depois de atingir esse extremo.

Isso confirma uma falha de alinhamento no uso de CC absoluto como deltas: o curso restante do controle pode terminar antes do extremo do parâmetro. Não é indício de potenciômetro defeituoso nesse trecho. A volta ao mínimo pode realinhar os valores pela saturação, explicando a recuperação observada. Esta entrega preserva esse comportamento para documentar o diagnóstico; a política de controle absoluto exige correção própria (por exemplo, posição com captura suave), preservando o modo relativo.

Arquivo físico completo permanece ignorado pelo Git; não se versiona UUID nem caminho pessoal. A reprodução sintética usa referência 53, parâmetro 20 e fim 127 → 94, marcando explicitamente esse resultado como reprodução do defeito atual, não resultado desejado de uma futura correção.

## Testes executados

- `node tests/midi-diagnostic.test.mjs`: coleta opcional, limites, CC-only, deltas, snapshots, resets/marcações, privacidade e igualdade exata dos comandos enviados com captura desligada/ligada: passou.
- `node tests/browser-midi-diagnostic.mjs`: Chrome em origem/servidor isolados, aprendizado previamente persistido, recepção de CCs e repetições, reprodução 53/20→127/94, marcação, stop, download, igualdade com JSONL recebido, reenvio sem duplicação, rejeição de notas/origem externa/sessão inválida e viewport 390 px, sem exceções: passou.
- Suítes existentes `midi-profile`, `knob-fine-control`, `polyphony-256`, `dsp-monitor` nativo e `check-upstream.sh`: passaram, incluindo áudio idêntico, alocação/stealing, sustain/release e perfis/presets/sessões. O monitor prolongado de três minutos não foi repetido nesta entrega; o callback de áudio e seu monitor não foram alterados.
- Teste físico do usuário: captura completa de 727 registros, uma marcação, encerramento e sequências consecutivas; progressão MIDI observada como descrito acima.

Evidências em `.local/validation/midi-diagnostic-*` e captura física `midi-live-*.jsonl`, ignoradas no Git. Sem dependências novas, firmware, CI, merge ou tag.

Para reproduzir o teste de navegador, iniciar o receptor isolado e executar:

```sh
sh scripts/stage-simulator.sh
python3 scripts/serve-simulator.py --port 8738 --diagnostic-dir .local/validation/midi-diagnostic-server
# Em outro terminal:
node tests/browser-midi-diagnostic.mjs
```


## Após a correção absoluta

O caso 53/20→127/94 acima documenta a captura física anterior à correção. Na versão corrigida, o Fino absoluto envia intenções `enc-fine-absolute` (valor e revisão), e o Engine aguarda captura de posição; o registro de comando enviado não significa que o parâmetro já mudou. `parameters` inclui limites e estado de posse reportado. A UI também verifica a revisão atual do perfil, pois um reset pode invalidar a posse antes do próximo CC.

O teste sintético agora exige que a ressonância20 permaneça20 até capturar em CC20, e confirme alcance de0/127 depois disso, mantendo igualdade dos logs exportados/recebidos. O arquivo físico original permanece preservado. Detalhes e teste manual em [correção de alinhamento absoluto](knob-fine-control.md#correção-de-alinhamento-absoluto--captura-suave).
