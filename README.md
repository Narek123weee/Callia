# Callia - AI receptionist (free API version)

## Run
1. Get a free key at aistudio.google.com/apikey
2. `npm install`
3. Copy `.env.example` to `.env` and paste the key into `LLM_API_KEY`
4. `npm start` and open http://localhost:3000

## Other free providers
Change three lines in `.env`.

Groq:
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=llama-3.3-70b-versatile

Ollama (local, no key needed):
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=llama3.1

## Structure
src/server.js        app entry
src/config.js        env loading and defaults
src/llm.js           model calls and system prompt
src/tools.js         availability, booking, transfer
src/sessions.js      call sessions and logging
src/db.js            JSON storage
src/routes/api.js    dashboard and chat API
src/routes/voice.js  Twilio phone webhooks
src/speech.js        transcription and text-to-speech
public/              dashboard (index.html, style.css, app.js, voice.js)

## Voice
Hands-free mode records your voice in the browser and sends it to Gemini, which hears the audio and answers in one call, then the reply is spoken with Gemini TTS (Armenian supported). With a non-Gemini LLM it falls back to separate transcription. Optional .env settings: STT_MODEL, TTS_MODEL, TTS_VOICE, SPEECH_API_KEY.

## Phone calls
Point your Twilio number's "A call comes in" webhook to POST https://YOUR-URL/voice/incoming

## Testing without any API quota
Terminal 1: npm run mock
Terminal 2: copy .env to .env.real, copy .env.mock to .env, then npm start
The mock replies to hours, prices, booking and operator requests, and returns a short tone instead of speech.
Unit tests: npm test
Switch back: copy .env.real to .env
