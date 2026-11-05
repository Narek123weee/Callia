const express = require('express');
const config = require('../config');
const db = require('../db');
const sessions = require('../sessions');

const router = express.Router();

const escapeXml = s =>
  String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

const wrap = body => `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;

const listen = text =>
  `<Gather input="speech" language="${config.voiceLang}" speechTimeout="auto" action="/voice/respond" method="POST">` +
  `<Say language="${config.voiceLang}">${escapeXml(text)}</Say></Gather><Redirect>/voice/respond</Redirect>`;

const transferTo = () => `<Dial>${escapeXml(db.load().business.transferNumber)}</Dial>`;

router.post('/incoming', (req, res) => {
  sessions.get(req.body.CallSid, 'phone');
  res.type('text/xml').send(wrap(listen(db.load().business.greeting)));
});

router.post('/respond', async (req, res) => {
  try {
    const session = sessions.get(req.body.CallSid, 'phone');
    const speech = req.body.SpeechResult;

    if (!speech) return res.type('text/xml').send(wrap(listen("Sorry, I didn't catch that. Could you repeat?")));

    const answer = await sessions.turn(session, speech);

    if (session.transfer) {
      return res.type('text/xml').send(wrap(`<Say language="${config.voiceLang}">${escapeXml(answer)}</Say>${transferTo()}`));
    }
    res.type('text/xml').send(wrap(listen(answer)));
  } catch (err) {
    console.error(err);
    res.type('text/xml').send(wrap(transferTo()));
  }
});

module.exports = router;
