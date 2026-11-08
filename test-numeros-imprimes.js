// node test-numeros-imprimes.js — collecte-cartes/numeros-imprimes.js sur une FAUSSE BASE en memoire, avec la REGLE DU SITE IMPORTEE
// (exporter-donnees-logos-site.js : regleDuSite / fichesDesProduits). Aucun reseau, aucune vraie base, aucun dossier du testeur.
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTEE du module (le rouge se voit en cassant le code).
// RACINE_SITE=<dossier> : le dossier dont le VOISIN `rat-market-site` porte la regle du site (defaut : le depot principal).
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const NI = require(path.join(DIR, 'collecte-cartes', 'numeros-imprimes.js'));
const FM = require(path.join(DIR, 'collecte-cartes', 'fiches-multi.js'));
const X = require(path.join(__dirname, 'exporter-donnees-logos-site.js'));
const RACINE_SITE = process.env.RACINE_SITE || 'C:/Users/Yung/Desktop/pokemon-proxy';
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

// ── la fausse base (meme moteur que test-fiches-multi.js) ──
function fakeDb(init, opts = {}) {
    const cols = new Map(Object.entries(init).map(([n, docs]) => [n, new Map(docs.map(d => [d._id, structuredClone(d)]))]));
    const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const valeurs = (d, chemin) => { let xs = [d]; for (const k of chemin.split('.')) xs = xs.flatMap(x => (x == null ? [] : Array.isArray(x) ? x.map(y => y?.[k]) : [x[k]])); return xs.flatMap(x => (Array.isArray(x) ? [x, ...x] : [x])); };
    const cond = (d, k, v) => {
        const vs = valeurs(d, k);
        if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).some(o => o.startsWith('$'))) {
            if ('$in' in v) return vs.some(x => v.$in.some(y => egal(x, y)));
            if ('$ne' in v) return !vs.some(x => egal(x, v.$ne));
            throw new Error('operateur non gere par la fausse base : ' + JSON.stringify(v));
        }
        if (v === null) return vs.every(x => x == null);
        return vs.some(x => egal(x, v));
    };
    const correspond = (d, f) => Object.entries(f || {}).every(([k, v]) => cond(d, k, v));
    const poser = (d, chemin, f) => { const ks = chemin.split('.'); let x = d; for (const k of ks.slice(0, -1)) x = x[k] = x[k] || {}; x[ks.at(-1)] = f(x[ks.at(-1)]); };
    const col = nom => { const m = cols.get(nom); if (!m) throw new Error('collection inconnue ' + nom); return {
        find: (f) => ({ toArray: async () => [...m.values()].filter(d => correspond(d, f)).map(d => structuredClone(d)) }),
        async findOne(f) { return structuredClone([...m.values()].find(d => correspond(d, f)) ?? null); },
        countDocuments: async f => [...m.values()].filter(d => correspond(d, f)).length,
        async updateOne(f, u) {
            if (opts.ecrire) opts.ecrire(nom, f, u);
            const d = [...m.values()].find(x => correspond(x, f));
            if (!d) return { matchedCount: 0, modifiedCount: 0 };
            for (const [k, v] of Object.entries(u.$set || {})) poser(d, k, () => structuredClone(v));
            for (const [k, v] of Object.entries(u.$push || {})) poser(d, k, cur => [...(cur || []), ...structuredClone(v.$each || [v])]);
            return { matchedCount: 1, modifiedCount: 1 };
        } }; };
    return { collection: col, brut: nom => [...cols.get(nom).values()].map(d => structuredClone(d)) };
}

// ── le monde : WCD-2009 (code WCD09) et Prize Pack Series Four (code PPS4) ──
const SETW = (o = {}) => ({ _id: 'WCD-2009', code: 'WCD09', idExpansion: [9001], region: 'intl', tirage: 'intl', nomAffichage: 'WCD 2009', bulba: { titre: null, expansion: null }, ...o });
const SETP = (o = {}) => ({ _id: 'Play-Pokemon-Prize-Pack-Series-Four', code: 'PPS4', idExpansion: [9002], region: 'intl', tirage: 'intl', nomAffichage: 'PPS4', bulba: { titre: null, expansion: null }, ...o });
const IMP = (expansion, numero, total = null, o = {}) => ({ tirage: 'intl', expansion, deck: null, numero, total, rarete: null, ...o });
const CARTE = (id, nomEn, sets, impressions, images, idProduct) => ({ _id: id, nomEn, sets, impressions, images, liens: { idProduct, idMetacards: [] } });
const LIGNE = (idProduct, carteId, slug, slugSet, idExpansion, o = {}) => ({ _id: `${carteId}|${idProduct}`, carteId, idProduct, idExpansion, tirage: 'intl', preuve: 'wcd+origine+numero', slug, slugSet, ...o });
const IMGW = (cle, o = {}) => ({ set: 'WCD-2009', cleR2: cle, numero: null, ...o });
const LEC = (idProduct, carteId, set, numeroLu, totalLu, cleR2, marque, o = {}) => ({ idProduct, carteId, set, numeroLu, totalLu, marque, cleR2, luPar: 'chasseur-1/planche-3', luLe: '2026-11-08', ...o });
function monde(o = {}) {
    return fakeDb({
        sets: [SETW(o.setW), SETP(o.setP)],
        cartes: [
            CARTE(10, 'Trapinch', ['WCD-2009'], [IMP('Stormfront', '115', '100')], [IMGW('wcd/10.webp')], [1001]),
            CARTE(11, 'Flygon LV.X', ['WCD-2009'], [IMP('Stormfront', '105', '111')], [IMGW('wcd/11.webp')], [1002]),
            CARTE(20, 'Mimikyu', ['Play-Pokemon-Prize-Pack-Series-Four'], [IMP('Paldea Evolved', '097', '193')], [{ set: 'Play-Pokemon-Prize-Pack-Series-Four', cleR2: 'pp/20.webp', numero: null }], [2001]),
            ...(o.cartes || [])
        ],
        cartes_produits: [
            LIGNE(1001, 10, 'Trapinch-Lv9-WCD09SW-115', 'WCD-2009', 9001),
            LIGNE(1002, 11, 'Flygon-LV-X-WCD09SW-105', 'WCD-2009', 9001),
            LIGNE(2001, 20, 'Mimikyu-PPS4PAL-097', 'Play-Pokemon-Prize-Pack-Series-Four', 9002, { preuve: 'pps+origine+numero' }),
            ...(o.lignes || [])
        ],
        restes: o.restes || []
    }, o.opts);
}
const LECTURES = () => [LEC(1001, 10, 'WCD-2009', '115', '100', 'wcd/10.webp', 'WCD'), LEC(1002, 11, 'WCD-2009', '105', '111', 'wcd/11.webp', 'WCD')];
const etat = db => JSON.stringify(['sets', 'cartes', 'cartes_produits'].map(n => db.brut(n)));
const muet = { log: () => {}, err: () => {} };
const imageDeLImpression = (images, numero) => { const n = v => { if (v == null) return null; const s = String(v).trim().toUpperCase().replace(/^0+(?=\d)/, ''); return s === '' ? null : s; }; const v = n(numero); if (v === null) return images[0] ?? null; return images.find(m => n(m.numero) === v) ?? images.find(m => n(m.numero) === null) ?? null; };

(async () => {
    const regle = await X.regleDuSite(RACINE_SITE);
    const deps = { regle, fichesDesProduits: X.fichesDesProduits, imageDeLImpression, refusDuVisuel: () => null };
    const run = (db, lectures, o = {}) => NI.executer({ db, deps, lectures, attendu: o.attendu ?? null, ecrire: o.ecrire ?? false, ...muet });
    const S0 = R => R.rapport.sets[0];

    // ── 1. la simulation par defaut : rien ne s'ecrit, la regle du site est rejouee ──
    let db = monde(), av = etat(db);
    let R = await run(db, LECTURES());
    verifier('simulation : exit 0, RIEN d\'ecrit, 2 impressions (2 cartes) a ecrire', [R.code, etat(db) === av, S0(R).statut, S0(R).aEcrire, R.rapport.totalImpressions], [0, true, 'ok', 2, 2]);
    verifier('   la regle du site (importee) : produits servis 2 -> 2, 0 perdu, 0 visuel perdu, 0 double, 0 sur une autre fiche, chaque produit sur la fiche de SON numero',
        [S0(R).servisAvant, S0(R).servisApres, S0(R).perdus, S0(R).perdusVisuels, S0(R).doublesApres, S0(R).autreCarte, S0(R).surLaBonneFiche, S0(R).mauvaiseFiche], [2, 2, 0, 0, 0, 0, 2, 0]);
    verifier('   le denominateur est imprime : lectures, cartes, lignes du set', [S0(R).lectures, S0(R).docs, S0(R).lignes], [2, 2, 2]);

    // ── 2. chaque garde : une entree qui ne les passe pas toutes est refusee ET NOMMEE ; le set n'est alors pas ecrit (tout ou rien) ──
    const refus = async (nom, lecture, cause, o = {}) => {
        const d = monde(o.monde || {}); const a = etat(d);
        const ls = LECTURES(); ls[0] = typeof lecture === 'function' ? lecture(ls[0]) : lecture;
        const r = await run(d, ls);
        verifier(`refus [${cause}] ${nom} : cause nommee, set incomplet, 0 a ecrire, base intacte`, [S0(r).parCause[cause] >= 1, S0(r).statut, S0(r).aEcrire, etat(d) === a], [true, 'incomplet', 0, true]);
        const e = await run(d, ls, { ecrire: true, attendu: 0 });
        verifier('   et --ecrire n\'ecrit rien non plus', [e.code !== 0, etat(d) === a], [true, true]);
    };
    await refus('le numero LU contredit le slug', l => ({ ...l, numeroLu: '116' }), 'numero-lu-contredit-slug');
    {
        const d = monde(); const a = etat(d);
        const ls = LECTURES();
        // retire l'impression d'origine de Trapinch
        const d2 = fakeDb({ sets: d.brut('sets'), cartes: d.brut('cartes').map(c => (c._id === 10 ? { ...c, impressions: [IMP('Stormfront', '999', '100')] } : c)), cartes_produits: d.brut('cartes_produits'), restes: [] });
        const r = await run(d2, ls);
        verifier('refus [slug-sans-impression-d-origine] le numero du slug (115) n\'est celui d\'aucune impression de la carte', [S0(r).parCause['slug-sans-impression-d-origine'], S0(r).statut, S0(r).aEcrire], [1, 'incomplet', 0]);
    }
    await refus('le total lu differs de celui de l\'impression d\'origine', l => ({ ...l, totalLu: '101' }), 'total-discordant');
    await refus('total lu absent alors que l\'impression en porte un', l => ({ ...l, totalLu: null }), 'total-discordant');
    await refus('cleR2 absente des images de cette carte pour ce set', l => ({ ...l, cleR2: 'wcd/autre.webp' }), 'cle-r2-absente');
    await refus('marque incoherente avec la famille du set (tampon sur un WCD)', l => ({ ...l, marque: 'tampon' }), 'marque-incoherente');
    await refus('numero « DPBP#468 »', l => ({ ...l, numeroLu: 'DPBP#468' }), 'numero-invalide');
    await refus('numero « null » (chaine)', l => ({ ...l, numeroLu: 'null' }), 'numero-invalide');
    await refus('numero vide', l => ({ ...l, numeroLu: '' }), 'lecture-incomplete');
    await refus('luPar absent (pas de lecture tracee)', l => { const { luPar, ...r } = l; return r; }, 'lecture-incomplete');
    await refus('total « null » en chaine', l => ({ ...l, totalLu: 'null' }), 'total-invalide');
    await refus('carte hors du set', l => ({ ...l, carteId: 99 }), 'carte-hors-set');
    await refus('ligne absente (le produit n\'est pas joint a cette carte)', l => ({ ...l, idProduct: 4242 }), 'ligne-absente');
    await refus('ligne detachee par le testeur (reste fiche-contredite-par-la-vue)', l => l, 'ligne-detachee', { monde: { restes: [{ _id: 'r1', type: 'fiche-contredite-par-la-vue', carteId: 10, idProduct: 1001 }] } });
    {   // slug non decodable
        const d = fakeDb({ sets: monde().brut('sets'), cartes: monde().brut('cartes'), cartes_produits: monde().brut('cartes_produits').map(l => (l._id === '10|1001' ? { ...l, slug: 'Trapinch-WCD25099' } : l)), restes: [] });
        const r = await run(d, LECTURES());
        verifier('refus [origine-non-decodee] un slug qui ne porte pas de code d\'origine', [S0(r).parCause['origine-non-decodee'], S0(r).statut], [1, 'incomplet']);
    }
    {   // lecture en double
        const d = monde(); const ls = [...LECTURES(), LEC(1001, 10, 'WCD-2009', '115', '100', 'wcd/10.webp', 'WCD')];
        const r = await run(d, ls);
        verifier('refus [lecture-en-double] deux lectures du meme produit : les deux refusees', [S0(r).parCause['lecture-en-double'], S0(r).statut], [2, 'incomplet']);
    }
    {   // set hors liste fermee
        const d = monde(); const r = await run(d, [LEC(1, 1, 'Promos', '5', null, 'x', 'WCD')]);
        verifier('set hors de la liste fermee (Promos) : refus nomme, aucune lecture de la base, rien d\'ecrit', [S0(r).statut, S0(r).parCause['set-hors-liste']], ['hors-liste', 1]);
        const r2 = await run(d, [LEC(1, 1, 'WCD-2009-x', '5', null, 'x', 'WCD'), LEC(2, 2, 'Play-Pokemon-Prize-Pack-Series-Four-ex', '5', null, 'x', 'tampon')]);
        verifier('   « WCD-2009-x » et « …Series-Four-ex » (motif non ancre) : hors liste', r2.rapport.sets.map(s => s.statut), ['hors-liste', 'hors-liste']);
    }
    {   // set de la liste mais absent de la base
        const r = await run(monde(), [LEC(1, 1, 'WCD-2031', '5', null, 'x', 'WCD')]);
        verifier('set de la forme mais absent de la base : statut « absent », exit 1', [S0(r).statut, r.code], ['absent', 1]);
    }

    // ── 3. TOUT OU RIEN PAR SET ──
    {
        const d = monde(); const a = etat(d);
        const ls = LECTURES(); ls[1] = { ...ls[1], numeroLu: '999' };
        const r = await run(d, ls);
        verifier('tout ou rien : une lecture refusee sur deux, AUCUNE des deux cartes n\'est ecrite, le set se dit incomplet', [S0(r).statut, S0(r).aEcrire, S0(r).parCause['numero-lu-contredit-slug']], ['incomplet', 0, 1]);
        const e = await run(d, ls, { ecrire: true, attendu: 0 });
        verifier('   ecriture : rien, base intacte', [e.code !== 0, etat(d) === a], [true, true]);
        const r3 = await run(monde(), [LECTURES()[0]]);
        verifier('tout ou rien : une carte du set SANS lecture (Flygon) : « carte-sans-lecture », set incomplet, 0 a ecrire', [S0(r3).parCause['carte-sans-lecture'], S0(r3).statut, S0(r3).aEcrire], [1, 'incomplet', 0]);
        const tous = await run(monde(), [...LECTURES(), LEC(2001, 20, 'Play-Pokemon-Prize-Pack-Series-Four', '097', '193', 'pp/20.webp', 'tampon'), LEC(3, 3, 'Promos', '1', null, 'x', 'WCD')]);
        verifier('   deux sets : le set complet est ecrit en simulation, l\'incomplet ne l\'est pas ; le set hors liste est nomme a part', tous.rapport.sets.map(s => [s.slug, s.statut]), [['WCD-2009', 'ok'], ['Play-Pokemon-Prize-Pack-Series-Four', 'ok'], ['Promos', 'hors-liste']]);
    }
    {   // une ligne hors perimetre (metacarte+nom+attaques : pas d'origine) ne bloque pas le set tant que le site n'y perd rien
        const d = monde({ cartes: [CARTE(12, 'Divers', ['WCD-2009'], [], [], [1003])], lignes: [LIGNE(1003, 12, 'Divers-V1', 'WCD-2009', 9001, { preuve: 'metacarte+nom+attaques' })] });
        const r = await run(d, LECTURES());
        verifier('ligne `metacarte+nom+attaques` (sans origine, hors perimetre) : le set reste ecrivable, 2 a ecrire', [S0(r).statut, S0(r).aEcrire], ['ok', 2]);
    }

    // ── 4. la simulation du site refuse : documentAmbigu et visuel perdu ──
    {   // une carte a DEUX origines et une image du set SANS numero : le site repasserait le set en « une fiche par document »
        const d = monde({ cartes: [CARTE(13, 'Ultra Ball', ['WCD-2009'], [IMP('Brilliant Stars', '150', '172'), IMP('Mega Evolution', '131', '132')], [IMGW('wcd/13.webp')], [1004, 1005])],
            lignes: [LIGNE(1004, 13, 'Ultra-Ball-WCD09BRS-150', 'WCD-2009', 9001), LIGNE(1005, 13, 'Ultra-Ball-WCD09MEG-131', 'WCD-2009', 9001)] });
        const ls = [...LECTURES(), LEC(1004, 13, 'WCD-2009', '150', '172', 'wcd/13.webp', 'WCD'), LEC(1005, 13, 'WCD-2009', '131', '132', 'wcd/13.webp', 'WCD')];
        const a = etat(d);
        const r = await run(d, ls);
        verifier('documentAmbigu : image sans numero + 2 fiches -> le set est REFUSE par la simulation, la bascule est dite', [S0(r).statut, S0(r).aEcrire, /documentAmbigu/.test(S0(r).detail), etat(d) === a], ['refuse-simulation', 0, true, true]);
        // la meme carte avec des images portant leur numero : elle passe
        const d2 = monde({ cartes: [CARTE(13, 'Ultra Ball', ['WCD-2009'], [IMP('Brilliant Stars', '150', '172'), IMP('Mega Evolution', '131', '132')], [IMGW('wcd/13a.webp', { numero: '150' }), IMGW('wcd/13b.webp', { numero: '131' })], [1004, 1005])],
            lignes: [LIGNE(1004, 13, 'Ultra-Ball-WCD09BRS-150', 'WCD-2009', 9001), LIGNE(1005, 13, 'Ultra-Ball-WCD09MEG-131', 'WCD-2009', 9001)] });
        const ls2 = [...LECTURES(), LEC(1004, 13, 'WCD-2009', '150', '172', 'wcd/13a.webp', 'WCD'), LEC(1005, 13, 'WCD-2009', '131', '132', 'wcd/13b.webp', 'WCD')];
        const r2 = await run(d2, ls2);
        verifier('   avec des images numerotees : carte a deux origines ecrite (4 impressions), 0 perdu, chaque produit sur la fiche de son numero', [S0(r2).statut, r2.rapport.totalImpressions, S0(r2).perdus, S0(r2).mauvaiseFiche, S0(r2).surLaBonneFiche], ['ok', 4, 0, 0, 4]);
    }
    {   // un visuel perdu : l'unique image du set porte un AUTRE numero que celui lu
        const d = monde({ cartes: [], }); const a = etat(d);
        const d2 = fakeDb({ sets: d.brut('sets'), cartes: d.brut('cartes').map(c => (c._id === 10 ? { ...c, images: [IMGW('wcd/10.webp', { numero: '999' })] } : c)), cartes_produits: d.brut('cartes_produits'), restes: [] });
        const r = await run(d2, LECTURES());
        verifier('visuel perdu (l\'image du set dit « 999 », la fiche devient « 115 ») : set REFUSE, « 0 visuel perdu, sinon rien »', [S0(r).statut, S0(r).perdusVisuels >= 1, S0(r).aEcrire], ['refuse-simulation', true, 0]);
    }

    // ── 5. gardes du set : expansion posee ailleurs, carte etrangere qui declare deja le nom ──
    {
        const NOMW = FM.expansionDe('WCD-2009');
        let r = await run(monde({ setW: { bulba: { titre: 'T', expansion: 'Autre nom' } } }), LECTURES());
        verifier('bulba.expansion deja posee a autre chose : jamais ecrasee, set refuse', [S0(r).statut, S0(r).aEcrire], ['refuse-expansion-posee', 0]);
        r = await run(monde({ cartes: [CARTE(9, 'Intrus', ['Autre'], [IMP(NOMW, '1')], [], [])] }), LECTURES());
        verifier('une carte etrangere au set declare deja le nom synthetique : set refuse', [S0(r).statut, S0(r).aEcrire], ['refuse-nom-declare', 0]);
    }
    {   // une carte deja ecrite par le lot MULTI (origine-slug) : couverte, jamais reecrite
        const NOMW = FM.expansionDe('WCD-2009');
        const d = monde({ setW: { bulba: { titre: null, expansion: NOMW } }, cartes: [CARTE(14, 'Multi', ['WCD-2009'], [IMP(NOMW, '5', null, { source: 'origine-slug' }), IMP(NOMW, '6', null, { source: 'origine-slug' })], [], [1006, 1007])],
            lignes: [LIGNE(1006, 14, 'Multi-WCD09AA-5', 'WCD-2009', 9001, { numeroFiche: '5' }), LIGNE(1007, 14, 'Multi-WCD09BB-6', 'WCD-2009', 9001, { numeroFiche: '6' })] });
        const r = await run(d, LECTURES());
        verifier('carte deja ecrite par origine-slug (numeroFiche poses) : « deja », jamais reecrite ; les 2 autres sont ecrites', [S0(r).statut, S0(r).deja, S0(r).aEcrire], ['ok', 1, 2]);
    }

    // ── 6. l'ecriture : ajouts seulement, dans l'ordre, relue ; l'expansion nulle est refusee ──
    {
        const journal = []; db = monde({ opts: { ecrire: (n, f, u) => journal.push({ n, f, u }) } });
        const avant = structuredClone({ cartes: db.brut('cartes'), lignes: db.brut('cartes_produits'), sets: db.brut('sets') });
        R = await run(db, LECTURES(), { ecrire: true, attendu: 2 });
        verifier('ecriture : exit 0, relecture sans ecart', [R.code, R.rapport.ecarts, R.rapport.erreur], [0, [], null]);
        const NOMW = FM.expansionDe('WCD-2009');
        const c10 = db.brut('cartes').find(c => c._id === 10);
        verifier('   impression source « origine-lue », numero et total TELS QU\'IMPRIMES, au nom synthetique, a la FIN ; les anciennes intactes', [c10.impressions[0], c10.impressions.length, c10.impressions[1].source, c10.impressions[1].numero, c10.impressions[1].total, c10.impressions[1].expansion, c10.impressions[1].tirage], [avant.cartes[0].impressions[0], 2, 'origine-lue', '115', '100', NOMW, 'intl']);
        verifier('   la preuve est ecrite en clair (qui, quand, quel scan, quel slug)', [/chasseur-1/.test(c10.impressions[1].preuveNumero), /2026-11-08/.test(c10.impressions[1].preuveNumero), /wcd\/10\.webp/.test(c10.impressions[1].preuveNumero), /WCD09SW/.test(c10.impressions[1].preuveNumero)], [true, true, true, true]);
        verifier('   numeroFiche pose la ou il etait absent, rien d\'autre ne change sur les lignes ni les cartes (images, liens, sets)', [db.brut('cartes_produits').find(l => l._id === '10|1001').numeroFiche, db.brut('cartes_produits').every(l => { const { numeroFiche, ...reste } = l; return JSON.stringify(reste) === JSON.stringify(avant.lignes.find(a => a._id === l._id)); }), JSON.stringify([c10.images, c10.liens, c10.sets]) === JSON.stringify([avant.cartes[0].images, avant.cartes[0].liens, avant.cartes[0].sets])], ['115', true, true]);
        verifier('   la ligne du Prize Pack (autre set, non demandee) est intacte', [db.brut('cartes_produits').find(l => l._id === '20|2001').numeroFiche, db.brut('cartes').find(c => c._id === 20).impressions.length], [undefined, 1]);
        const sets = journal.filter(j => j.n === 'sets'), dernier = journal[journal.length - 1];
        verifier('   ORDRE : bulba.expansion est ecrite EN DERNIER (apres toutes les impressions et tous les numeroFiche), une seule fois, jamais nulle', [dernier.n, sets.length, sets[0].u.$set['bulba.expansion'], journal.slice(0, -1).every(j => j.n !== 'sets')], ['sets', 1, NOMW, true]);
        verifier('   jamais une valeur nulle, vide ou « null » ecrite nulle part', journal.every(j => Object.values(j.u.$set || {}).every(v => v != null && v !== '' && v !== 'null')), true);
        verifier('   le set : SEUL bulba.expansion change', JSON.stringify({ ...db.brut('sets')[0], bulba: { ...db.brut('sets')[0].bulba, expansion: null } }) === JSON.stringify(avant.sets[0]), true);
        const F = X.fichesDesProduits(regle, db.brut('sets')[0], db.brut('cartes').filter(c => c.sets.includes('WCD-2009')), db.brut('cartes_produits').filter(l => l.idExpansion === 9001)).fiche;
        verifier('   la regle du site sur la base ecrite : Trapinch -> fiche n°115, Flygon -> n°105', [F.get(1001).numero, F.get(1002).numero, F.size], ['115', '105', 2]);
        av = etat(db); const j2 = journal.length;
        R = await run(db, LECTURES(), { ecrire: true, attendu: 0 });
        verifier('rejeu apres ecriture : 0 a ecrire, 2 « deja », la base ne bouge pas, aucune ecriture tentee', [R.code, S0(R).aEcrire, S0(R).deja, etat(db) === av, journal.length === j2], [0, 0, 2, true, true]);
    }
    {
        verifier('exigerNom refuse l\'expansion nulle, vide, « null » ou non synthetique', ['a', null, '', 'null', 'Brilliant Stars', undefined].map(n => { try { NI.exigerNom(n); return 'passe'; } catch { return 'refuse'; } }), ['refuse', 'refuse', 'refuse', 'refuse', 'refuse', 'refuse']);
        verifier('   et laisse passer « reimpressions/<slug> »', NI.exigerNom('reimpressions/WCD-2009'), 'reimpressions/WCD-2009');
    }
    {   // --attendu ne colle pas / absent
        db = monde(); av = etat(db);
        R = await run(db, LECTURES(), { ecrire: true, attendu: 3 });
        verifier('--attendu qui ne colle pas (3 pour 2) : exit 1, rien d\'ecrit', [R.code, etat(db) === av], [1, true]);
        R = await run(db, LECTURES(), { ecrire: true, attendu: null });
        verifier('--ecrire sans --attendu : exit 2, rien d\'ecrit', [R.code, etat(db) === av], [2, true]);
        R = await run(db, [], {});
        verifier('aucune lecture : exit 2', R.code, 2);
        R = await run(fakeDb({ sets: [SETW()], cartes: [], cartes_produits: [] }), LECTURES());
        verifier('la collection des restes illisible : on ne peut pas conclure, exit 1 (jamais « tout va bien »)', R.code, 1);
    }

    // ── 7. les arguments : tout ce qui n'est pas autorise est refuse avant toute connexion ; aucune --force ──
    {
        const a = NI.analyserArgs;
        verifier('arguments valides', [a(['--lectures=l.json']).erreur, a(['--lectures=l.json', '--attendu=4', '--ecrire']).ecrire], [undefined, true]);
        verifier('   --force refuse', !!a(['--lectures=l.json', '--force']).erreur, true);
        verifier('   argument inconnu refuse', !!a(['--lectures=l.json', '--sets=a']).erreur, true);
        verifier('   --lectures obligatoire', !!a(['--ecrire', '--attendu=1']).erreur, true);
        verifier('   --ecrire sans --attendu refuse', !!a(['--lectures=l.json', '--ecrire']).erreur, true);
    }

    // ── 8. la source est une marque de conservation (§59) ──
    {
        const { SOURCES_POSEES_APRES } = require(path.join(DIR, 'collecte-cartes', 'impressions-posees.js'));
        verifier('« origine-lue » est dans SOURCES_POSEES_APRES (sinon une recollecte effacerait ces impressions)', SOURCES_POSEES_APRES.includes('origine-lue'), true);
    }

    console.log(`\n${ok} passes, ${ko} en echec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
