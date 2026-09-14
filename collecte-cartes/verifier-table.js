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

// ════════════════════════════════════════════════════════════════════════════
// --auto : les lignes GÉNÉRÉES (table-sets-auto.json), PAR BLOC, en DEUX requêtes par bloc
// ════════════════════════════════════════════════════════════════════════════
//   node collecte-cartes/verifier-table.js --auto [--bloc=20]
// (1) toutes les pages de set du bloc en UNE requête `revisions` (lot de 50, redirections suivies) ;
// (2) une carte-échantillon par set, toutes en UNE requête. Critères, tous imprimés, tous nécessaires :
//   · la page existe ;
//   · `entreesDeLaSetlist` — LA fonction du collecteur — rend au moins une entrée ;
//   · la carte-échantillon porte une impression de l'expansion sous le tirage de la ligne ; si la ligne
//     n'a pas de tirage (appariée par page), il est ÉTABLI ici, et seulement s'il n'y en a qu'un ;
//   · entrées / produits Cardmarket dans [0,5 ; 1,5] — l'écart mesuré sur 291 appariés : médiane 1,12.
// OK -> `verifie` posé. Sinon `verif.raisons` dit lequel a manqué, et la ligne attend une main.
// Écrit table-sets-auto.json (un fichier de l'outil, pas la base). Sous le verrou global bulbapedia.
async function verifierAuto() {
    const { TABLE_AUTO, FICHIER_AUTO } = require('./table-sets');
    const { entreesDeLaSetlist } = require('./wikitext');
    const { ouvrirConnexions } = require('./garde');
    const { modeles } = require('./schemas');
    const { fabriquerVerrou } = require('./verrou-source');
    const taille = Number(arg('bloc') || 20);
    const bloc = TABLE_AUTO.filter(l => !l.verif).slice(0, taille);
    console.log(`--auto : ${TABLE_AUTO.length} lignes générées · ${TABLE_AUTO.filter(l => l.verifie).length} vérifiées · ${TABLE_AUTO.filter(l => l.verif && !l.verifie).length} à regarder · bloc de ${bloc.length}, ~${2 * Math.ceil(bloc.length / 50)} requêtes`);
    if (!bloc.length) return;
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const verrou = fabriquerVerrou({ Modele: modeles(cx).EtatImages, id: 'bulbapedia/__collecteur__', dureeMs: 3 * 60 * 1000, surInsertion: { phase: 'collecteur' }, nom: 'verrou global bulbapedia (vérification)' });
    const tenu = await verrou.prendre();
    if (tenu) { console.error(`❌ ARRÊT : verrou bulbapedia tenu par pid ${tenu.pid} sur ${tenu.hote} (battement il y a ${tenu.ageS} s).`); await fermer(); process.exit(1); }
    try {
        const { pages, redirections } = await bulba.revisionsDe(bloc.map(l => l.bulba.titre));
        const pageDe = t => pages.find(p => p.title === (redirections.get(t) || t)) || pages.find(p => p.title === t);
        const echantillons = new Map();
        for (const l of bloc) {
            const p = pageDe(l.bulba.titre);
            l._p = p;
            if (!p) continue;
            l._entrees = entreesDeLaSetlist(p.content, l.bulba).entrees;
            const e = l._entrees[Math.floor(l._entrees.length / 2)];
            if (e) echantillons.set(l.code, e.titre);
        }
        const { pages: pc, redirections: rc } = echantillons.size ? await bulba.revisionsDe([...new Set(echantillons.values())]) : { pages: [], redirections: new Map() };
        const carteDe = t => pc.find(p => p.title === (rc.get(t) || t));
        const ajd = new Date().toISOString().slice(0, 10);
        for (const l of bloc) {
            const raisons = [];
            const v = { le: ajd, pageResolue: l._p?.title ?? null, entrees: l._entrees?.length ?? 0 };
            if (!l._p) raisons.push('page absente');
            else if (!v.entrees) raisons.push(`aucune entrée de Setlist pour « ${l.bulba.expansion} »`);
            const c = echantillons.has(l.code) ? carteDe(echantillons.get(l.code)) : null;
            if (l._p && v.entrees && !c) raisons.push('carte-échantillon introuvable');
            if (c) {
                const imps = faitsDeCarte(c.content).impressions.filter(i => i.expansion === l.bulba.expansion);
                const tirages = [...new Set(imps.map(i => i.tirage))];
                v.echantillon = c.title; v.tiragesVus = tirages;
                if (l.bulba.tirage) { if (!tirages.includes(l.bulba.tirage)) raisons.push(`l'échantillon n'a pas de tirage ${l.bulba.tirage} « ${l.bulba.expansion} » (vus : ${tirages.join(',') || 'aucun'})`); }
                else if (tirages.length === 1 && ['jp', 'intl'].includes(tirages[0])) { v.tirageEtabli = tirages[0]; }
                else raisons.push(`tirage non établi (vus : ${tirages.join(',') || 'aucun'})`);
            }
            v.ratio = l.attendu ? Math.round(100 * v.entrees / l.attendu) / 100 : null;
            if (v.entrees && (v.ratio < 0.5 || v.ratio > 1.5)) raisons.push(`entrées/produits ${v.ratio} hors [0,5 ; 1,5]`);
            v.etat = raisons.length ? 'À REGARDER' : 'OK';
            v.raisons = raisons;
            l.verif = v;
            if (v.tirageEtabli && !raisons.length) { l.bulba.tirage = v.tirageEtabli; l.region = v.tirageEtabli === 'jp' ? 'japonais' : 'occidental'; }
            if (v.etat === 'OK') l.verifie = { le: ajd, page: v.pageResolue, entrees: { [l.bulba.expansion]: v.entrees }, note: `vérification automatique : ${v.entrees} entrées pour ${l.attendu} produits, échantillon « ${v.echantillon} » (${l.bulba.tirage})` };
            delete l._p; delete l._entrees;
            console.log(`${l.code.padEnd(10)} ${v.etat.padEnd(11)} ${String(l.attendu).padStart(4)} produits · ${String(v.entrees).padStart(4)} entrées (${v.ratio}) · ${l.bulba.tirage ?? '?'} · « ${l.bulba.titre} »${v.pageResolue && v.pageResolue !== l.bulba.titre ? ` → « ${v.pageResolue} »` : ''}${raisons.length ? ' — ' + raisons.join(' ; ') : ''}`);
        }
        fs.writeFileSync(FICHIER_AUTO, JSON.stringify(TABLE_AUTO, null, 1));
        const ok = bloc.filter(l => l.verif.etat === 'OK').length;
        console.log(`\nBLOC : ${ok} OK / ${bloc.length} · requêtes Bulbapedia ${bulba.compteRequetes()} · écrit ${path.relative(process.cwd(), FICHIER_AUTO)}`);
    } finally { await verrou.rendre(); await fermer(); }
}

(async () => {
    if (process.argv.includes('--auto')) { await verifierAuto(); return; }
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
