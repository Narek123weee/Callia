const config = require('./config');
const db = require('./db');
const tools = require('./tools');

const MAX_STEPS = 6;
const HISTORY_LIMIT = 8;
const usageTotals = { prompt: 0, completion: 0 };
const FALLBACK = 'Sorry, let me connect you with a colleague.';

function systemPrompt() {
  const b = db.load().business;
  return `You are the AI receptionist for "${b.name}" in Armenia. Today is ${new Date().toISOString().slice(0, 10)}.
Reply in the caller's language (Armenian, Russian or English). If the language is unclear, reply in Armenian. Keep replies very short, one sentence of under 20 words whenever possible, because this is a phone call and every word adds waiting time.
Business info:
- Hours: ${b.hours}
- Address: ${b.address}
- Services and prices: ${b.services}
- FAQ: ${b.faqs}
Rules: use only the info above, never invent facts. To book: collect name, phone, service, date, time; check availability; confirm; then book.
If you do not know the answer, the caller is upset, or asks for a person, call transfer_to_human.`;
}

const RETRYABLE = [429, 500, 502, 503, 504];
const ATTEMPTS_PER_MODEL = 2;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function recent(messages) {
  let start = Math.max(0, messages.length - HISTORY_LIMIT);
  while (start < messages.length && messages[start].role !== 'user') start++;
  return messages.slice(start);
}

async function requestModel(model, messages) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.llm.timeoutMs);

  try {
    const res = await fetch(config.llm.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + (config.llm.apiKey || 'none')
      },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        ...(config.llm.temperature !== null && { temperature: config.llm.temperature }),
        tools: tools.definitions,
        ...(config.llm.reasoningEffort && { reasoning_effort: config.llm.reasoningEffort }),
        messages: [{ role: 'system', content: systemPrompt() }, ...recent(messages)]
      })
    });
    const data = await res.json().catch(() => ({}));
    console.log(`[llm] ${model} status=${res.status} ${Date.now() - started}ms`);
    if (data.usage) {
      usageTotals.prompt += data.usage.prompt_tokens || 0;
      usageTotals.completion += data.usage.completion_tokens || 0;
      console.log(`[usage] this call: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out | since start: ${usageTotals.prompt} in, ${usageTotals.completion} out`);
    }
    if (res.ok) return data.choices[0].message;

    const detail = data.error?.message || data[0]?.error?.message || res.statusText;
    const error = new Error(`LLM error (${model}): ${detail}`);
    error.quota = /quota|RESOURCE_EXHAUSTED|exceeded your current/i.test(detail);
    error.retryable = !error.quota && (RETRYABLE.includes(res.status) || /high demand|overloaded|unavailable/i.test(detail));
    if (error.quota) error.message = `Free quota used up for ${model}. Wait for the reset, use another key, or set TTS_ENABLED=false to save quota.`;
    throw error;
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log(`[llm] ${model} timed out after ${config.llm.timeoutMs}ms`);
      const timeout = new Error(`LLM error (${model}): no answer within ${config.llm.timeoutMs / 1000}s`);
      timeout.retryable = true;
      timeout.timedOut = true;
      throw timeout;
    }
    if (err.cause?.code === 'ECONNREFUSED' || err.message === 'fetch failed') {
      throw new Error(`Cannot reach the AI server at ${config.llm.baseUrl}. If you use Ollama, make sure it is running.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function callModel(messages) {
  const models = [config.llm.model, ...config.llm.fallbackModels];
  let lastError;

  for (const model of models) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      try {
        return await requestModel(model, messages);
      } catch (err) {
        lastError = err;
        if (!err.retryable || err.timedOut || err.quota) break;
        if (attempt < ATTEMPTS_PER_MODEL) await sleep(800 * attempt);
      }
    }
  }
  throw lastError;
}

function parseArgs(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

const VOICE_INSTRUCTION =
  "This is the caller's voice message. Begin your answer with [heard: followed by the exact words the caller said, in their own language, then ]. After that, reply to the caller as the receptionist. If there is no clear human speech, output only [heard: ].";

const HEARD_TAG = /\[heard:\s*([\s\S]*?)\]/i;

function extractHeard(messages, from) {
  for (let i = from; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'assistant' && typeof m.content === 'string') {
      const found = m.content.match(HEARD_TAG);
      if (found) return found[1].trim();
    }
  }
  return null;
}

function stripHeard(messages, from) {
  for (let i = from; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'assistant' && typeof m.content === 'string') m.content = m.content.replace(HEARD_TAG, '').trim();
  }
}

async function runTurn(session, turnStart) {
  for (let step = 0; step < MAX_STEPS; step++) {
    const message = await callModel(session.messages);
    session.messages.push(message);

    if (!message.tool_calls?.length) return message.content || '';

    for (const call of message.tool_calls) {
      const result = tools.run(call.function.name, parseArgs(call.function.arguments), session);
      session.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return FALLBACK;
}

async function reply(session, userText, audio) {
  session.heard = null;
  if (!config.llm.configured) {
    return 'Demo mode: add LLM_API_KEY to your .env file to enable the receptionist.';
  }

  const content = audio
    ? [{ type: 'text', text: VOICE_INSTRUCTION }, { type: 'input_audio', input_audio: { data: audio, format: 'wav' } }]
    : userText;

  const turnStart = session.messages.length;
  session.messages.push({ role: 'user', content });

  let answer;
  try {
    answer = await runTurn(session, turnStart);
  } catch (err) {
    session.messages.length = turnStart;
    throw err;
  }

  if (!audio) return answer;

  const heard = extractHeard(session.messages, turnStart + 1);
  stripHeard(session.messages, turnStart + 1);
  answer = answer.replace(HEARD_TAG, '').trim();

  if (heard === '' || (heard === null && !answer)) {
    session.messages.length = turnStart;
    session.heard = '';
    return '';
  }

  session.heard = heard || '(voice message)';
  session.messages[turnStart].content = session.heard;
  return answer;
}

module.exports = { reply };
