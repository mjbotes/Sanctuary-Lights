// Web Worker: renders one audio channel at a new key / tempo.
importScripts('pvcore.js');
self.onmessage = (e) => {
  const { id, data, semitones, tempo, formant } = e.data;
  try {
    let last = 0;
    const out = self.PV.process(data, semitones, tempo, { formant: !!formant }, (p) => {
      if (p - last > 0.05) {
        last = p;
        self.postMessage({ id, progress: p });
      }
    });
    self.postMessage({ id, done: true, data: out }, [out.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
