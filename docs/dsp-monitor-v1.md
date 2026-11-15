# WASWAN DSP Monitor v1

## Decisões anteriores à implementação

Base verificada: `experiment/polyphony-256`, commit `5edc7449942703b8e893bb112657f7a024354648`, limpa e igual ao remoto. Branch isolada: `feat/dsp-monitor`. Upstream, firmware, presets e DSP permanecem intactos.

A auditoria do worklet fixado encontrou `process()` com render WASM, cópia estéreo, frame a 25 Hz e persistência a 1 Hz. O monitor envolverá esse callback completo, incluindo os custos periódicos originais; não medirá apenas o núcleo DSP. Mensagens de controle passam pela porta existente; o motor e seu reboot continuam originais. O worker silencioso não representa execução de áudio e não será instrumentado.

`currentTime`/`currentFrame` são relógios de transporte, inadequados para medir duração síncrona. Usar somente `performance.now()` quando disponível no escopo AudioWorklet; caso contrário informar indisponibilidade, valores de duração nulos e nenhum diagnóstico de deadline. Não adicionar relógio artificial, SharedArrayBuffer, headers de isolamento ou backend. A disponibilidade será verificada no Chrome real.

Histogramas fixos de 1024 bins de 0,025 ms, com overflow explícito, serão agregados fora do callback para percentis aproximados. Sem ordenação por bloco. Comunicação a aproximadamente 1 segundo de áudio, buffers de tamanho fixo; logs limitados a 3600 janelas por captura. Contagem de vozes amostrada na janela, não por bloco: pico amostrado pode perder transientes. Gate não significa tecla pressionada; release não prova audibilidade. Violações medidas do orçamento não comprovam underruns.
