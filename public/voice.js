const TARGET_RATE = 16000;
const END_SILENCE_MS = 600;
const MIN_SPEECH_MS = 500;
const MAX_UTTERANCE_MS = 20000;
const PREROLL_FRAMES = 4;

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function encodeWav(frames, inputRate) {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const samples = new Float32Array(total);
  let offset = 0;
  frames.forEach(f => { samples.set(f, offset); offset += f.length; });

  const ratio = inputRate / TARGET_RATE;
  const length = Math.floor(samples.length / ratio);
  const pcm = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j++) sum += samples[j];
    const value = Math.max(-1, Math.min(1, sum / Math.max(1, to - from)));
    pcm[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }

  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const write = (pos, text) => [...text].forEach((ch, i) => view.setUint8(pos + i, ch.charCodeAt(0)));
  write(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  write(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_RATE, true);
  view.setUint32(28, TARGET_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  new Int16Array(buffer, 44).set(pcm);
  return toBase64(new Uint8Array(buffer));
}

async function createListener({ onUtterance, onSpeech }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
  });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);

  let active = true;
  let busy = false;
  let speaking = false;
  let frames = [];
  let preroll = [];
  let silenceMs = 0;
  let speechMs = 0;
  let totalMs = 0;
  let noise = 0.01;

  function finish() {
    const captured = frames;
    const heardEnough = speechMs >= MIN_SPEECH_MS;
    speaking = false;
    frames = [];
    if (!heardEnough) return;
    busy = true;
    onUtterance(encodeWav(captured, ctx.sampleRate));
  }

  processor.onaudioprocess = event => {
    if (!active || busy) return;
    const frame = new Float32Array(event.inputBuffer.getChannelData(0));
    const ms = (frame.length / ctx.sampleRate) * 1000;

    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    const loud = rms > Math.max(0.02, noise * 3);

    if (!speaking) {
      if (!loud) {
        noise = noise * 0.95 + rms * 0.05;
        preroll.push(frame);
        if (preroll.length > PREROLL_FRAMES) preroll.shift();
        return;
      }
      speaking = true;
      frames = [...preroll];
      preroll = [];
      speechMs = 0;
      silenceMs = 0;
      totalMs = 0;
      onSpeech?.();
    }

    frames.push(frame);
    totalMs += ms;
    if (loud) { speechMs += ms; silenceMs = 0; } else { silenceMs += ms; }
    if (silenceMs >= END_SILENCE_MS || totalMs >= MAX_UTTERANCE_MS) finish();
  };

  source.connect(processor);
  processor.connect(ctx.destination);

  return {
    isActive: () => active,
    setBusy(value) {
      busy = value;
      if (value) { speaking = false; frames = []; preroll = []; }
    },
    stop() {
      active = false;
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach(track => track.stop());
      ctx.close();
    }
  };
}

function earcon() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    setTimeout(() => ctx.close(), 400);
  } catch {}
}
