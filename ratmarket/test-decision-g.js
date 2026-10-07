// LE BANC DU PORTAGE DE LA RÈGLE G — la décision de l'API contre celle du labo, requête par requête, sur les mêmes entrées.
//   node ratmarket/test-decision-g.js [<dossier fixtures-g>] [--jeux reel,auto,dracaufeu]
// Les fixtures (pokemon-proxy-labo/rm/exporter_fixtures_g.py) portent, pour chaque requête des trois bancs : les 10 voisins, l'essai retenu,
// les mesures de zones que la décision du labo a DEMANDÉES, et sa décision. On rejoue ratmarket/decision-g.js avec ces mesures : la
// RÈGLE se juge seule. Ce qui doit être identique : affirmé ou non, le produit affirmé, la réponse commune, la question, et la NATURE du
// refus (le début de la raison) — puis les comptes (affirmés, faux) que le labo a annoncés.
// ⚠️ Une mesure DEMANDÉE par le portage mais jamais demandée par le labo est une divergence de chemin : elle lève, elle n'est pas inventée.
'use strict';
const fs = require('fs'), path = require('path');
const G = require('./decision-g');
const dossier = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || 'C:/Users/Yung/Desktop/labo-embedding/rm/fixtures-g';
const jeux = (process.argv.find(a => a.startsWith('--jeux=')) || '--jeux=reel,auto,dracaufeu').slice(7).split(',');
const ctx = G.contexte(JSON.parse(fs.readFileSync(path.join(dossier, 'contexte.json'), 'utf8')));
let echecs = 0, faites = 0;
const verif = (cond, quoi) => { faites++; if (!cond) echecs++; console.log(`${cond ? '✅' : '🔴'} ${quoi}`); };
const nature = r => String(r || '').split(/[:(0-9]/)[0].trim();
for (const jeu of jeux) {
    const f = path.join(dossier, `${jeu}.json`);
    if (!fs.existsSync(f)) { console.log(`⚠️ ${jeu} : pas de fixtures (${f})`); continue; }
    const F = JSON.parse(fs.readFileSync(f, 'utf8'));
    const S = F.seuils;
    let pareil = 0, aff = 0, faux = 0, affLabo = 0, fauxLabo = 0, manquantes = 0;
    const ecarts = [];
    for (const l of F.lignes) {
        const fichier = k => { const x = F.fichierDe[k]; if (!x) throw new Error(`fichier inconnu pour ${k}`); return x; };
        const mesures = {
            comparerPaire: (a, b) => { const v = l.paires[`${fichier(a)}|${fichier(b)}`]; if (!v) { manquantes++; throw new Error(`paire non mesurée par le labo : ${a} | ${b}`); } return v; },
            scoresZones: v => { const z = l.zones[fichier(v)]; if (!z) { manquantes++; throw new Error(`zones non mesurées par le labo : ${v}`); } return z; }
        };
        let d;
        try { d = G.decider(ctx, l, l.nEssais, mesures, S); }
        catch (e) { ecarts.push(`${l.id} : ${e.message}`); continue; }
        const L = l.decision;
        const ok = d.affirme === L.affirme && (d.produit ?? null) === (L.produit ?? null)
            && JSON.stringify(d.reponseCommune ?? null) === JSON.stringify(L.reponseCommune ?? null)
            && JSON.stringify(d.question ?? null) === JSON.stringify(L.question ?? null)
            && nature(d.raison) === nature(L.raison);
        if (ok) pareil++; else ecarts.push(`${l.id} : labo « ${L.raison} » (${L.affirme ? 'affirmé ' + L.produit : 'non'}) · API « ${d.raison} » (${d.affirme ? 'affirmé ' + d.produit : 'non'})`);
        const j = G.juger(d, l.verite);
        if (d.affirme) aff++; if (j === 'FAUX' || j === 'commune-FAUSSE') faux++;
        if (L.affirme) affLabo++; if (l.jugement === 'FAUX' || l.jugement === 'commune-FAUSSE') fauxLabo++;
    }
    console.log(`\n${jeu} : ${F.lignes.length} requêtes · décisions identiques ${pareil}/${F.lignes.length} · affirmés API ${aff} (labo ${affLabo}) · faux API ${faux} (labo ${fauxLabo})`);
    for (const e of ecarts.slice(0, 8)) console.log(`   🔴 ${e}`);
    verif(pareil === F.lignes.length && !manquantes, `${jeu} : la règle portée rend les décisions du labo, toutes (${pareil}/${F.lignes.length}, mesures manquantes ${manquantes})`);
    verif(aff === affLabo && faux === 0, `${jeu} : ${aff} affirmés, ${faux} faux — les chiffres du labo (${affLabo} affirmés, ${fauxLabo} faux)`);
}
console.log(`\n${echecs ? `🔴 ${echecs} échec(s)` : '✅ tout passe'} sur ${faites} vérifications`);
process.exit(echecs ? 1 : 0);
