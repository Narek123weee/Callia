const express = require('express');
const path = require('path');
const config = require('./config');

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', require('./routes/api'));
app.use('/voice', require('./routes/voice'));

app.listen(config.port, () => {
  console.log(`Callia running at http://localhost:${config.port}`);
  const key = config.speech.apiKey;
  console.log('Voice key:', key ? `${key.slice(0, 4)}... (${key.length} characters)` : 'missing (set SPEECH_API_KEY in .env)');
  if (!config.llm.configured) console.log('No LLM_API_KEY set: running in demo mode.');
});
