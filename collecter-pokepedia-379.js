// Lit, PAR LA PORTE RÉSEAU SEULEMENT (collecte-cartes/porte-reseau.js : robots, cadence >= 5 s par hôte, arrêt au premier blocage), la page Poképédia
// de chaque espèce listée dans CANDIDATS-379.json. Faits seulement (un nom). Une page déjà lue n'est pas relue. Un hôte fermé arrête le lot : trou nommé.
//   node collecter-pokepedia-379.js [--candidats=<json>] [--pages=<dossier>] [--max=<n>]
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const val = nom => args.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
const inconnus = args.filter(a => !/^--(candidats|pages|max)=.+/.test(a));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const CAND = val('candidats') || 'C:/Users/Yung/rat-market-travail/catalogue/fiches-riches/noms-fr/CANDIDATS-379.json';
const PAGES = path.resolve(val('pages') || 'C:/Users/Yung/rat-market-travail/catalogue/chasse/porte-sorties/noms-fr-379');
const MAX = Number(val('max') || 1000);
(async () => {
    const porte = require('./collecte-cartes/porte-reseau');
    const { fichierPage, urlPage } = require('./collecte-cartes/plan-noms-fr-379');
    const { especes } = JSON.parse(fs.readFileSync(CAND, 'utf8'));
    fs.mkdirSync(PAGES, { recursive: true });
    const bilan = { lues: 0, deja: 0, redirigees: [], http: [], refus: [], arret: null };
    for (const e of especes) {
        const f = path.join(PAGES, fichierPage(e));
        if (fs.existsSync(f)) { bilan.deja++; continue; }
        if (bilan.lues >= MAX) break;
        try {
            const r = await porte.lire(urlPage(e), { texte: true, sortie: f });
            if (r.redirige) bilan.redirigees.push([e, r.redirige]); else bilan.lues++;
        } catch (err) {
            if (err.arret) { bilan.arret = `hôte fermé : ${err.message}`; break; }
            if (err.refus) { bilan.refus.push([e, err.message]); continue; }
            bilan.http.push([e, err.status || err.message]);
        }
    }
    console.log(JSON.stringify({ especes: especes.length, ...bilan }, null, 1));
})().catch(e => { console.error('❌', e.message); process.exit(1); });
