// ============================================================
// VÉRIFICATION DE LA TABLE À LA MAIN — trois requêtes par set, aucune écriture
// ============================================================
//   node collecte-cartes/verifier-table.js            -> toutes les lignes non vérifiées
//   node collecte-cartes/verifier-table.js --codes=MFO,ROG
//
// Pour chaque ligne : (1) la page du set (redirections suivies : « Expansion Pack (TCG) » est une
// redirection vers « Base Set (TCG) », Bulbapedia FUSIONNE le set japonais et son jumeau) ; on lit
// `jacards`, `jasetname`, et les entrées `{{TCG ID|Set|Nom|N}}` de la Setlist ; (2) les liens
// sortants, dont on DÉRIVE le motif des titres de cartes — le jeton entre parenthèses le plus
// fréquent — au lieu de le supposer ; (3) UNE page de carte, pour lire le nom exact que
// `jpexpansion=` donne au set japonais : c'est ce nom, pas le titre de la page, qui fait la
// jointure. Le résultat s'imprime ; la table se met à jour À LA MAIN, ligne par ligne.
//
// Débit : bulba.js, 1 requête / 5 s, jamais en parallèle. Rien n'est écrit nulle part.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bulba = require('./bulba');
const { faitsDeSet, faitsDeCarte } = require('./wikitext');
const { TABLE } = require('./table-sets');

const arg = nom => { const a = process.argv.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : null; };
const echapper = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function verifier(L) {
    const r = { code: L.code, titreTable: L.bulba.titre, expansionTable: L.bulba.expansion, attenduTable: L.attendu };
    // (1) la page du set
    const { pages, redirections, manquantes } = await bulba.revisionsDe([L.bulba.titre]);
    if (!pages.length) {
        const d = await bulba.api({ action: 'query', list: 'search', srsearch: `${L.nom} TCG`, srlimit: 5, srnamespace: 0 });
        r.etat = 'PAGE ABSENTE'; r.candidats = (d.query?.search || []).map(s => s.title);
        return r;
    }
    const p = pages[0];
    r.titreResolu = p.title; r.redirection = redirections.get(L.bulba.titre) || null; r.pageid = p.pageid;
    const f = faitsDeSet(p.content) || {};
    r.jasetname = f.nomJa; r.transsetname = f.nomJaTraduit; r.jacards = f.cartesJa; r.encards = f.cartesEn; r.jarelease = f.sortieJa;
    const tcgIds = [...p.content.matchAll(/\{\{TCG ID\|([^|}]+)\|([^|}]+)\|([^|}]+)\}\}/g)].map(m => ({ set: m[1].trim(), nom: m[2].trim(), num: m[3].trim() }));
    const titresTcgId = [...new Set(tcgIds.map(t => `${t.nom} (${t.set} ${t.num})`))];
    const setsTcgId = {};
    for (const t of tcgIds) setsTcgId[t.set] = (setsTcgId[t.set] || 0) + 1;
    r.tcgIdParSet = setsTcgId; r.titresTcgId = titresTcgId.length;
    // (2) les liens et le motif dérivé
    const liens = await bulba.liensDe(p.title);
    const jetons = {};
    for (const t of liens) { const m = t.match(/\(([^()]+?) \d+\)$/); if (m) jetons[m[1]] = (jetons[m[1]] || 0) + 1; }
    const classes = Object.entries(jetons).sort((a, b) => b[1] - a[1]);
    r.liens = liens.length; r.jetons = Object.fromEntries(classes.slice(0, 6));
    const meilleur = classes[0]?.[0] || null;
    r.motifDerive = meilleur ? `\\(${echapper(meilleur)} \\d+\\)$` : null;
    const motifRe = r.motifDerive ? new RegExp(r.motifDerive) : null;
    const titresMotif = motifRe ? liens.filter(t => motifRe.test(t)) : [];
    r.titresMotif = titresMotif.length;
    const union = [...new Set([...titresMotif, ...titresTcgId])];
    r.titresUnion = union.length;
    r.horsMotifDansTcgId = titresTcgId.filter(t => !motifRe || !motifRe.test(t)).slice(0, 12);
    // (3) une page de carte : le nom exact de jpexpansion
    const echantillon = titresMotif[Math.floor(titresMotif.length / 2)] || titresTcgId[0];
    if (echantillon) {
        const { pages: pc } = await bulba.revisionsDe([echantillon]);
        if (pc.length) {
            const fc = faitsDeCarte(pc[0].content);
            const jp = [...new Set(fc.impressions.filter(i => i.tirage === 'jp').map(i => i.expansion))];
            r.echantillon = pc[0].title; r.jpExpansionsEchantillon = jp;
            r.expansionConcorde = jp.includes(L.bulba.expansion);
        }
    }
    r.etat = (r.jacards != null && r.expansionConcorde) ? 'OK' : 'À REGARDER';
    return r;
}

(async () => {
    const codes = arg('codes') ? arg('codes').split(',').map(s => s.trim()) : null;
    const lignes = TABLE.filter(l => codes ? codes.includes(l.code) : !l.verifie);
    console.log(`${lignes.length} lignes à vérifier, 3 requêtes chacune, 5 s d'intervalle → ~${Math.ceil(lignes.length * 3 * 5 / 60)} min\n`);
    const resultats = [];
    for (const L of lignes) {
        try {
            const r = await verifier(L);
            resultats.push(r);
            console.log(`${r.code.padEnd(7)} ${r.etat.padEnd(12)} page « ${r.titreResolu ?? '—'} »${r.redirection ? ' (redirigé)' : ''} · jacards ${r.jacards ?? '?'} (table ${r.attenduTable}) · liens ${r.liens ?? '?'} · motif ${r.motifDerive ?? '?'} → ${r.titresMotif ?? '?'} titres, union TCG ID ${r.titresUnion ?? '?'} · jpexpansion ${r.expansionConcorde ? '✅' : '❌'} ${JSON.stringify(r.jpExpansionsEchantillon || r.candidats || [])}`);
            if (r.horsMotifDansTcgId?.length) console.log(`        hors motif mais dans la Setlist : ${r.horsMotifDansTcgId.join(' | ')}`);
        } catch (e) {
            resultats.push({ code: L.code, etat: 'ERREUR', erreur: e.message });
            console.log(`${L.code.padEnd(7)} ERREUR ${e.message}`);
        }
    }
    const sortie = arg('sortie') || path.join(__dirname, 'rapports', `verification-table-${new Date().toISOString().slice(0, 10)}.json`);
    fs.mkdirSync(path.dirname(sortie), { recursive: true });
    fs.writeFileSync(sortie, JSON.stringify(resultats, null, 1));
    console.log(`\nrequêtes : ${bulba.compteRequetes()} · résultats : ${sortie}`);
})().catch(e => { console.error('ERREUR', e); process.exit(1); });
