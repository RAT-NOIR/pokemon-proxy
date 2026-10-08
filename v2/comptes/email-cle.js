'use strict';
const fs = require('fs'), path = require('path');
const JETABLES = new Set(fs.readFileSync(path.join(__dirname, 'domaines-jetables.txt'), 'utf8').split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(s => s && !s.startsWith('#')));
function emailCle(brut) {
    if (typeof brut !== 'string') return null;
    const s = brut.normalize('NFKC').trim().toLowerCase();
    const m = /^([^@\s]+)@([^@\s]+\.[^@\s]{2,})$/.exec(s);
    if (!m) return null;
    let [, local, domaine] = m;
    if (domaine === 'googlemail.com') domaine = 'gmail.com';
    if (domaine === 'gmail.com') { local = local.split('+')[0].replace(/\./g, ''); if (!local) return null; }
    return `${local}@${domaine}`;
}
function estJetable(domaine) {
    const parties = String(domaine).toLowerCase().split('.');
    for (let i = 0; i < parties.length - 1; i++) if (JETABLES.has(parties.slice(i).join('.'))) return true;
    return false;
}
module.exports = { emailCle, estJetable };
