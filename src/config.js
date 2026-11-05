const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  });
}

const env = process.env;

const clean = value => (value || '').trim().replace(/^["']|["']$/g, '').trim();
const cleanModel = value => clean(value).replace(/^models\//, '');

const baseUrl = clean(env.LLM_BASE_URL) || 'https://generativelanguage.googleapis.com/v1beta/openai';
const defaultFallbacks = baseUrl.includes('googleapis') ? 'gemini-3.5-flash' : '';

const speechKey = clean(env.SPEECH_API_KEY) || (baseUrl.includes('googleapis') ? clean(env.LLM_API_KEY) : '');

module.exports = {
  port: env.PORT || 3000,
  turnsPerMinute: clean(env.TURNS_PER_MINUTE) === '' ? 20 : Number(clean(env.TURNS_PER_MINUTE)),
  adminToken: clean(env.ADMIN_TOKEN),
  voiceLang: clean(env.VOICE_LANG) || 'hy-AM',
  speech: {
    baseUrl: clean(env.SPEECH_BASE_URL) || 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: speechKey,
    sttModel: cleanModel(env.STT_MODEL) || 'gemini-3.1-flash-lite',
    ttsModel: cleanModel(env.TTS_MODEL) || 'gemini-3.8-flash-lite-tts',
    voice: clean(env.TTS_VOICE) || 'Kore',
    timeoutMs: Number(env.SPEECH_TIMEOUT_MS) || 20000,
    ttsEnabled: clean(env.TTS_ENABLED) !== 'false',
    sttFallbackModels: (env.STT_FALLBACK_MODELS === undefined ? 'gemini-3.5-flash' : env.STT_FALLBACK_MODELS)
      .split(',').map(cleanModel).filter(Boolean)
  },
  llm: {
    baseUrl,
    apiKey: clean(env.LLM_API_KEY),
    model: cleanModel(env.LLM_MODEL) || 'gemini-3.8-flash',
    fallbackModels: (env.LLM_FALLBACK_MODELS === undefined ? defaultFallbacks : env.LLM_FALLBACK_MODELS)
      .split(',').map(cleanModel).filter(Boolean),
    reasoningEffort: clean(env.LLM_REASONING_EFFORT) || (baseUrl.includes('googleapis') ? 'low' : ''),
    timeoutMs: Number(env.LLM_TIMEOUT_MS) || 8000,
    temperature: clean(env.LLM_TEMPERATURE) === '' ? null : Number(clean(env.LLM_TEMPERATURE)),
    audioInput: clean(env.LLM_AUDIO_INPUT) ? clean(env.LLM_AUDIO_INPUT) === 'true' : baseUrl.includes('googleapis'),
    configured: Boolean(clean(env.LLM_API_KEY) || clean(env.LLM_BASE_URL))
  }
};
