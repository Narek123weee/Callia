const http = require('http');

const PORT = Number(process.env.MOCK_PORT) || 11500;
const DELAY_MS = Number(process.env.MOCK_DELAY_MS) || 300;
const VOICE_PHRASES = ['What are your opening hours?', 'I want to book a cleaning', 'How much does whitening cost?', 'I want to speak to an operator'];
let voiceTurn = 0;

function makeWav() {
  const rate = 24000;
  const count = rate * 0.5;
  const buffer = Buffer.alloc(44 + count * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + count * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const fade = Math.min(1, i / 1200, (count - i) / 1200);
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 523 * i) / rate) * 5000 * fade), 44 + i * 2);
  }
  return buffer.toString('base64');
}
const TONE = makeWav();

function tomorrow() {
  const d = new Date(Date.now() + 86400000);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function toolCall(name, args) {
  return { role: 'assistant', content: null, tool_calls: [{ id: 'call_' + Date.now(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
}

function say(content) {
  return { role: 'assistant', content };
}

function answer(messages, system, userText) {
  if (/human|operator|person|оператор|человек|օպերատոր/i.test(userText)) return toolCall('transfer_to_human', { reason: 'Caller asked for a person' });
  if (/book|appointment|запис|գրանց/i.test(userText)) return toolCall('check_availability', { date: tomorrow() });
  if (/hour|open|час|работ|ժամ/i.test(userText)) return say('We are open: ' + (system.match(/- Hours: (.*)/)?.[1] || 'please ask our staff') + '.');
  if (/price|cost|how much|цен|сколько|գին/i.test(userText)) return say('Our services: ' + (system.match(/- Services and prices: (.*)/)?.[1] || 'please ask our staff') + '.');
  return say('Բարև ձեզ, ես փորձնական ընդունարանն եմ։ Հարցրեք աշխատաժամերի, գների կամ գրանցման մասին։');
}

function respond(body) {
  const messages = body.messages;
  const system = messages[0].content;
  const last = messages[messages.length - 1];

  if (last.role === 'tool') {
    const result = JSON.parse(last.content);
    const previous = [...messages].reverse().find(m => m.tool_calls);
    const name = previous.tool_calls[0].function.name;
    if (name === 'check_availability') {
      if (!result.free_slots.length) return say('Sorry, there are no free slots that day.');
      return toolCall('book_appointment', { name: 'Test Caller', phone: '+37400000000', service: 'Cleaning', date: result.date, time: result.free_slots[0] });
    }
    if (name === 'book_appointment') return say(result.ok ? `Done! Booked for ${result.appointment.date} at ${result.appointment.time}.` : 'Sorry, that time is taken.');
    return say('Connecting you to a colleague.');
  }

  if (Array.isArray(last.content)) {
    const instruction = last.content.find(c => c.type === 'text')?.text || '';
    if (!instruction.includes('[heard:')) return say('test voice message');
    const heard = VOICE_PHRASES[voiceTurn++ % VOICE_PHRASES.length];
    const reply = answer(messages, system, heard);
    if (reply.tool_calls) {
      reply.content = `[heard: ${heard}]`;
      return reply;
    }
    return say(`[heard: ${heard}] ${reply.content}`);
  }

  return answer(messages, system, typeof last.content === 'string' ? last.content : '');
}

http.createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => (raw += chunk));
  req.on('end', () => setTimeout(() => {
    res.setHeader('content-type', 'application/json');
    try {
      if (req.url.endsWith('/interactions')) {
        return res.end(JSON.stringify({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: TONE }] }] }));
      }
      if (req.url.endsWith('/chat/completions')) {
        return res.end(JSON.stringify({ choices: [{ message: respond(JSON.parse(raw)) }], usage: { prompt_tokens: 0, completion_tokens: 0 } }));
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: 'not found' } }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
  }, DELAY_MS));
}).listen(PORT, () => console.log(`Mock AI running at http://localhost:${PORT} (no API key, no quota)`));
