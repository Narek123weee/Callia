const express = require('express');
const config = require('../config');
const db = require('../db');
const sessions = require('../sessions');
const speech = require('../speech');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!config.adminToken || req.headers['x-admin-token'] === config.adminToken) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

router.post('/chat', async (req, res) => {
  try {
    const session = sessions.get(req.body.sessionId || 'web-' + Date.now(), 'web');
    const text = String(req.body.message || '').slice(0, 1000);
    const answer = await sessions.turn(session, text);
    const voice = req.body.speak ? await speech.speakable(answer) : {};
    res.json({
      reply: answer,
      ms: session.lastMs,
      ...voice,
      transfer: session.transfer,
      number: session.transfer ? db.load().business.transferNumber : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/voice', async (req, res) => {
  try {
    const session = sessions.get(req.body.sessionId || 'web-' + Date.now(), 'web');
    const audio = String(req.body.audio || '');
    if (audio.length < 20000) return res.json({ empty: true });
    const started = Date.now();
    let transcript;
    let answer;
    let sttMs = null;

    if (config.llm.audioInput) {
      answer = await sessions.turn(session, '', audio);
      transcript = session.lastHeard;
    } else {
      transcript = await speech.transcribe(audio);
      sttMs = Date.now() - started;
      if (!transcript || /^[^\p{L}\p{N}]*$/u.test(transcript)) return res.json({ empty: true });
      answer = await sessions.turn(session, transcript);
    }

    if (!answer) return res.json({ empty: true });

    const voice = await speech.speakable(answer);
    res.json({
      transcript,
      reply: answer,
      ...voice,
      timing: { stt: sttMs, llm: session.lastMs, tts: voice.ttsMs || 0, total: Date.now() - started },
      transfer: session.transfer,
      number: session.transfer ? db.load().business.transferNumber : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/greeting', async (req, res) => {
  const text = db.load().business.greeting;
  if (req.query.audio === '0') return res.json({ text });
  res.json({ text, ...(await speech.speakable(text)) });
});

router.get('/business', requireAdmin, (req, res) => res.json(db.load().business));

router.put('/business', requireAdmin, (req, res) => {
  const data = db.load();
  data.business = { ...data.business, ...req.body };
  db.save(data);
  res.json(data.business);
});

router.get('/appointments', requireAdmin, (req, res) => {
  const list = db.load().appointments.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  res.json(list);
});

router.delete('/appointments/:id', requireAdmin, (req, res) => {
  const data = db.load();
  data.appointments = data.appointments.filter(a => a.id !== req.params.id);
  db.save(data);
  res.json({ ok: true });
});

router.get('/calls', requireAdmin, (req, res) => res.json(db.load().calls.slice().reverse()));

module.exports = router;
