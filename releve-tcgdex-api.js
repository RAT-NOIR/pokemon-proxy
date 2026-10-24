// ============================================================
// PHASE 3a — quelques lectures de l'API TCGdex (source ouverte, MIT) pour la seconde source des fiches simples. BUDGET : 50 requêtes en tout, 5 s au moins entre deux.
// ============================================================
//   node releve-tcgdex-api.js --compteur=<fichier.json> --sortie=<dossier> <chemin> [<chemin>…]        ex. en/sets/mep   ja/sets
// Chaque chemin est une lecture GET https://api.tcgdex.net/v2/<chemin> ; la réponse est écrite dans <sortie>/<chemin avec / → _>.json (jamais relue deux fois : un fichier
// déjà là n'est pas redemandé). Le COMPTEUR (fichier) persiste le nombre de requêtes de toute la phase : au-delà de 50, ce script REFUSE avant la requête.
// Premier statut autre que 200/404 : arrêt immédiat (jamais de réessai, jamais de rafale). Aucun verrou en base (lecture seule) : la cadence est tenue ici, seul appelant.
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const BUDGET = 50, INTERVALLE_MS = 5200, API = 'https://api.tcgdex.net/v2';
const args = process.argv.slice(2);
const val = n => (args.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || null;
const COMPTEUR = val('compteur'), SORTIE = val('sortie');
const chemins = args.filter(a => !a.startsWith('--'));
if (!COMPTEUR || !SORTIE || !chemins.length) { console.error('usage : --compteur= --sortie= <chemin>…'); process.exit(2); }
if (chemins.some(c => !/^[\w.-]+(\/[\w.%-]+)*$/.test(c))) { console.error('chemin inattendu'); process.exit(2); }
fs.mkdirSync(SORTIE, { recursive: true });
const lireCompteur = () => (fs.existsSync(COMPTEUR) ? JSON.parse(fs.readFileSync(COMPTEUR, 'utf8')) : { n: 0, journal: [] });
(async () => {
    let C = lireCompteur();
    for (const ch of chemins) {
        const f = path.join(SORTIE, ch.replace(/\//g, '_') + '.json');
        if (fs.existsSync(f)) { console.log(`   déjà lu : ${ch}`); continue; }
        if (C.n >= BUDGET) { console.error(`❌ BUDGET épuisé (${C.n}/${BUDGET}) : ${ch} non demandé`); process.exit(1); }
        if (C.n > 0) await new Promise(r => setTimeout(r, INTERVALLE_MS));
        const r = await axios.get(`${API}/${ch}`, { timeout: 30000, validateStatus: () => true, headers: { 'User-Agent': 'rat-market-catalogue/1.0' } });
        C.n++; C.journal.push({ chemin: ch, statut: r.status, le: new Date().toISOString() });
        fs.writeFileSync(COMPTEUR, JSON.stringify(C, null, 1));
        console.log(`   ${C.n}/${BUDGET} · ${ch} → ${r.status}`);
        if (r.status === 404) { fs.writeFileSync(f, JSON.stringify(null)); continue; }
        if (r.status !== 200) { console.error(`❌ statut ${r.status} : arrêt, aucun réessai`); process.exit(1); }
        fs.writeFileSync(f, JSON.stringify(r.data));
    }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
