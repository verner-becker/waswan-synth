# Etapa 5 da evolução de UX do WASWAN

Implementada em `feat/ux-stage-5-instrument` sobre `2454662`. [Plano de evolução](ux-evolution-plan.md)

- O acesso público ao painel Legacy SMK foi retirado. O endereço com o parâmetro antigo abre a interface atual. O teclado, os pads e as rodas mantêm os handlers do instrumento. Iniciar áudio, silenciar e liberar notas chamam o host diretamente. A memória conserva o formato já gravado pelo firmware.
- Em **Performance → Instrument setup**, é possível selecionar A–D, mixar as partes e os quatro sends, ajustar master, drive compartilhado, globais, resposta e banco dos faders. O acesso reúne DRUM-X, SUPER mix, favoritos, carga e salvamento de patterns, sequenciador nativo, Split/Layer e modo controlador MIDI. TONES continua sendo o editor ANALOG. As atribuições MIDI incluem o contexto dos encoders, a resposta e o indicador de pickup em Settings.
- A implementação acrescenta comandos e leituras para a interface do navegador sobre as funções do firmware existente. O submódulo continua em `3f751bc2`. O dock permanece o mesmo ao navegar, e os nós de apoio do adaptador ficam fora da página pública. A fonte do manual e o PDF foram atualizados.

O Chrome passou pela seleção de parte, quatro sends, banco e resposta Catch/Jump dos faders, favoritos, patterns, sequenciador, Split/Layer, DRUM-X com salvamento, modo controlador nativo e saída desse modo. A regressão verificou as 256 vozes, continuidade e recuperação da partida, pickup, sessão de áudio compartilhada, timbres, DSP Monitor e exportação/importação da memória. Os testes Node cobriram o caminho de referência de áudio, tons, encoders finos e polifonia. O dispositivo físico, a saída USB/TRS e leitor de tela seguem pendentes de aceite. O PDF passou pela verificação de paginação, imagens e links.

Evidências em `.local/validation/ux-stage-5/`. A próxima etapa é **Consolidação de SEQ e Studio**.
