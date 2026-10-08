'use strict';
// Le lanceur ne compte vert qu'un banc qui sort en 0 ET imprime un bilan « N réussis, 0 échoués » avec N > 0.
// Chaque cas est un faux banc dans fixtures-lanceur/ (sous-dossier : le lanceur normal ne les voit pas).
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const H = require('./_harnais');
const LANCEUR = path.join(__dirname, 'lancer-tout.js');
const FIX = path.join(__dirname, 'fixtures-lanceur');

if (process.env.RM_LANCEUR_IMBRIQUE) { H.vrai('imbrication évitée (lanceur ancien qui ignore --dossier)', true); H.bilan(); return; }

const lancer = (dossier) => spawnSync(process.execPath, [LANCEUR, `--dossier=${dossier}`], { encoding: 'utf8', env: { ...process.env, RM_LANCEUR_IMBRIQUE: '1' }, timeout: 120000 });
const seul = (nom) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-lanceur-')); fs.copyFileSync(path.join(FIX, nom), path.join(d, nom)); return d; };

for (const nom of ['test-suspens.js', 'test-zero-reussite.js', 'test-echec-et-reussite.js']) {
    const d = seul(nom); const r = lancer(d);
    H.v(`${nom} : le lanceur sort en code 1`, r.status, 1);
    H.vrai(`${nom} : le lanceur le NOMME en rouge`, new RegExp(`🔴 ${nom}`).test(r.stdout || ''));
    fs.rmSync(d, { recursive: true, force: true });
}
const d = seul('test-vert.js'); const r = lancer(d);
H.v('test-vert.js : un banc avec bilan 3/0 est compté vert (code 0)', r.status, 0);
fs.rmSync(d, { recursive: true, force: true });
const vide = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-lanceur-'));
H.v('dossier sans banc : code 1', lancer(vide).status, 1);
fs.rmSync(vide, { recursive: true, force: true });
H.bilan();
