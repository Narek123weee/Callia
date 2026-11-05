const db = require('./db');

const SLOT_HOURS = [10, 11, 12, 13, 14, 15, 16, 17];

const definitions = [
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description: 'List free appointment slots for a date in YYYY-MM-DD format.',
      parameters: { type: 'object', properties: { date: { type: 'string' } }, required: ['date'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'book_appointment',
      description: 'Book an appointment after confirming name, phone, service, date and time with the caller.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          phone: { type: 'string' },
          service: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          time: { type: 'string', description: 'HH:MM' }
        },
        required: ['name', 'phone', 'service', 'date', 'time']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'transfer_to_human',
      description: 'Transfer the call to a staff member when the caller asks, is upset, or the request is complex or unknown.',
      parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] }
    }
  }
];

function freeSlots(date) {
  const day = new Date(date + 'T00:00:00');
  if (isNaN(day) || day.getDay() === 0) return [];
  const taken = db.load().appointments.filter(a => a.date === date).map(a => a.time);
  return SLOT_HOURS.map(h => String(h).padStart(2, '0') + ':00').filter(t => !taken.includes(t));
}

function run(name, input, session) {
  if (name === 'check_availability') {
    return { date: input.date, free_slots: freeSlots(input.date) };
  }

  if (name === 'book_appointment') {
    if (!freeSlots(input.date).includes(input.time)) return { ok: false, error: 'Slot not available' };
    const data = db.load();
    const appointment = { id: Date.now().toString(36), ...input, createdAt: new Date().toISOString() };
    data.appointments.push(appointment);
    db.save(data);
    return { ok: true, appointment };
  }

  if (name === 'transfer_to_human') {
    session.transfer = true;
    session.transferReason = input.reason;
    return { ok: true, number: db.load().business.transferNumber };
  }

  return { error: 'Unknown tool' };
}

module.exports = { definitions, run };
