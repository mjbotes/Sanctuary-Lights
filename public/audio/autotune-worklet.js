// AudioWorklet: live pitch correction on one vocal input.
import { Tuner } from './tunercore.js';

class AutoTuneProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.tuner = new Tuner(sampleRate);
    this.silence = new Float32Array(128);
    this.count = 0;
    this.port.onmessage = (e) => this.tuner.set(e.data);
  }
  process(inputs, outputs) {
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const input = inputs[0] && inputs[0][0] ? inputs[0][0] : this.silence;
    this.tuner.process(input, out[0]);
    for (let c = 1; c < out.length; c++) out[c].set(out[0]);
    if (++this.count % 24 === 0) this.port.postMessage(this.tuner.info());
    return true;
  }
}
registerProcessor('autotune', AutoTuneProcessor);
