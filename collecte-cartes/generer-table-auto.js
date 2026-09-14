// ============================================================
// LES LIGNES AUTOMATIQUES DE LA TABLE SET → idExpansion — générées, JAMAIS admises sans vérification
// ============================================================
//   node collecte-cartes/generer-table-auto.js            -> écrit collecte-cartes/table-sets-auto.json
//   node collecte-cartes/generer-table-auto.js --cache=<dossier>   -> zéro requête : les deux listes
//        (`liste-EN.wikitext`, `liste-JP.wikitext`) et l'existence des titres (`titres.json`, [{slugSet, page}])
//        relevées lors d'un passage précédent. La date du relevé s'imprime : un cache vieillit.
//
// Mesuré le 2026-09-13 (751 idExpansion de `numeros_cartes`) : 283 par slug exact, 11 par code de set,
// 136 par l'existence d'une page « <nom> (TCG) » — 430 lignes. La table écrite à la main disait « 2 sur
// 177 » : c'était le vintage japonais, dont les noms Cardmarket ne sont pas ceux de Bulbapedia. Le
// moderne et l'occidental, si.
//
// ⚠️ UNE LIGNE GÉNÉRÉE N'EST QU'UNE CANDIDATE. Elle porte `verifie: null` ; collecteur-texte.js refuse
// toute ligne non vérifiée, et seule `verifier-table.js --auto` pose `verifie`, sur des critères imprimés.
//
// EXCLUES, AVANT TOUT APPARIEMENT :
//   · les expansions déjà dans la table à la main (par `exp`) ;
//   · les expansions d'une langue ni japonaise ni occidentale — chinois simplifié (`CS…C`, `CBB…C`,
//     `151C`), promos `…/CS` `…/CT` `…/ID` `…/TH`, `PKMTCH`, slugs Chinese/Taiwan/Indonesian/Thai/IDTH.
//     🔴 20 des 83 expansions chinoises sont rangées « japonais » par codes_set : les prendre pour du
//     japonais, c'est collecter du faux. Le chinois est un chantier distinct (pages « (ATCG) »).
//
// Débit : Bulbapedia, 1 requête pour les deux listes + 1 par lot de 50 titres, sous le verrou global
// `bulbapedia/__collecteur__` (verrou-source.js). Production : LECTURE SEULE.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./garde');
const { modeles } = require('./schemas');
const { fabriquerVerrou } = require('./verrou-source');
const bulba = require('./bulba');
// TABLE_MAIN : les lignes à la main. Pas `TABLE`, qui contient aussi les automatiques déjà vérifiées —
// le générateur les compterait « déjà dans la table » et les effacerait de sa propre sortie.
const { TABLE_MAIN: TABLE, TABLE_AUTO: PRECEDENTES } = require('./table-sets');

const SORTIE = path.join(__dirname, 'table-sets-auto.json');
const LISTES = { EN: 'List of Pokémon Trading Card Game expansions', JP: 'List of Japanese Pokémon Trading Card Game expansions' };

const serre = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
const norm = s => serre(String(s ?? '').replace(/&/g, ' and ').replace(/-/g, ' ').replace(/\b(the|pok[eé]mon|pokemon|tcg)\b/gi, ' '));

/** Langue ni japonaise ni occidentale : le motif qui décide est rendu, pour qu'il se relise. */
function langueAsiatique(codeSet, slugSet) {
    const c = String(codeSet || ''), s = String(slugSet || '');
    if (/^CS.*C$/.test(c)) return 'code CS…C (chinois simplifié)';
    if (/^CBB\d+C$/.test(c)) return 'code CBB…C (Gem Pack, chinois simplifié)';
    if (c === '151C') return 'code 151C (Collect 151, chinois simplifié)';
    if (/\/(CS|CT|ID|TH)$/.test(c)) return `code de promo ${c}`;
    if (c === 'PKMTCH') return 'code PKMTCH (produits chinois traditionnel)';
    if (/Chinese|Taiwan|Hong-Kong|Indonesian|Thai|IDTH|Korean/i.test(s)) return `slug ${s}`;
    return null;
}

/** Les lignes d'une liste Bulbapedia : nom(s) de la cellule du nom, nombre de cartes, abréviation (EN). */
function lignesListe(wt, liste) {
    const out = [];
    let section = '';
    for (const bloc of wt.split(/\n\|-[^\n]*\n/)) {
        const h = [...bloc.matchAll(/^={2,4}([^=]+)={2,4}\s*$/gm)].pop(); if (h) section = h[1].trim();
        const cellules = bloc.split('\n').filter(l => /^\|(?!\}|-)/.test(l)).map(l => l.replace(/^\|\s*(rowspan=\d+\s*\|\s*)?/, '').trim());
        const iNom = cellules.findIndex(c => /\{\{tcg\|/i.test(c));
        if (iNom < 0) continue;
        const noms = [...cellules[iNom].matchAll(/\{\{tcg\|([^}|]+)/gi)].map(x => x[1].trim());
        const cartes = cellules.slice(iNom + 1).map(c => c.match(/^(\d+)\b/)).find(Boolean);
        const code = liste === 'EN' && cellules.length ? (cellules.at(-1).match(/^([A-Za-z0-9-]{1,8})$/) || [])[1] : null;
        for (const nom of noms) out.push({ liste, nom, cartes: cartes && noms.length === 1 ? Number(cartes[1]) : null, code: noms.length === 1 ? code : null, section });
    }
    return out;
}

(async () => {
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const NC = prod.db.collection('numeros_cartes'), CS = prod.db.collection('codes_set');
    const parExp = await NC.aggregate([
        { $match: { idExpansion: { $ne: null } } },
        { $group: { _id: { exp: '$idExpansion', slugSet: '$slugSet' }, n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $group: { _id: '$_id.exp', slugSet: { $first: '$_id.slugSet' }, produits: { $sum: '$n' } } }
    ]).toArray();
    const codes = new Map((await CS.find({}).toArray()).map(c => [c.idExpansion, c]));
    console.log(`DÉNOMINATEUR Cardmarket : ${parExp.length} idExpansion (numeros_cartes) · codes_set ${codes.size}`);

    const cache = process.argv.find(a => a.startsWith('--cache='))?.slice(8) || null;
    // Sans cache : verrou global bulbapedia, requêtes. Avec cache : ni verrou ni requête.
    const verrou = cache ? { rendre: async () => { } } : fabriquerVerrou({ Modele: modeles(cx).EtatImages, id: 'bulbapedia/__collecteur__', dureeMs: 3 * 60 * 1000, surInsertion: { phase: 'collecteur' }, nom: 'verrou global bulbapedia (génération de la table)' });
    const tenu = cache ? null : await verrou.prendre();
    if (tenu) { console.error(`❌ ARRÊT : verrou bulbapedia tenu par pid ${tenu.pid} sur ${tenu.hote} (battement il y a ${tenu.ageS} s).`); await fermer(); process.exit(1); }
    const lignes = [];
    try {
        let contenu, titresCache = null;
        if (cache) {
            const lire = f => fs.readFileSync(path.join(cache, f), 'utf8');
            const pages = { [LISTES.EN]: lire('liste-EN.wikitext'), [LISTES.JP]: lire('liste-JP.wikitext') };
            contenu = t => pages[t];
            titresCache = new Map(JSON.parse(lire('titres.json')).map(t => [t.slugSet, t.page ?? null]));
            console.log(`CACHE ${cache} : listes du ${fs.statSync(path.join(cache, 'liste-EN.wikitext')).mtime.toISOString().slice(0, 16)} UTC · ${titresCache.size} titres testés — ZÉRO requête`);
        } else {
            const r = await bulba.revisionsDe(Object.values(LISTES));
            contenu = t => r.pages.find(p => p.title === t)?.content;
            if (!contenu(LISTES.EN) || !contenu(LISTES.JP)) throw new Error(`liste absente : ${r.manquantes.join(' | ')}`);
        }
        const EN = lignesListe(contenu(LISTES.EN), 'EN'), JP = lignesListe(contenu(LISTES.JP), 'JP');
        console.log(`DÉNOMINATEUR Bulbapedia : liste EN ${EN.length} lignes · liste JP ${JP.length} lignes`);
        const index = (ls, f) => { const m = new Map(); for (const l of ls) { const k = f(l); if (!k) continue; (m.get(k) || m.set(k, []).get(k)).push(l); } return m; };
        const idx = { EN: { exact: index(EN, l => serre(l.nom)), norm: index(EN, l => norm(l.nom)), code: index(EN, l => l.code?.toUpperCase()) }, JP: { exact: index(JP, l => serre(l.nom)), norm: index(JP, l => norm(l.nom)) } };

        const dejaTable = new Set(TABLE.map(l => l.exp));
        const compte = { 'déjà dans la table': 0, 'langue asiatique non jp': 0, 'slug exact': 0, 'nom normalisé': 0, 'code de set': 0, 'page (TCG)': 0, ambigu: 0, 'sans appariement': 0 };
        const aTitrer = [];
        for (const e of parExp) {
            const c = codes.get(e._id);
            if (dejaTable.has(e._id)) { compte['déjà dans la table']++; continue; }
            const asia = langueAsiatique(c?.codeSet, e.slugSet);
            if (asia) { compte['langue asiatique non jp']++; continue; }
            const region = c?.region ?? null;
            const listes = region === 'japonais' ? ['JP'] : region === 'occidental' ? ['EN'] : ['EN', 'JP'];
            let t = null, ambigu = false;
            for (const [cle, k, f] of [['slug exact', 'exact', serre], ['nom normalisé', 'norm', norm]]) {
                const cands = listes.flatMap(L => idx[L][k].get(f(e.slugSet)) || []);
                if (cands.length === 1) { t = { cle, l: cands[0] }; break; }
                if (cands.length > 1) { ambigu = true; break; }
            }
            if (!t && !ambigu && c?.codeSet && listes.includes('EN')) {
                const cands = idx.EN.code.get(String(c.codeSet).toUpperCase()) || [];
                if (cands.length === 1) t = { cle: 'code de set', l: cands[0] };
            }
            if (ambigu) { compte.ambigu++; continue; }
            if (!t) { aTitrer.push({ e, c, region }); continue; }
            compte[t.cle]++;
            lignes.push({ e, c, region, cle: t.cle, liste: t.l.liste, nomBulbapedia: t.l.nom, cartesListe: t.l.cartes, section: t.l.section, titre: `${t.l.nom} (TCG)` });
        }
        // Les restes : une page « <slug lisible> (TCG) » existe-t-elle ? (titres seuls, sans contenu)
        let nonTestes = 0;
        for (let i = 0; i < aTitrer.length; i += 50) {
            const lot = aTitrer.slice(i, i + 50).map(x => ({ ...x, titre: `${String(x.e.slugSet).replace(/-/g, ' ')} (TCG)` }));
            const existe = new Map();
            if (titresCache) {
                for (const x of lot) { if (titresCache.has(x.e.slugSet)) existe.set(x.titre, titresCache.get(x.e.slugSet)); else nonTestes++; }
            } else {
                const d = await bulba.api({ action: 'query', titles: lot.map(x => x.titre).join('|'), redirects: 1 });
                const norme = new Map((d.query?.normalized || []).map(n => [n.to, n.from]));
                const redir = new Map((d.query?.redirects || []).map(r => [r.to, r.from]));
                for (const p of d.query?.pages || []) { let o = p.title; if (redir.has(o)) o = redir.get(o); if (norme.has(o)) o = norme.get(o); existe.set(o, p.missing ? null : p.title); }
            }
            for (const x of lot) {
                const page = existe.get(x.titre);
                if (!page) { compte['sans appariement']++; continue; }
                compte['page (TCG)']++;
                lignes.push({ ...x, cle: 'page (TCG)', liste: null, nomBulbapedia: page.replace(/ \(TCG\)$/, ''), cartesListe: null, section: null, titre: page });
            }
        }
        console.log(`\nAPPARIEMENT : ${JSON.stringify(compte, null, 1)}`);
        if (nonTestes) console.log(`⚠️ ${nonTestes} titre(s) absents du cache, comptés « sans appariement » : le cache ne couvre pas ce passage.`);
        console.log(`requêtes Bulbapedia : ${bulba.compteRequetes()}`);
    } finally { await verrou.rendre(); }

    // ---- les lignes, dans l'ordre de collecte : japonais d'abord, puis région à établir, puis occidental ;
    // dans chaque groupe, le plus de produits d'abord.
    const codesPris = new Set(TABLE.map(l => l.code));
    const rang = l => l.liste === 'JP' || (l.liste == null && l.region === 'japonais') ? 0 : l.liste == null ? 1 : 2;
    lignes.sort((a, b) => rang(a) - rang(b) || b.e.produits - a.e.produits);
    const sortie = lignes.map(l => {
        let code = l.c?.codeSet || `X${l.e._id}`;
        if (codesPris.has(code)) code = `${code}-${l.e._id}`;
        codesPris.add(code);
        const tirage = l.liste === 'JP' ? 'jp' : l.liste === 'EN' ? 'intl' : null;   // null : établi à la vérification
        return {
            code, exp: l.e._id, prod: l.e.produits, nom: String(l.e.slugSet).replace(/-/g, ' '), slugSet: l.e.slugSet,
            region: tirage === 'jp' ? 'japonais' : tirage === 'intl' ? 'occidental' : l.region,
            bulba: { titre: l.titre, tirage, expansion: l.nomBulbapedia },
            attendu: l.e.produits,
            auto: { cle: l.cle, liste: l.liste, nomBulbapedia: l.nomBulbapedia, cartesListe: l.cartesListe, sectionListe: l.section, regionCodesSet: l.region, genereLe: new Date().toISOString().slice(0, 10) },
            verifie: null
        };
    });
    // ⚠️ UNE RÉGÉNÉRATION NE PERD PAS UNE VÉRIFICATION : pour le même `exp` et la même page, le résultat
    // de verifier-table.js (verif, verifie, tirage et région établis) est repris tel quel.
    const avant = new Map(PRECEDENTES.map(l => [l.exp, l]));
    let reprises = 0;
    for (const l of sortie) {
        const p = avant.get(l.exp);
        if (p && p.bulba?.titre === l.bulba.titre && p.verif) {
            Object.assign(l, { code: p.code, verif: p.verif, verifie: p.verifie, region: p.region });
            l.bulba.tirage = p.bulba.tirage ?? l.bulba.tirage;
            reprises++;
        }
    }
    if (reprises) console.log(`vérifications reprises du fichier précédent : ${reprises}`);
    fs.writeFileSync(SORTIE, JSON.stringify(sortie, null, 1));
    const par = sortie.reduce((a, l) => (a[l.bulba.tirage ?? 'à établir'] = (a[l.bulba.tirage ?? 'à établir'] || 0) + 1, a), {});
    console.log(`\n${sortie.length} lignes écrites dans ${path.relative(process.cwd(), SORTIE)} · par tirage ${JSON.stringify(par)} · ${sortie.reduce((a, l) => a + l.prod, 0)} produits`);
    await fermer(); process.exit(0);
})().catch(e => { console.error('❌', e); process.exit(1); });
