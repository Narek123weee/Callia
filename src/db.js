const fs = require('fs');
const path = require('path');

const FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'db.json');

const defaults = {
  business: {
    name: 'Demo Dental Clinic',
    greeting: 'Hello, thank you for calling Demo Dental Clinic. How can I help you?',
    hours: 'Mon-Sat 10:00-18:00, closed Sunday',
    address: 'Tumanyan 12, Yerevan',
    transferNumber: '+37410000000',
    services: 'Check-up (8000 AMD, 30 min); Cleaning (15000 AMD, 45 min); Whitening (40000 AMD, 60 min)',
    faqs: 'Parking is free in the courtyard. We accept cash and cards. First visit includes a free consultation.',
    languages: 'Armenian, Russian, English'
  },
  appointments: [],
  calls: []
};

function save(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    save(defaults);
    return structuredClone(defaults);
  }
}

module.exports = { load, save };
