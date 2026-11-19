// The on-phone fallback reader. Tesseract.js is loaded only here, on first use, and everything it needs (worker,
// WebAssembly core, English language data) is served from our own origin: scripts/copy-tesseract.mjs copies it
// into public/tesseract at build time, so no third-party CDN is contacted and the photo never leaves the phone.

const LSTM_ONLY = 1 // Tesseract.OEM.LSTM_ONLY: the neural engine only, which needs the smaller "-lstm" core.

/** The text Tesseract reads from the image (a data URL). */
export async function readTextOnPhone(image: string): Promise<string> {
  const { default: Tesseract } = await import('tesseract.js')
  const base = `${window.location.origin}/tesseract`
  const worker = await Tesseract.createWorker('eng', LSTM_ONLY, {
    workerPath: `${base}/worker.min.js`,
    corePath: `${base}/core`,
    langPath: `${base}/lang`,
    // Start the worker from its own same-origin URL instead of a blob: wrapper.
    workerBlobURL: false,
  })
  try {
    return (await worker.recognize(image)).data.text
  } finally {
    await worker.terminate()
  }
}
