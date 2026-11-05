const config = require('../src/config');
const llm = require('../src/llm');
const speech = require('../src/speech');

const results = [];

async function timed(name, fn) {
  const started = Date.now();
  try {
    const value = await fn();
    const ms = Date.now() - started;
    results.push({ name, ms, ok: true });
    console.log(`${name}: OK in ${(ms / 1000).toFixed(1)} s`);
    return value;
  } catch (err) {
    const ms = Date.now() - started;
    results.push({ name, ms, ok: false });
    console.log(`${name}: FAILED after ${(ms / 1000).toFixed(1)} s - ${err.message}`);
    return null;
  }
}

async function main() {
  console.log('Language model :', config.llm.model, '(backup:', config.llm.fallbackModels.join(', ') || 'none', ')');
  console.log('Reasoning      :', config.llm.reasoningEffort || 'default');
  console.log('Speech models  : stt =', config.speech.sttModel, '| tts =', config.speech.ttsModel);
  console.log('API key set    :', Boolean(config.speech.apiKey || config.llm.apiKey));
  console.log('');

  const answer = await timed('1. Thinking (language model)', () =>
    llm.reply({ messages: [], transfer: false }, 'What are your opening hours?'));
  if (answer) console.log('   Answer:', answer);

  const audio = await timed('2. Speaking (text-to-speech)', () =>
    speech.synthesize(answer || 'Բարև ձեզ, ինչպե՞ս կարող եմ օգնել։'));

  if (audio) {
    const heard = await timed('3. Listening (speech-to-text)', () => speech.transcribe(audio));
    if (heard) console.log('   Heard:', heard);
  }

  const done = results.filter(r => r.ok);
  const total = done.reduce((sum, r) => sum + r.ms, 0);
  console.log('');
  console.log(`One full voice turn is about ${(total / 1000).toFixed(1)} s (steps 1 + 2 + 3).`);
  if (done.length) {
    const slowest = done.reduce((a, b) => (b.ms > a.ms ? b : a));
    console.log(`Slowest step: ${slowest.name}`);
  }
}

main();
