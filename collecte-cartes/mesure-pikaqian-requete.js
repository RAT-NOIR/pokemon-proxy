// Mesure PIKAQIAN (lot A, etape 1) : UNE requete GET, redirect manual, pause >= 10 s depuis la precedente,
// plafond de 40 requetes vers pikaqian.com, journal horodate UTC. Aucune ecriture en base.
// Usage : node mesure-pikaqian-requete.js <url> <fichier-sortie> [--hote-image=<hote>]
'use strict';
const fs = require('fs');
const path = require('path');

const UA = 'rat-market-catalogue/1.0 (+https://rat-market.fr ; une requete / 10 s)';
const DOSSIER = process.env.PIKAQIAN_DOSSIER || __dirname;
const JOURNAL = path.join(DOSSIER, 'pikaqian-journal.jsonl');
const PLAFOND = 40;

function lireJournal() {
  if (!fs.existsSync(JOURNAL)) return [];
  return fs.readFileSync(JOURNAL, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

(async () => {
  const [url, sortie, ...opts] = process.argv.slice(2);
  if (!url || !sortie) throw new Error('usage: <url> <sortie> [--hote-image=h]');
  const hoteImage = (opts.find(o => o.startsWith('--hote-image=')) || '').split('=')[1];
  const u = new URL(url);
  const ok = u.hostname === 'pikaqian.com' || u.hostname.endsWith('.pikaqian.com') || (hoteImage && u.hostname === hoteImage);
  if (!ok) throw new Error('hote refuse : ' + u.hostname);
  if (u.pathname.startsWith('/api/')) throw new Error('/api/ interdit');
  const j = lireJournal();
  const nbSite = j.filter(e => /pikaqian\.com$/.test(new URL(e.url).hostname)).length;
  if (u.hostname.endsWith('pikaqian.com') && nbSite >= PLAFOND) throw new Error('plafond de 40 atteint');
  if (j.length) {
    const attente = 10500 - (Date.now() - new Date(j[j.length - 1].heure).getTime());
    if (attente > 0) await new Promise(r => setTimeout(r, attente));
  }
  const heure = new Date().toISOString();
  let statut = 'erreur', entetes = {}, taille = 0;
  try {
    const r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: '*/*' } });
    statut = r.status;
    r.headers.forEach((v, k) => { entetes[k] = v; });
    const buf = Buffer.from(await r.arrayBuffer());
    taille = buf.length;
    fs.writeFileSync(sortie, buf);
  } catch (e) { statut = 'erreur: ' + e.message; }
  fs.appendFileSync(JOURNAL, JSON.stringify({ heure, url, statut, taille, entetes }) + '\n');
  console.log(heure, statut, taille, url);
  for (const k of ['server', 'cf-mitigated', 'x-cdn', 'content-type', 'location', 'cf-ray', 'x-powered-by']) if (entetes[k]) console.log('  ' + k + ': ' + entetes[k]);
})().catch(e => { console.error('ERREUR', e.message); process.exit(1); });
