const $ = selector => document.querySelector(selector);
const sessionId = 'web-' + Math.random().toString(36).slice(2);

const escapeHtml = s =>
  String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const adminToken = () => localStorage.getItem('adminToken') || '';

const api = (url, options = {}) =>
  fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-admin-token': adminToken() }
  }).then(r => r.json());

const loaders = { overview: loadOverview, appts: loadAppointments, calls: loadCalls, settings: loadSettings };

document.querySelectorAll('nav button').forEach(button => {
  button.onclick = () => {
    document.querySelectorAll('nav button, section').forEach(el => el.classList.remove('on'));
    button.classList.add('on');
    $('#' + button.dataset.tab).classList.add('on');
    loaders[button.dataset.tab]?.();
  };
});

function addMessage(who, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + who;
  div.textContent = text;
  $('#log').append(div);
  $('#log').scrollTop = $('#log').scrollHeight;
}

const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

let listener = null;

const STATES = { 'Listening...': 'listening', 'Hearing you...': 'hearing', 'Thinking...': 'thinking', 'Speaking...': 'speaking' };

function setStatus(text) {
  $('#status').textContent = text;
  document.body.dataset.state = STATES[text] || 'idle';
}

function idleStatus() {
  return listener?.isActive() ? 'Listening...' : 'Microphone off';
}

function finishTurn() {
  listener?.setBusy(false);
  setStatus(idleStatus());
}

function stopListening() {
  listener?.stop();
  listener = null;
  $('#listen').textContent = 'Start call';
  setStatus('Microphone off');
}

function showTransfer(number) {
  addMessage('sys', 'The receptionist is handing this call to a staff member.');
  const box = document.createElement('div');
  box.className = 'msg sys';
  box.innerHTML = `On a real phone call the caller is connected to ${escapeHtml(number)} automatically. In this browser test you can <a href="tel:${escapeHtml(number)}">call ${escapeHtml(number)}</a> yourself.`;
  $('#log').append(box);
  $('#log').scrollTop = $('#log').scrollHeight;
  $('#msg').disabled = true;
  $('#send').disabled = true;
}

function playReply(res) {
  listener?.setBusy(true);
  setStatus('Speaking...');

  if (res.audio) {
    const audio = new Audio('data:audio/wav;base64,' + res.audio);
    audio.onended = finishTurn;
    audio.onerror = finishTurn;
    audio.play().catch(finishTurn);
    return;
  }

  if (res.ttsError) addMessage('sys', 'Voice unavailable (' + res.ttsError + '). Using the browser voice.');
  if (!('speechSynthesis' in window)) return finishTurn();
  const utterance = new SpeechSynthesisUtterance(res.reply);
  utterance.lang = 'hy-AM';
  utterance.onend = finishTurn;
  utterance.onerror = finishTurn;
  speechSynthesis.speak(utterance);
}

function handleReply(res) {
  addMessage('ai', res.reply);
  if (res.timing) {
    const t = res.timing;
    const sec = ms => (ms / 1000).toFixed(1);
    const label = t.stt !== null
      ? `Heard in ${sec(t.stt)} s, answered in ${sec(t.llm)} s`
      : `Heard and answered in ${sec(t.llm)} s`;
    addMessage('sys', `${label}, voice in ${sec(t.tts)} s`);
  } else if (res.ms) {
    addMessage('sys', `Answered in ${(res.ms / 1000).toFixed(1)} s`);
  }
  if (res.transfer) {
    stopListening();
    showTransfer(res.number);
  }
  playReply(res);
}

async function send(text) {
  text = text.trim();
  if (!text) return;
  addMessage('caller', text);
  $('#msg').value = '';
  listener?.setBusy(true);
  setStatus('Thinking...');

  try {
    const res = await post('/api/chat', { sessionId, message: text, speak: true });
    if (res.error) {
      addMessage('sys', 'Error: ' + res.error);
      return finishTurn();
    }
    handleReply(res);
  } catch {
    addMessage('sys', 'Could not reach the server.');
    finishTurn();
  }
}

async function onUtterance(audio) {
  earcon();
  setStatus('Thinking...');
  try {
    const res = await post('/api/voice', { sessionId, audio });
    if (res.error) {
      addMessage('sys', 'Error: ' + res.error);
      return finishTurn();
    }
    if (res.empty) return finishTurn();
    addMessage('caller', res.transcript);
    handleReply(res);
  } catch {
    addMessage('sys', 'Could not reach the server.');
    finishTurn();
  }
}

$('#send').onclick = () => send($('#msg').value);
$('#msg').onkeydown = e => e.key === 'Enter' && send($('#msg').value);

$('#listen').onclick = async () => {
  if (listener?.isActive()) return stopListening();
  try {
    listener = await createListener({ onUtterance, onSpeech: () => setStatus('Hearing you...') });
    $('#listen').textContent = 'End call';
    setStatus('Listening...');
    greet();
  } catch {
    addMessage('sys', 'Microphone access was blocked. Allow it in your browser settings and try again.');
  }
};

let greeted = false;

async function greet() {
  if (greeted) return;
  greeted = true;
  listener?.setBusy(true);
  setStatus('Speaking...');
  try {
    const res = await fetch('/api/greeting').then(r => r.json());
    playReply({ reply: res.text, audio: res.audio, ttsError: res.ttsError });
  } catch {
    finishTurn();
  }
}

fetch('/api/greeting?audio=0').then(r => r.json()).then(res => addMessage('ai', res.text)).catch(() => {});

const plural = (n, word) => (n === 1 ? word : word + 's');
const when = iso => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function loadOverview() {
  const [calls, appts, business] = await Promise.all([api('/api/calls'), api('/api/appointments'), api('/api/business')]);
  if (business.name) $('#bizName').textContent = business.name;
  if (!Array.isArray(calls) || !Array.isArray(appts)) {
    $('#summary').textContent = 'Enter your admin token in Business settings to see activity.';
    return;
  }
  const passed = calls.filter(c => c.transferred).length;
  $('#summary').innerHTML = calls.length
    ? `Callia has handled <strong>${calls.length}</strong> ${plural(calls.length, 'call')}, booked <strong>${appts.length}</strong> ${plural(appts.length, 'appointment')} and passed <strong>${passed}</strong> to your team.`
    : 'No calls yet. Open the live demo and talk to Callia to see activity here.';
  $('#recentCalls').innerHTML = calls.slice(0, 5).map(c =>
    `<div class="row-item"><span>${escapeHtml(c.transcript.find(t => t.who === 'caller')?.text || 'Call')}</span><small>${when(c.startedAt)}</small></div>`
  ).join('') || '<div class="empty">No calls yet.</div>';
  $('#nextAppts').innerHTML = appts.slice(0, 5).map(a =>
    `<div class="row-item"><span>${escapeHtml(a.name)}, ${escapeHtml(a.service)}</span><small>${escapeHtml(a.date)} ${escapeHtml(a.time)}</small></div>`
  ).join('') || '<div class="empty">No appointments yet. Ask Callia to book one in the live demo.</div>';
}

async function loadAppointments() {
  const list = await api('/api/appointments');
  if (!Array.isArray(list) || !list.length) {
    $('#apptList').innerHTML = '<div class="empty">No appointments yet. Ask Callia to book one in the live demo.</div>';
    return;
  }
  const rows = list.map(a => `
    <tr>
      <td>${escapeHtml(a.date)} ${escapeHtml(a.time)}</td>
      <td>${escapeHtml(a.name)}</td>
      <td>${escapeHtml(a.phone)}</td>
      <td>${escapeHtml(a.service)}</td>
      <td><button class="cancel" data-id="${escapeHtml(a.id)}">Cancel</button></td>
    </tr>`).join('');
  $('#apptList').innerHTML = `<table><tr><th>When</th><th>Name</th><th>Phone</th><th>Service</th><th></th></tr>${rows}</table>`;
  document.querySelectorAll('.cancel').forEach(button => {
    button.onclick = async () => {
      await api('/api/appointments/' + button.dataset.id, { method: 'DELETE' });
      loadAppointments();
    };
  });
}

async function loadCalls() {
  const list = await api('/api/calls');
  if (!Array.isArray(list) || !list.length) {
    $('#callList').innerHTML = '<div class="empty">No calls yet. Start a call in the live demo.</div>';
    return;
  }
  $('#callList').innerHTML = list.map(call => {
    const first = call.transcript.find(t => t.who === 'caller')?.text || 'Call';
    const chips = `<span class="chip">${escapeHtml(call.channel)}</span>` + (call.transferred ? '<span class="chip warn">Passed to staff</span>' : '');
    const lines = call.transcript
      .map(t => `<div class="line ${t.who}"><b>${t.who === 'ai' ? 'Callia' : 'Caller'}</b><span>${escapeHtml(t.text)}</span></div>`)
      .join('');
    return `<details class="call"><summary><span class="when">${when(call.startedAt)}</span><span class="first">${escapeHtml(first)}</span>${chips}</summary><div class="lines">${lines}</div></details>`;
  }).join('');
}

const fields = {
  name: 'Business name',
  greeting: 'Greeting',
  hours: 'Working hours',
  address: 'Address',
  transferNumber: 'Transfer number (staff phone)',
  services: 'Services and prices',
  faqs: 'FAQ and policies',
  languages: 'Languages'
};

async function loadSettings() {
  $('#token').value = adminToken();
  const business = await api('/api/business');
  if (business.error) {
    $('#form').innerHTML = '<div class="empty">Enter your admin token below, save, then reopen this tab.</div>';
    return;
  }
  $('#form').innerHTML = Object.entries(fields).map(([key, label]) => {
    const rows = ['services', 'faqs', 'greeting'].includes(key) ? 3 : 1;
    return `<label for="f_${key}">${label}</label><textarea id="f_${key}" rows="${rows}">${escapeHtml(business[key])}</textarea>`;
  }).join('');
}

$('#save').onclick = async () => {
  localStorage.setItem('adminToken', $('#token').value);
  const body = {};
  Object.keys(fields).forEach(key => {
    const el = $('#f_' + key);
    if (el) body[key] = el.value;
  });
  if (Object.keys(body).length) await api('/api/business', { method: 'PUT', body: JSON.stringify(body) });
  $('#saved').textContent = 'Saved';
  setTimeout(() => ($('#saved').textContent = ''), 2000);
};

loadOverview();
