const config = require('./config');


async function postJson(url, body, headers, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || data[0]?.error?.message || res.statusText);
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function requireKey() {
  if (!config.speech.apiKey && config.speech.baseUrl.includes('googleapis')) {
    throw new Error('Armenian voice needs a Gemini key: add SPEECH_API_KEY to .env');
  }
}

async function transcribeWith(model, wavBase64) {
  const started = Date.now();
  try {
    const data = await postJson(
      config.speech.baseUrl + '/openai/chat/completions',
      {
        model,
        max_tokens: 200,
        ...(config.llm.reasoningEffort && { reasoning_effort: config.llm.reasoningEffort }),
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Transcribe this phone call audio exactly as spoken, in the original language (Armenian, Russian or English). Output only the transcript. If there is no clear speech, output nothing.'
            },
            { type: 'input_audio', input_audio: { data: wavBase64, format: 'wav' } }
          ]
        }]
      },
      { authorization: 'Bearer ' + config.speech.apiKey },
      config.speech.timeoutMs
    );
    console.log(`[stt] ${model} ok ${Date.now() - started}ms`);
    return (data.choices?.[0]?.message?.content || '').trim();
  } catch (err) {
    console.log(`[stt] ${model} failed after ${Date.now() - started}ms: ${err.message}`);
    throw new Error(`${model}: ${err.message}`);
  }
}

async function transcribe(wavBase64) {
  requireKey();
  const models = [config.speech.sttModel, ...config.speech.sttFallbackModels];
  let lastError;
  for (const model of models) {
    try {
      return await transcribeWith(model, wavBase64);
    } catch (err) {
      lastError = err;
    }
  }
  const hint = /api key/i.test(lastError.message) ? ' Check SPEECH_API_KEY in your .env file.' : '';
  throw new Error('Speech recognition failed. ' + lastError.message + hint);
}

async function synthesize(text) {
  requireKey();
  const clean = String(text).replace(/[*_#`]/g, '').trim();
  if (!clean) throw new Error('nothing to say');

  const data = await postJson(
    config.speech.baseUrl + '/interactions',
    {
      model: config.speech.ttsModel,
      input: [{ type: 'user_input', content: [{ type: 'text', text: clean }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: config.speech.voice }] }
    },
    { 'x-goog-api-key': config.speech.apiKey },
    config.speech.timeoutMs
  );

  const audio = (data.steps || [])
    .filter(step => step.type === 'model_output')
    .flatMap(step => step.content || [])
    .filter(part => part.type === 'audio')
    .pop();

  if (!audio?.data) throw new Error('no audio returned');
  return audio.data;
}

const CACHE_MAX = 100;
const cache = new Map();

async function speakable(text) {
  if (!config.speech.ttsEnabled) return { audio: null, ttsDisabled: true };
  const key = String(text).trim();
  if (cache.has(key)) {
    const audio = cache.get(key);
    cache.delete(key);
    cache.set(key, audio);
    return { audio, ttsMs: 0 };
  }

  const started = Date.now();
  try {
    const audio = await synthesize(key);
    console.log(`[tts] ${config.speech.ttsModel} ${Date.now() - started}ms`);
    cache.set(key, audio);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return { audio, ttsMs: Date.now() - started };
  } catch (err) {
    console.log('[tts] failed:', err.message);
    return { audio: null, ttsError: err.message };
  }
}

module.exports = { transcribe, synthesize, speakable };
