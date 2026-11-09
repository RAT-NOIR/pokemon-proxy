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

// ── le monde : WCD-2009 (code WCD09) et Prize Pack Series Four (code PPS4), et les sets d'ORIGINE (code -> expansion) ──
const SETW = (o = {}) => ({ _id: 'WCD-2009', code: 'WCD09', idExpansion: [9001], region: 'intl', tirage: 'intl', nomAffichage: 'WCD 2009', bulba: { titre: null, expansion: null }, ...o });
const SETP = (o = {}) => ({ _id: 'Play-Pokemon-Prize-Pack-Series-Four', code: 'PPS4', idExpansion: [9002], region: 'intl', tirage: 'intl', nomAffichage: 'PPS4', bulba: { titre: null, expansion: null }, ...o });
const ORIG = (id, code, exp) => ({ _id: id, code, region: 'intl', tirage: 'intl', idExpansion: [1], bulba: { titre: null, expansion: exp } });
const ORIGINES = [ORIG('Stormfront', 'SW', 'Stormfront'), ORIG('Paldea-Evolved', 'PAL', 'Paldea Evolved'), ORIG('Brilliant-Stars', 'BRS', 'Brilliant Stars'), ORIG('Mega-Evolution', 'MEG', 'Mega Evolution')];
const IMP = (expansion, numero, total = null, o = {}) => ({ tirage: 'intl', expansion, deck: null, numero, total, rarete: null, ...o });
const CARTE = (id, nomEn, sets, impressions, images, idProduct) => ({ _id: id, nomEn, sets, impressions, images, liens: { idProduct, idMetacards: [] } });
const LIGNE = (idProduct, carteId, slug, slugSet, idExpansion, o = {}) => ({ _id: `${carteId}|${idProduct}`, carteId, idProduct, idExpansion, tirage: 'intl', preuve: 'wcd+origine+numero', slug, slugSet, ...o });
const IMGW = (cle, o = {}) => ({ set: 'WCD-2009', cleR2: cle, numero: null, ...o });
const LEC = (idProduct, carteId, set, numeroLu, totalLu, cleR2, marque, o = {}) => ({ idProduct, carteId, set, numeroLu, totalLu, marque, cleR2, luPar: 'chasseur-1/planche-3', luLe: '2026-11-08', ...o });
const W = 'WCD-2009', PP = 'Play-Pokemon-Prize-Pack-Series-Four';
function monde(o = {}) {
    return fakeDb({
        sets: [SETW(o.setW), SETP(o.setP), ...ORIGINES],
        cartes: [
            CARTE(10, 'Trapinch', [W], [IMP('Stormfront', '115', '100')], [IMGW('wcd/10.webp')], [1001]),
            CARTE(11, 'Flygon LV.X', [W], [IMP('Stormfront', '105', '111')], [IMGW('wcd/11.webp')], [1002]),
            CARTE(20, 'Mimikyu', [PP], [IMP('Paldea Evolved', '097', '193')], [{ set: PP, cleR2: 'pp/20.webp', numero: null }], [2001]),
            ...(o.cartes || [])
        ],
        cartes_produits: [
            LIGNE(1001, 10, 'Trapinch-Lv9-WCD09SW-115', W, 9001),
            LIGNE(1002, 11, 'Flygon-LV-X-WCD09SW-105', W, 9001),
            LIGNE(2001, 20, 'Mimikyu-PPS4PAL-097', PP, 9002, { preuve: 'pps+origine+numero' }),
            ...(o.lignes || [])
        ],
        restes: o.restes || []
    }, o.opts);
}
const LECTURES = () => [LEC(1001, 10, W, '115', '100', 'wcd/10.webp', null), LEC(1002, 11, W, '105', '111', 'wcd/11.webp', null)];
const etat = db => JSON.stringify(['sets', 'cartes', 'cartes_produits'].map(n => db.brut(n)));
const muet = { log: () => {}, err: () => {} };
const imageDeLImpression = (images, numero) => { const n = v => { if (v == null) return null; const s = String(v).trim().toUpperCase().replace(/^0+(?=\d)/, ''); return s === '' ? null : s; }; const v = n(numero); if (v === null) return images[0] ?? null; return images.find(m => n(m.numero) === v) ?? images.find(m => n(m.numero) === null) ?? null; };
const refaire = (db, f) => fakeDb({ sets: db.brut('sets'), cartes: f.cartes ? f.cartes(db.brut('cartes')) : db.brut('cartes'), cartes_produits: f.lignes ? f.lignes(db.brut('cartes_produits')) : db.brut('cartes_produits'), restes: db.brut('restes') });
const NOMW = FM.expansionDe(W);

(async () => {
    const regle = await X.regleDuSite(RACINE_SITE);
    const deps = { regle, fichesDesProduits: X.fichesDesProduits, imageDeLImpression, refusDuVisuel: () => null };
    const run = (db, lectures, o = {}) => NI.executer({ db, deps: o.deps || deps, lectures, attendu: o.attendu ?? null, ecrire: o.ecrire ?? false, ...muet });
    const S0 = R => R.rapport.sets[0];
    const carte = (db, id) => db.brut('cartes').find(c => c._id === id);
    const ligne = (db, id) => db.brut('cartes_produits').find(l => l._id === id);
    const planIds = S => S.plans.map(p => p.carteId);

    // ── 1. la simulation par defaut : rien ne s'ecrit, la regle du site est rejouee ──
    let db = monde(), av = etat(db);
    let R = await run(db, LECTURES());
    verifier('simulation : exit 0, RIEN d\'ecrit, 2 impressions (2 cartes) a ecrire (marque WCD null acceptee)', [R.code, etat(db) === av, S0(R).statut, S0(R).aEcrire, R.rapport.totalImpressions], [0, true, 'ok', 2, 2]);
    verifier('   la regle du site (importee) : produits servis 2 -> 2, 0 perdu, 0 visuel perdu, 0 double, 0 sur une autre fiche, chaque produit sur la fiche de SON numero',
        [S0(R).servisAvant, S0(R).servisApres, S0(R).perdus, S0(R).perdusVisuels, S0(R).doublesApres, S0(R).autreCarte, S0(R).surLaBonneFiche, S0(R).mauvaiseFiche], [2, 2, 0, 0, 0, 0, 2, 0]);
    verifier('   le denominateur est imprime : lectures, cartes, lignes du set', [S0(R).lectures, S0(R).docs, S0(R).lignes, R.rapport.denominateur.lecturesBrutes], [2, 2, 2, 2]);
    R = await run(monde(), [LEC(1001, 10, W, '115', '100', 'wcd/10.webp', 'WCD')]);
    verifier('   marque « WCD » acceptee aussi sur un WCD', S0(R).aEcrire, 1);
    R = await run(monde(), [LEC(2001, 20, PP, '097', '193', 'pp/20.webp', 'tampon')]);
    verifier('   Prize Pack avec « tampon » : ecrit', [S0(R).statut, S0(R).aEcrire], ['ok', 1]);

    // ── 2. chaque garde : une lecture qui ne les passe pas toutes est refusee ET NOMMEE ; SA carte n'est pas ecrite, les autres le sont (par carte) ──
    const refus = async (nom, lecture, cause, o = {}) => {
        const d = monde(o.monde || {}); const a = etat(d);
        const ls = LECTURES(); ls[0] = typeof lecture === 'function' ? lecture(ls[0]) : lecture;
        const r = await run(d, ls);
        verifier(`refus [${cause}] ${nom} : cause nommee, la carte Trapinch n'est pas ecrite, Flygon l'est, base intacte`, [S0(r).parCause[cause] >= 1, planIds(S0(r)), S0(r).statut, etat(d) === a], [true, [11], 'ok', true]);
        const e = await run(d, ls, { ecrire: true, attendu: 1 });
        verifier('   et --ecrire n\'ecrit que Flygon : Trapinch reste dans l\'etat actuel', [e.code, carte(d, 10).impressions.length, ligne(d, '10|1001').numeroFiche, carte(d, 11).impressions.length], [0, 1, undefined, 2]);
    };
    await refus('le numero LU contredit le slug', l => ({ ...l, numeroLu: '116' }), 'numero-lu-contredit-slug');
    await refus('le total lu differe de celui de l\'impression d\'origine', l => ({ ...l, totalLu: '101' }), 'total-discordant');
    await refus('total lu absent alors que l\'impression en porte un', l => ({ ...l, totalLu: null }), 'total-discordant');
    await refus('cleR2 absente des images de cette carte', l => ({ ...l, cleR2: 'wcd/autre.webp' }), 'cle-r2-absente');
    await refus('marque incoherente avec la famille du set (tampon sur un WCD)', l => ({ ...l, marque: 'tampon' }), 'marque-incoherente');
    await refus('numero « DPBP#468 »', l => ({ ...l, numeroLu: 'DPBP#468' }), 'numero-invalide');
    await refus('numero « null » (chaine)', l => ({ ...l, numeroLu: 'null' }), 'numero-invalide');
    await refus('numero hors forme (« 12/131 » : le total ne se glisse pas dans le numero)', l => ({ ...l, numeroLu: '12/131' }), 'numero-invalide');
    await refus('numero hors forme (« abc »)', l => ({ ...l, numeroLu: 'abc' }), 'numero-invalide');
    await refus('numero vide', l => ({ ...l, numeroLu: '' }), 'lecture-incomplete');
    await refus('luPar absent (pas de lecture tracee)', l => { const { luPar, ...r } = l; return r; }, 'lecture-incomplete');
    await refus('total « null » en chaine', l => ({ ...l, totalLu: 'null' }), 'total-invalide');
    await refus('DOUTE non vide : un doute est un trou', l => ({ ...l, doute: 'le 5 ressemble a un 6' }), 'doute-non-leve');
    await refus('cle inconnue dans la lecture (garde par autorisation)', l => ({ ...l, planche: 'p3' }), 'cle-inconnue');
    await refus('carte hors du set (lecture de la carte 99 ; Trapinch non lue)', l => ({ ...l, carteId: 99 }), 'carte-hors-set');
    await refus('ligne absente (le produit n\'est pas joint a cette carte)', l => ({ ...l, idProduct: 4242 }), 'ligne-absente');
    await refus('ligne detachee par le testeur (reste fiche-contredite-par-la-vue)', l => l, 'ligne-detachee', { monde: { restes: [{ _id: 'r1', type: 'fiche-contredite-par-la-vue', carteId: 10, idProduct: 1001 }] } });
    {   // doute vide / null / absent : accepte
        const r = await run(monde(), [{ ...LECTURES()[0], doute: '' }, { ...LECTURES()[1], doute: null }]);
        verifier('un doute vide ou null n\'est pas un doute', S0(r).aEcrire, 2);
    }
    {   // cleR2 : meme fichier mais dans les images d'un AUTRE set
        const d = refaire(monde(), { cartes: cs => cs.map(c => (c._id === 10 ? { ...c, images: [{ set: 'Autre-Set', cleR2: 'wcd/10.webp', numero: null }] } : c)) });
        const r = await run(d, LECTURES());
        verifier('refus [cle-r2-absente] la cleR2 existe mais sous un autre set : refusee (la garde lit le set)', [S0(r).parCause['cle-r2-absente'], planIds(S0(r))], [1, [11]]);
    }
    {   // l'impression d'origine existe mais sous une AUTRE expansion que celle du code
        const d = refaire(monde(), { cartes: cs => cs.map(c => (c._id === 10 ? { ...c, impressions: [IMP('Brilliant Stars', '115', '100')] } : c)) });
        const r = await run(d, LECTURES());
        verifier('refus [slug-sans-impression-d-origine] 115/100 existe mais sous Brilliant Stars, le slug dit SW (Stormfront)', [S0(r).parCause['slug-sans-impression-d-origine'], planIds(S0(r))], [1, [11]]);
        const d2 = refaire(monde(), { cartes: cs => cs.map(c => (c._id === 10 ? { ...c, impressions: [IMP('Stormfront', '999', '100')] } : c)) });
        const r2 = await run(d2, LECTURES());
        verifier('refus [slug-sans-impression-d-origine] le numero du slug (115) n\'est celui d\'aucune impression de la carte', [S0(r2).parCause['slug-sans-impression-d-origine'], planIds(S0(r2))], [1, [11]]);
    }
    {   // code d'origine inconnu
        const d = refaire(monde(), { lignes: ls => ls.map(l => (l._id === '10|1001' ? { ...l, slug: 'Trapinch-WCD09ZZ-115' } : l)) });
        const r = await run(d, LECTURES());
        verifier('refus [code-origine-inconnu] un code d\'origine qu\'aucun set ne porte : fail closed', [S0(r).parCause['code-origine-inconnu'], planIds(S0(r))], [1, [11]]);
        const d2 = refaire(monde(), { lignes: ls => ls.map(l => (l._id === '10|1001' ? { ...l, slug: 'Trapinch-WCD25099' } : l)) });
        const r2 = await run(d2, LECTURES());
        verifier('refus [origine-non-decodee] un slug qui ne porte pas de code d\'origine (WCD25 sans code)', [S0(r2).parCause['origine-non-decodee'], planIds(S0(r2))], [1, [11]]);
    }
    {   // lecture en double
        const d = monde(); const ls = [...LECTURES(), LEC(1001, 10, W, '115', '100', 'wcd/10.webp', null)];
        const r = await run(d, ls);
        verifier('refus [lecture-en-double] deux lectures de la meme ligne : les deux refusees, la carte non ecrite', [S0(r).parCause['lecture-en-double'], planIds(S0(r))], [2, [11]]);
    }
    {   // set hors liste fermee
        const d = monde(); const r = await run(d, [LEC(1, 1, 'Promos', '5', null, 'x', null)]);
        verifier('set hors de la liste fermee (Promos) : refus nomme, aucune lecture de la base, rien d\'ecrit', [S0(r).statut, S0(r).parCause['set-hors-liste']], ['hors-liste', 1]);
        const r2 = await run(d, [LEC(1, 1, 'WCD-2009-x', '5', null, 'x', null), LEC(2, 2, 'Play-Pokemon-Prize-Pack-Series-Four-ex', '5', null, 'x', 'tampon')]);
        verifier('   « WCD-2009-x » et « …Series-Four-ex » (motif non ancre) : hors liste', r2.rapport.sets.map(s => s.statut), ['hors-liste', 'hors-liste']);
        const r3 = await run(monde(), [LEC(2001, 20, PP, '097', '193', 'pp/20.webp', null)]);
        verifier('   Prize Pack : « tampon » est EXIGE (marque null refusee)', [S0(r3).parCause['marque-incoherente'], S0(r3).aEcrire], [1, 0]);
    }
    {   const r = await run(monde(), [LEC(1, 1, 'WCD-2031', '5', null, 'x', null)]);
        verifier('set de la forme mais absent de la base : statut « absent », exit 1', [S0(r).statut, r.code], ['absent', 1]);
    }

    // ── 3. unit : les gardes qu'aucun chemin de la base n'atteint (le document est deja filtre) ──
    {
        const set = SETW(), expsDuCode = new Map([['SW', new Set(['Stormfront'])]]);
        const c = carte(monde(), 10), l = ligne(monde(), '10|1001');
        const j = (o = {}) => NI.jugerLecture({ lecture: LECTURES()[0], set, carte: c, ligne: l, interdits: new Set(), expsDuCode, ...o });
        verifier('jugerLecture : une lecture juste passe', [j().ok, j().numero, j().total], [true, '115', '100']);
        verifier('   carte dont `sets` ne contient pas le set : carte-hors-set', j({ carte: { ...c, sets: ['Autre'] } }).cause, 'carte-hors-set');
        verifier('   ligne dont le slugSet est un autre set : ligne-hors-du-set', j({ ligne: { ...l, slugSet: 'Autre' } }).cause, 'ligne-hors-du-set');
        verifier('   marque undefined = null sur un WCD', NI.jugerLecture({ lecture: (({ marque, ...r }) => r)(LECTURES()[0]), set, carte: c, ligne: l, interdits: new Set(), expsDuCode }).ok, true);
        verifier('   numerosSeRecouvrent : « A-1 » et « A1 » (meme comparable, cle differente) oui ; « 5 » et « 6 » non', [NI.numerosSeRecouvrent('A-1', 'A1'), NI.numerosSeRecouvrent('5', '6')], [true, false]);
    }

    // ── 4. `produits[]` : une lecture couvre plusieurs produits ; une ligne d'une AUTRE carte n'herite jamais d'une lecture ──
    {
        const ls = NI.developper([{ ...LECTURES()[0], produits: [1001, 1009] }, LECTURES()[1]]);
        verifier('developper : une lecture a 2 produits (+ idProduct) donne 2 lectures sans `produits` ; une sans produits[] passe telle quelle', [ls.map(x => x.idProduct), ls.some(x => 'produits' in x)], [[1001, 1009, 1002], false]);
        verifier('   un `produits` mal forme n\'est pas developpe (il sera refuse)', NI.developper([{ ...LECTURES()[0], produits: 7 }]).length, 1);
        const d = monde({ cartes: [CARTE(15, 'Ultra Ball', [W], [IMP('Brilliant Stars', '150', '172')], [IMGW('wcd/15.webp')], [1004, 1005])],
            lignes: [LIGNE(1004, 15, 'Ultra-Ball-WCD09BRS-150', W, 9001), LIGNE(1005, 15, 'Ultra-Ball-V2-WCD09BRS-150', W, 9001)] });
        const lec = { idProduct: 1004, produits: [1004, 1005], carteId: 15, set: W, numeroLu: '150', totalLu: '172', marque: null, cleR2: 'wcd/15.webp', luPar: 'c', luLe: '2026-11-08' };
        const r = await run(d, [...LECTURES(), lec]);
        verifier('une lecture a produits[] [1004, 1005] couvre les 2 lignes : 1 impression, 2 numeroFiche, 3 cartes ecrites', [r.code, S0(r).aEcrire, r.rapport.totalImpressions, S0(r).plans.find(p => p.carteId === 15).numeros.size, r.rapport.denominateur.lecturesBrutes, r.rapport.denominateur.lectures], [0, 3, 3, 2, 3, 4]);
        // retenues indexee par carte|produit : la ligne 12|1001 (meme produit que 10|1001, AUTRE carte) n'herite pas de la lecture de 10|1001
        const d2 = monde({ cartes: [CARTE(12, 'Trapinch bis', [W], [IMP('Stormfront', '115', '100')], [IMGW('wcd/12.webp')], [1008])],
            lignes: [LIGNE(1001, 12, 'Trapinch-Lv9-WCD09SW-115', W, 9001), LIGNE(1008, 12, 'Trapinch-V2-WCD09SW-115', W, 9001)] });
        const r2 = await run(d2, [...LECTURES(), LEC(1008, 12, W, '115', '100', 'wcd/12.webp', null)]);
        verifier('la ligne 12|1001 ne herite pas de la lecture de 10|1001 : la carte 12 est refusee « ligne-sans-lecture », les cartes 10 et 11 ecrites', [S0(r2).parCause['ligne-sans-lecture'], planIds(S0(r2))], [1, [10, 11]]);
    }

    // ── 5. ECRITURE PAR CARTE : les cartes non lues restent, le set s'ecrit des qu'une carte l'est ──
    {
        const d = monde();
        const r = await run(d, [LECTURES()[0]]);
        verifier('une carte du set SANS lecture (Flygon) reste dans l\'etat actuel : ecriture de Trapinch seule, set « ok », 1 non lue', [S0(r).statut, S0(r).aEcrire, S0(r).sansLecture, S0(r).refus.length], ['ok', 1, 1, 0]);
        const e = await run(d, [LECTURES()[0]], { ecrire: true, attendu: 1 });
        verifier('   ecrite : Trapinch a son impression et son numeroFiche, Flygon est INTACTE, le set est nomme (des qu\'une carte est ecrite)', [e.code, carte(d, 10).impressions.length, ligne(d, '10|1001').numeroFiche, JSON.stringify(carte(d, 11)) === JSON.stringify(carte(monde(), 11)), ligne(d, '11|1002').numeroFiche, d.brut('sets')[0].bulba.expansion], [0, 2, '115', true, undefined, NOMW]);
        const tous = await run(monde(), [...LECTURES(), LEC(2001, 20, PP, '097', '193', 'pp/20.webp', 'tampon'), LEC(3, 3, 'Promos', '1', null, 'x', null)]);
        verifier('   trois sets : chacun est juge a part ; le set hors liste est nomme a part', tous.rapport.sets.map(s => [s.slug, s.statut]), [[W, 'ok'], [PP, 'ok'], ['Promos', 'hors-liste']]);
    }
    {   // une ligne hors perimetre (metacarte+nom+attaques : pas d'origine) ne bloque pas sa carte
        const d = monde({ cartes: [CARTE(12, 'Divers', [W], [], [], [1003])], lignes: [LIGNE(1003, 12, 'Divers-V1', W, 9001, { preuve: 'metacarte+nom+attaques' })] });
        const r = await run(d, LECTURES());
        verifier('ligne `metacarte+nom+attaques` (sans origine, hors perimetre) : le set reste ecrivable, 2 a ecrire', [S0(r).statut, S0(r).aEcrire], ['ok', 2]);
    }
    {   // carte multi-origine : ses images du set portent TOUTES un numero, sinon la carte est refusee (les autres sont ecrites)
        const lignes = [LIGNE(1004, 13, 'Ultra-Ball-WCD09BRS-150', W, 9001), LIGNE(1005, 13, 'Ultra-Ball-WCD09MEG-131', W, 9001)];
        const imps = [IMP('Brilliant Stars', '150', '172'), IMP('Mega Evolution', '131', '132')];
        const lec = [LEC(1004, 13, W, '150', '172', 'wcd/13a.webp', null), LEC(1005, 13, W, '131', '132', 'wcd/13b.webp', null)];
        const d = monde({ cartes: [CARTE(13, 'Ultra Ball', [W], imps, [IMGW('wcd/13a.webp'), IMGW('wcd/13b.webp', { numero: '131' })], [1004, 1005])], lignes });
        const a = etat(d);
        const r = await run(d, [...LECTURES(), ...lec]);
        verifier('carte multi-origine dont UNE image du set n\'a pas de numero : refusee « images-sans-numero », les 2 autres ecrites, le set reste ecrivable', [S0(r).parCause['images-sans-numero'], planIds(S0(r)), S0(r).statut, etat(d) === a], [1, [10, 11], 'ok', true]);
        const d2 = monde({ cartes: [CARTE(13, 'Ultra Ball', [W], imps, [IMGW('wcd/13a.webp', { numero: '150' }), IMGW('wcd/13b.webp', { numero: '131' })], [1004, 1005])], lignes });
        const r2 = await run(d2, [...LECTURES(), ...lec]);
        verifier('   avec des images numerotees : carte a deux origines ecrite (4 impressions), 0 perdu, chaque produit sur la fiche de son numero', [S0(r2).statut, r2.rapport.totalImpressions, S0(r2).perdus, S0(r2).mauvaiseFiche, S0(r2).surLaBonneFiche], ['ok', 4, 0, 0, 4]);
    }
    {   // l'ecart de totaux et les deux origines : refus de la carte
        const lignes = [LIGNE(1010, 16, 'Z-WCD09SW-150', W, 9001), LIGNE(1011, 16, 'Z-V2-WCD09SW-150', W, 9001)];
        const d = monde({ cartes: [CARTE(16, 'Zorua', [W], [IMP('Stormfront', '150', '172'), IMP('Stormfront', '150', '173')], [IMGW('wcd/16.webp')], [1010, 1011])], lignes });
        const r = await run(d, [...LECTURES(), LEC(1010, 16, W, '150', '172', 'wcd/16.webp', null), LEC(1011, 16, W, '150', '173', 'wcd/16.webp', null)]);
        verifier('refus [total-lu-incoherent] le meme numero lu avec deux totaux : la carte n\'est pas ecrite', [S0(r).parCause['total-lu-incoherent'], planIds(S0(r))], [1, [10, 11]]);
        const lignes2 = [LIGNE(1012, 17, 'Y-WCD09SW-150', W, 9001), LIGNE(1013, 17, 'Y-WCD09BRS-150', W, 9001)];
        const d2 = monde({ cartes: [CARTE(17, 'Yanma', [W], [IMP('Stormfront', '150', '172'), IMP('Brilliant Stars', '150', '172')], [IMGW('wcd/17.webp')], [1012, 1013])], lignes: lignes2 });
        const r2 = await run(d2, [...LECTURES(), LEC(1012, 17, W, '150', '172', 'wcd/17.webp', null), LEC(1013, 17, W, '150', '172', 'wcd/17.webp', null)]);
        verifier('refus [deux-origines-meme-numero] deux codes d\'origine (SW, BRS) au meme numero 150 : la carte n\'est pas ecrite', [S0(r2).parCause['deux-origines-meme-numero'], planIds(S0(r2))], [1, [10, 11]]);
    }
    {   // ligne-sans-lecture ; numeroFiche contredit ; numeroFiche vide ; etat partiel
        const lignes = [LIGNE(1004, 15, 'U-WCD09BRS-150', W, 9001), LIGNE(1005, 15, 'U-V2-WCD09BRS-150', W, 9001)];
        const carte15 = CARTE(15, 'Ultra', [W], [IMP('Brilliant Stars', '150', '172')], [IMGW('wcd/15.webp')], [1004, 1005]);
        let r = await run(monde({ cartes: [carte15], lignes }), [...LECTURES(), LEC(1004, 15, W, '150', '172', 'wcd/15.webp', null)]);
        verifier('refus [ligne-sans-lecture] une carte dont une ligne du set n\'est pas lue n\'est pas ecrite (lecture partielle)', [S0(r).parCause['ligne-sans-lecture'], planIds(S0(r))], [1, [10, 11]]);
        r = await run(refaire(monde(), { lignes: ls => ls.map(l => (l._id === '10|1001' ? { ...l, numeroFiche: '999' } : l)) }), LECTURES());
        verifier('refus [numeroFiche-contredit] un numeroFiche deja pose et different du numero lu : la carte n\'est pas ecrite', [S0(r).parCause['numeroFiche-contredit'], planIds(S0(r))], [1, [11]]);
        r = await run(refaire(monde(), { lignes: ls => ls.map(l => (l._id === '10|1001' ? { ...l, numeroFiche: '' } : l)) }), LECTURES());
        verifier('refus [numeroFiche-vide] un numeroFiche \'\' (le filtre `numeroFiche:null` ne le voit pas) : refus nomme, pas un echec a mi-set', [S0(r).parCause['numeroFiche-vide'], planIds(S0(r))], [1, [11]]);
        r = await run(refaire(monde(), { cartes: cs => cs.map(c => (c._id === 10 ? { ...c, impressions: [...c.impressions, IMP(NOMW, '115', '100', { source: 'autre' })] } : c)) }), LECTURES());
        verifier('refus [etat-partiel] une impression au nom du set d\'une autre source : la carte n\'est pas ecrite', [S0(r).parCause['etat-partiel'], planIds(S0(r))], [1, [11]]);
    }

    // ── 6. la simulation du site refuse le SET entier : visuel perdu, bascule, produit hors de sa fiche, produit sur une autre carte ──
    {
        const d = refaire(monde(), { cartes: cs => cs.map(c => (c._id === 10 ? { ...c, images: [IMGW('wcd/10.webp', { numero: '999' })] } : c)) });
        const r = await run(d, LECTURES()), a = etat(d);
        verifier('visuel perdu (l\'image du set dit « 999 », la fiche devient « 115 ») : set REFUSE, « 0 visuel perdu, sinon rien »', [S0(r).statut, S0(r).perdusVisuels >= 1, S0(r).aEcrire, etat(d) === a], ['refuse-simulation', true, 0, true]);
        const code = await run(d, LECTURES(), { ecrire: true, attendu: 0 });
        verifier('   et --ecrire n\'ecrit rien dans un set refuse', [code.code, etat(d) === a], [1, true]);
        // les fonctions du site, tordues APRES l'ecriture (le set nomme) : chaque garde doit crier SEULE
        const tordre = f => ({ ...deps, fichesDesProduits: (re, s, ds, ls) => { const out = X.fichesDesProduits(re, s, ds, ls); if (s.bulba?.expansion !== NOMW) return out; const fiche = new Map(out.fiche); f(fiche); return { ...out, fiche }; } });
        let rr = await run(monde(), LECTURES(), { deps: tordre(fi => fi.set(1001, { ...fi.get(1001), numero: '999' })) });
        verifier('mauvaiseFiche : un produit du plan hors de la fiche de son numero lu -> set refuse (autreCarte 0 : la garde crie seule)', [S0(rr).statut, S0(rr).mauvaiseFiche, S0(rr).autreCarte], ['refuse-simulation', 1, 0]);
        const dm = monde({ cartes: [CARTE(12, 'Divers', [W], [], [], [1003])], lignes: [LIGNE(1003, 12, 'Divers-V1', W, 9001, { preuve: 'metacarte+nom+attaques' })] });
        rr = await run(dm, LECTURES(), { deps: tordre(fi => fi.set(1003, { ...fi.get(1003), carteId: 10 })) });
        verifier('autreCarte : un produit HORS plan qui passe sur la fiche d\'une autre carte -> set refuse (mauvaiseFiche 0 : la garde crie seule)', [S0(rr).statut, S0(rr).autreCarte, S0(rr).mauvaiseFiche], ['refuse-simulation', 1, 0]);
        rr = await run(dm, LECTURES(), { deps: tordre(fi => fi.delete(1003)) });
        verifier('perdus : un produit HORS plan qui n\'a plus de fiche -> set refuse (mauvaiseFiche 0 : la garde crie seule)', [S0(rr).statut, S0(rr).perdus, S0(rr).mauvaiseFiche], ['refuse-simulation', 1, 0]);
        const bascule = { ...deps, regle: { ...regle, setParImpression: arr => arr.every(d => d.fiches.every(f => f.numero == null)) } };
        rr = await run(monde(), LECTURES(), { deps: bascule });
        verifier('bascule documentAmbigu (par impression true -> false) -> set refuse, la bascule est dite', [S0(rr).statut, /documentAmbigu/.test(S0(rr).detail)], ['refuse-simulation', true]);
    }

    // ── 7. gardes du set : expansion posee ailleurs, carte etrangere qui declare deja le nom ──
    {
        let r = await run(monde({ setW: { bulba: { titre: 'T', expansion: 'Autre nom' } } }), LECTURES());
        verifier('bulba.expansion deja posee a autre chose : jamais ecrasee, set refuse', [S0(r).statut, S0(r).aEcrire], ['refuse-expansion-posee', 0]);
        r = await run(monde({ cartes: [CARTE(9, 'Intrus', ['Autre'], [IMP(NOMW, '1')], [], [])] }), LECTURES());
        verifier('une carte etrangere au set declare deja le nom synthetique : set refuse', [S0(r).statut, S0(r).aEcrire], ['refuse-nom-declare', 0]);
    }
    {   // une carte deja ecrite par le lot MULTI (origine-slug) : couverte, jamais reecrite
        const d = monde({ setW: { bulba: { titre: null, expansion: NOMW } }, cartes: [CARTE(14, 'Multi', [W], [IMP(NOMW, '5', null, { source: 'origine-slug' }), IMP(NOMW, '6', null, { source: 'origine-slug' })], [], [1006, 1007])],
            lignes: [LIGNE(1006, 14, 'Multi-WCD09AA-5', W, 9001, { numeroFiche: '5' }), LIGNE(1007, 14, 'Multi-WCD09BB-6', W, 9001, { numeroFiche: '6' })] });
        const r = await run(d, LECTURES());
        verifier('carte deja ecrite par origine-slug (numeroFiche poses) : « deja », jamais reecrite ; les 2 autres sont ecrites', [S0(r).statut, S0(r).deja, S0(r).aEcrire], ['ok', 1, 2]);
    }

    // ── 8. l'ecriture : ajouts seulement, DANS L'ORDRE SUR A L'ARRET, relue ──
    {
        const journal = []; db = monde({ opts: { ecrire: (n, f, u) => journal.push({ n, f, u }) } });
        const avant = structuredClone({ cartes: db.brut('cartes'), lignes: db.brut('cartes_produits'), sets: db.brut('sets') });
        R = await run(db, LECTURES(), { ecrire: true, attendu: 2 });
        verifier('ecriture : exit 0, relecture sans ecart', [R.code, R.rapport.ecarts, R.rapport.erreur], [0, [], null]);
        const c10 = carte(db, 10);
        verifier('   impression source « origine-lue », numero et total TELS QU\'IMPRIMES, au nom synthetique, a la FIN ; les anciennes intactes', [c10.impressions[0], c10.impressions.length, c10.impressions[1].source, c10.impressions[1].numero, c10.impressions[1].total, c10.impressions[1].expansion, c10.impressions[1].tirage], [avant.cartes[0].impressions[0], 2, 'origine-lue', '115', '100', NOMW, 'intl']);
        verifier('   la preuve est ecrite en clair (qui, quand, quel scan, quel slug)', [/chasseur-1/.test(c10.impressions[1].preuveNumero), /2026-11-08/.test(c10.impressions[1].preuveNumero), /wcd\/10\.webp/.test(c10.impressions[1].preuveNumero), /WCD09SW/.test(c10.impressions[1].preuveNumero)], [true, true, true, true]);
        verifier('   numeroFiche pose la ou il etait absent, rien d\'autre ne change sur les lignes ni les cartes (images, liens, sets)', [ligne(db, '10|1001').numeroFiche, db.brut('cartes_produits').every(l => { const { numeroFiche, ...reste } = l; return JSON.stringify(reste) === JSON.stringify(avant.lignes.find(a => a._id === l._id)); }), JSON.stringify([c10.images, c10.liens, c10.sets]) === JSON.stringify([avant.cartes[0].images, avant.cartes[0].liens, avant.cartes[0].sets])], ['115', true, true]);
        verifier('   la ligne du Prize Pack (autre set, non demandee) est intacte', [ligne(db, '20|2001').numeroFiche, carte(db, 20).impressions.length], [undefined, 1]);
        const sets = journal.filter(j => j.n === 'sets'), dernier = journal[journal.length - 1];
        verifier('   ORDRE SUR A L\'ARRET : impression d\'abord, puis les numeroFiche de cette carte, puis la carte suivante ; bulba.expansion EN DERNIER, une seule fois, jamais nulle',
            [journal.map(j => j.n === 'cartes' ? 'imp' : j.n === 'cartes_produits' ? 'nf' : 'set').join(','), sets.length, sets[0].u.$set['bulba.expansion'], dernier.n], ['imp,nf,imp,nf,set', 1, NOMW, 'sets']);
        verifier('   jamais une valeur nulle, vide ou « null » ecrite nulle part', journal.every(j => Object.values(j.u.$set || {}).every(v => v != null && v !== '' && v !== 'null')), true);
        verifier('   le set : SEUL bulba.expansion change', JSON.stringify({ ...db.brut('sets')[0], bulba: { ...db.brut('sets')[0].bulba, expansion: null } }) === JSON.stringify(avant.sets[0]), true);
        const F = X.fichesDesProduits(regle, db.brut('sets')[0], db.brut('cartes').filter(c => c.sets.includes(W)), db.brut('cartes_produits').filter(l => l.idExpansion === 9001)).fiche;
        verifier('   la regle du site sur la base ecrite : Trapinch -> fiche n°115, Flygon -> n°105', [F.get(1001).numero, F.get(1002).numero, F.size], ['115', '105', 2]);
        av = etat(db); const j2 = journal.length;
        R = await run(db, LECTURES(), { ecrire: true, attendu: 0 });
        verifier('rejeu apres ecriture : 0 a ecrire, 2 « deja », la base ne bouge pas, aucune ecriture tentee', [R.code, S0(R).aEcrire, S0(R).deja, etat(db) === av, journal.length === j2], [0, 0, 2, true, true]);
    }
    {   // un arret entre l'impression et le numeroFiche : jamais de numeroFiche sans fiche, et le rejeu ACHEVE
        const propre = monde(); await run(propre, LECTURES(), { ecrire: true, attendu: 2 });
        const base = monde();
        const dbPanne = { collection: nom => { const c = base.collection(nom); return nom === 'cartes_produits' ? { ...c, updateOne: async (f, u) => (f._id === '11|1002' ? { matchedCount: 1, modifiedCount: 0 } : c.updateOne(f, u)) } : c; }, brut: base.brut };
        R = await run(dbPanne, LECTURES(), { ecrire: true, attendu: 2 });
        const nf = base.brut('cartes_produits').filter(l => l.numeroFiche), sansFiche = nf.filter(l => !carte(base, l.carteId).impressions.some(i => i.source === 'origine-lue'));
        verifier('arret a mi-ecriture (le numeroFiche de Flygon echoue) : exit 1, aucun numeroFiche sans son impression, le set N\'est PAS nomme', [R.code, sansFiche.length, base.brut('sets')[0].bulba.expansion], [1, 0, null]);
        R = await run(base, LECTURES(), { ecrire: true, attendu: 0 });
        verifier('   le rejeu ACHEVE : la carte arretee recoit ses numeroFiche (0 impression de plus), le set est nomme, etat identique a une ecriture sans arret', [R.code, R.rapport.totalImpressions, S0(R).plans.map(p => [p.carteId, p.impressions.length]), etat(base) === etat(propre)], [0, 0, [[11, 0]], true]);
    }
    {   // la base BOUGE entre la simulation et l'ecriture : arret net, rien d'ecrase, aucun doublon
        const avantEcriture = (base, hook) => ({ collection: nom => { const c = base.collection(nom); return nom === 'cartes' ? { ...c, updateOne: async (f, u) => { if (!hook.fait) { hook.fait = true; await hook.agir(); } return c.updateOne(f, u); } } : c; }, brut: base.brut });
        let base = monde();
        let hook = { agir: () => base.collection('cartes_produits').updateOne({ _id: '10|1001' }, { $set: { numeroFiche: '999' } }) };
        R = await run(avantEcriture(base, hook), [LECTURES()[0]], { ecrire: true, attendu: 1 });
        verifier('numeroFiche pose entre la simulation et l\'ecriture : arret (exit 1), la valeur posee (999) est INTACTE, le set n\'est pas nomme', [R.code, /numeroFiche/.test(R.rapport.erreur || ''), ligne(base, '10|1001').numeroFiche, base.brut('sets')[0].bulba.expansion], [1, true, '999', null]);
        base = monde();
        hook = { agir: () => base.collection('cartes').updateOne({ _id: 10 }, { $push: { impressions: IMP(NOMW, '115', '100', { source: 'origine-lue' }) } }) };
        R = await run(avantEcriture(base, hook), [LECTURES()[0]], { ecrire: true, attendu: 1 });
        verifier('impression deja presente (double lancement) : modifiedCount 0, arret (exit 1), AUCUN doublon, set non nomme', [R.code, /impressions/.test(R.rapport.erreur || ''), carte(base, 10).impressions.filter(i => i.expansion === NOMW).length, base.brut('sets')[0].bulba.expansion], [1, true, 1, null]);
    }
    {   // bulba.expansion valant '' : le filtre `bulba.expansion: null` ne la voit pas -> refus nomme des la simulation
        const d = monde({ setW: { bulba: { titre: null, expansion: '' } } }), a = etat(d);
        const r = await run(d, LECTURES());
        verifier('bulba.expansion \'\' : set refuse « refuse-expansion-vide » a la simulation, 0 a ecrire, base intacte', [S0(r).statut, S0(r).aEcrire, /''|vide/.test(S0(r).detail || ''), etat(d) === a], ['refuse-expansion-vide', 0, true, true]);
        const e = await run(d, LECTURES(), { ecrire: true, attendu: 0 });
        verifier('   et --ecrire n\'ecrit rien', [e.code, etat(d) === a], [1, true]);
    }
    {   // « set seul » : toutes les cartes sont deja faites et bulba.expansion est vide (arret entre la derniere carte et le set)
        const base = monde(); await run(base, LECTURES(), { ecrire: true, attendu: 2 });
        const propre = etat(base);
        const d2 = fakeDb({ sets: base.brut('sets').map(s => (s._id === W ? { ...s, bulba: { ...s.bulba, expansion: null } } : s)), cartes: base.brut('cartes'), cartes_produits: base.brut('cartes_produits'), restes: [] });
        R = await run(d2, LECTURES());
        verifier('set seul : cartes « deja », expansion vide -> plan « set seul » (0 impression, 1 set a nommer), simulation sans perte', [R.code, S0(R).setSeul, S0(R).deja, R.rapport.totalImpressions, R.rapport.totalSetsSeuls, S0(R).perdus], [0, true, 2, 0, 1, 0]);
        R = await run(d2, LECTURES(), { ecrire: true, attendu: 0 });
        verifier('   ecrit : le set est nomme, rien d\'autre ne bouge, etat identique a l\'ecriture complete', [R.code, R.rapport.ecarts, etat(d2) === propre], [0, [], true]);
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

    // ── 9. les arguments et la racine du site ──
    {
        const a = NI.analyserArgs;
        verifier('arguments valides', [a(['--lectures=l.json']).erreur, a(['--lectures=l.json', '--attendu=4', '--ecrire']).ecrire], [undefined, true]);
        verifier('   --force refuse', !!a(['--lectures=l.json', '--force']).erreur, true);
        verifier('   argument inconnu refuse', !!a(['--lectures=l.json', '--sets=a']).erreur, true);
        verifier('   --lectures obligatoire', !!a(['--ecrire', '--attendu=1']).erreur, true);
        verifier('   --ecrire sans --attendu refuse', !!a(['--lectures=l.json', '--ecrire']).erreur, true);
        const rs = NI.racinesDuSite;
        verifier('racine du site : UNE seule (RACINE_SITE ou le dossier de l\'outil), la lib en est derivee', [rs({ RACINE_SITE: '/a/b' }, '/z').lib.replace(/\\/g, '/'), rs({}, '/z/outil').racine], ['/a/rat-market-site/lib', '/z/outil']);
        verifier('   SITE_LIB qui diverge de la racine : refuse ; SITE_LIB identique : accepte', [!!rs({ RACINE_SITE: '/a/b', SITE_LIB: '/autre/lib' }, '/z').erreur, rs({ RACINE_SITE: '/a/b', SITE_LIB: '/a/rat-market-site/lib' }, '/z').erreur], [true, undefined]);
    }

    // ── 10. la source est une marque de conservation (§59) ──
    {
        const { SOURCES_POSEES_APRES } = require(path.join(DIR, 'collecte-cartes', 'impressions-posees.js'));
        verifier('« origine-lue » est dans SOURCES_POSEES_APRES (sinon une recollecte effacerait ces impressions)', SOURCES_POSEES_APRES.includes('origine-lue'), true);
    }

    // ── 11. le prefixe de promo imprime (SWSH195, XY177, SM68) : tolere seulement si le slug porte exactement ce code de promo, chiffres egaux (liste fermee) ──
    {
        // un monde a UNE carte : set `setId` (code `codeSet`), set d'origine de code `codeOrigine` (expansion `exp`), impression d'origine `impNum`
        const cas = ({ setId, codeSet, slug, codeOrigine, exp, impNum, marque }) => {
            const db = fakeDb({
                sets: [SETW({ _id: setId, code: codeSet }), ORIG('Origine-' + codeOrigine, codeOrigine, exp)],
                cartes: [CARTE(500, 'Promo', [setId], [IMP(exp, impNum, null)], [{ set: setId, cleR2: 'p/500.webp', numero: null }], [5001])],
                cartes_produits: [LIGNE(5001, 500, slug, setId, 9001)],
                restes: []
            });
            return { db, marque, setId };
        };
        const lec = (c, lu) => LEC(5001, 500, c.setId, lu, null, 'p/500.webp', c.marque);
        const SEPT = [
            { setId: 'Play-Pokemon-Prize-Pack-Series-Two', codeSet: 'PPS2', slug: 'Leafeon-VSTAR-PPS2SWSH-195', codeOrigine: 'SWSH', exp: 'SWSH Black Star Promos', impNum: 'SWSH195', lu: 'SWSH195', marque: 'tampon' },
            { setId: 'Play-Pokemon-Prize-Pack-Series-Two', codeSet: 'PPS2', slug: 'Glaceon-VSTAR-PPS2SWSH-197', codeOrigine: 'SWSH', exp: 'SWSH Black Star Promos', impNum: 'SWSH197', lu: 'SWSH197', marque: 'tampon' },
            { setId: 'WCD-2017', codeSet: 'WCD17', slug: 'Karen-WCD17XYPR-177', codeOrigine: 'XYPR', exp: 'XY Black Star Promos', impNum: 'XY177', lu: 'XY177', marque: null },
            { setId: 'WCD-2017', codeSet: 'WCD17', slug: 'Giratina-WCD17XYPR-184', codeOrigine: 'XYPR', exp: 'XY Black Star Promos', impNum: 'XY184', lu: 'XY184', marque: null },
            { setId: 'WCD-2018', codeSet: 'WCD18', slug: 'Xurkitree-GX-WCD18SM-068', codeOrigine: 'SM', exp: 'SM Black Star Promos', impNum: 'SM68', lu: 'SM68', marque: null },
            { setId: 'WCD-2019', codeSet: 'WCD19', slug: 'Solgaleo-GX-WCD19SM-104', codeOrigine: 'SM', exp: 'SM Black Star Promos', impNum: 'SM104', lu: 'SM104', marque: null },
            { setId: 'WCD-2023', codeSet: 'WCD23', slug: 'Professor-Burnet-WCD23SWSH-167', codeOrigine: 'SWSH', exp: 'SWSH Black Star Promos', impNum: 'SWSH167', lu: 'SWSH167', marque: null }
        ];
        for (const k of SEPT) {
            const c = cas(k), r = await run(c.db, [lec(c, k.lu)]);
            verifier(`prefixe imprime ${k.lu} (slug ${k.slug}) : accepte, 1 impression`, [S0(r).statut, S0(r).aEcrire, S0(r).nImpressions, S0(r).parCause], ['ok', 1, 1, {}]);
            const e = await run(c.db, [lec(c, k.lu)], { ecrire: true, attendu: 1 });
            const imp = carte(c.db, 500).impressions.find(i => i.source === 'origine-lue');
            verifier(`   ${k.lu} ecrit : impression.numero = numeroFiche = « ${k.lu} » tel qu'imprime`, [e.code, imp?.numero, ligne(c.db, '500|5001').numeroFiche], [0, k.lu, k.lu]);
        }
        const base = SEPT[4];   // SM, slug ...SM-068
        const refus11 = async (nom, k, lu, cause) => { const c = cas(k), r = await run(c.db, [lec(c, lu)]); verifier(`refus [${cause}] ${nom}`, [S0(r).parCause[cause], S0(r).aEcrire], [1, 0]); };
        await refus11('prefixe lu different de celui du slug (XY68, slug SM)', base, 'XY68', 'numero-lu-contredit-slug');
        await refus11('prefixe lu SWSH sous un slug SM', base, 'SWSH68', 'numero-lu-contredit-slug');
        await refus11('chiffres differents (SM69, slug SM-068)', base, 'SM69', 'numero-lu-contredit-slug');
        await refus11('XYPR n\'est pas un prefixe imprime (XYPR177 sous slug XYPR-177)', SEPT[2], 'XYPR177', 'numero-lu-contredit-slug');
        await refus11('slug sans code de promo (WCD17ZZ) : le prefixe XY n\'est pas tolere', { ...SEPT[2], slug: 'Karen-WCD17ZZ-177', codeOrigine: 'ZZ' }, 'XY177', 'numero-lu-contredit-slug');
        await refus11('slug d\'une extension (code SW) : un prefixe lu n\'y est jamais tolere', { ...SEPT[4], slug: 'Trapinch-WCD18SW-115', codeOrigine: 'SW', exp: 'Stormfront', impNum: '115' }, 'SW115', 'numero-lu-contredit-slug');
        await refus11('prefixe lu, mais l\'impression d\'origine n\'en porte pas (« 68 » sans SM) : fail closed', { ...base, impNum: '68' }, 'SM68', 'slug-sans-impression-d-origine');
    }

    console.log(`\n${ok} passes, ${ko} en echec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
