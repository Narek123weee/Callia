const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');

process.env.DB_FILE = path.join(os.tmpdir(), `callia-test-${Date.now()}.json`);

const tools = require('../src/tools');
const sessions = require('../src/sessions');
const db = require('../src/db');

const MONDAY = '2030-01-07';
const SUNDAY = '2030-01-06';
const booking = { name: 'Anna', phone: '+37499000000', service: 'Cleaning', date: MONDAY, time: '10:00' };

test('availability lists slots on a weekday and none on Sunday', () => {
  assert.strictEqual(tools.run('check_availability', { date: MONDAY }, {}).free_slots.length, 8);
  assert.strictEqual(tools.run('check_availability', { date: SUNDAY }, {}).free_slots.length, 0);
});

test('booking saves the appointment and blocks the same slot', () => {
  assert.strictEqual(tools.run('book_appointment', booking, {}).ok, true);
  assert.strictEqual(tools.run('book_appointment', booking, {}).ok, false);
  assert.ok(!tools.run('check_availability', { date: MONDAY }, {}).free_slots.includes('10:00'));
  assert.strictEqual(db.load().appointments.length, 1);
});

test('transfer tool flags the session', () => {
  const session = {};
  tools.run('transfer_to_human', { reason: 'angry' }, session);
  assert.strictEqual(session.transfer, true);
});

test('asking for a person transfers without calling any AI, in three languages', async () => {
  for (const text of ['I want a human', 'хочу оператора', 'Ուզում եմ օպերատոր']) {
    const session = sessions.get('t-' + text, 'web');
    await sessions.turn(session, text);
    assert.strictEqual(session.transfer, true);
  }
});
