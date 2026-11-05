const db = require('./db');
const llm = require('./llm');

const sessions = new Map();
const config = require('./config');
const recentTurns = [];

function checkRate() {
  const limit = config.turnsPerMinute;
  if (!limit) return;
  const now = Date.now();
  while (recentTurns.length && now - recentTurns[0] > 60000) recentTurns.shift();
  if (recentTurns.length >= limit) throw new Error(`Too many requests (limit ${limit} per minute). Wait a moment.`);
  recentTurns.push(now);
}

const HUMAN_REQUEST = /(operator|human|real person|representative|manager|оператор|человек|живой|сотрудник|менеджер|օպերատոր|մարդ|աշխատակից|մենեջեր)/i;

const HANDOFF_MESSAGE = {
  hy: 'Ես Ձեզ կապում եմ մեր աշխատակցի հետ։',
  ru: 'Соединяю вас с сотрудником.',
  en: 'Connecting you to a staff member.'
};

function handoffMessage(text) {
  if (/[\u0530-\u058F]/.test(text)) return HANDOFF_MESSAGE.hy;
  if (/[\u0400-\u04FF]/.test(text)) return HANDOFF_MESSAGE.ru;
  return HANDOFF_MESSAGE.en;
}

function get(id, channel) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      id,
      channel,
      messages: [],
      transcript: [],
      startedAt: new Date().toISOString(),
      transfer: false,
      transferReason: ''
    });
  }
  return sessions.get(id);
}

function saveCall(session) {
  const data = db.load();
  const entry = {
    id: session.id,
    channel: session.channel,
    startedAt: session.startedAt,
    transcript: session.transcript,
    transferred: session.transfer,
    reason: session.transferReason
  };
  const index = data.calls.findIndex(c => c.id === session.id);
  if (index >= 0) data.calls[index] = entry;
  else data.calls.push(entry);
  db.save(data);
}

async function turn(session, text, audio) {
  const started = Date.now();
  let heard = text;
  let answer;

  if (!audio && HUMAN_REQUEST.test(text)) {
    session.transfer = true;
    session.transferReason = 'Caller asked for a person';
    answer = handoffMessage(text);
  } else {
    checkRate();
    answer = await llm.reply(session, text, audio);
    if (audio) {
      heard = session.heard;
      if (!heard) return null;
      if (!session.transfer && HUMAN_REQUEST.test(heard)) {
        session.transfer = true;
        session.transferReason = 'Caller asked for a person';
        answer = handoffMessage(heard);
      }
    }
  }

  session.lastHeard = heard;
  session.lastMs = Date.now() - started;
  session.transcript.push({ who: 'caller', text: heard });
  session.transcript.push({ who: 'ai', text: answer });
  saveCall(session);
  return answer;
}

module.exports = { get, turn };
