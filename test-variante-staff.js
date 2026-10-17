// node test-variante-staff.js — STAFF-ECRITURE : séparer les paires Black Star dont la version étiquetée est identifiée (collecte-cartes/variante-staff.js + poser-variante-staff.js).
// Une base EN MÉMOIRE, aucune requête, rien sur R2, jamais la production. Ce que le banc garde :
//   · la liste des paires : 52 « staff-identifie » + 4 rulings du coordinateur = 56 Staff, 5 Jumbo, 3 restent non séparables (les données réelles, si les fichiers sont là) ;
//   · cartes_produits.variante (+ variantePreuve) sur les 2 produits ; jamais sur une ligne à variante contraire (la paire entière est refusée) ;
//   · l'entrée cartes.images servie et le document images : partageeTamponNonSepare true → false, produitsPartages GARDÉ, « Play! Pokémon » → « Jumbo » avec l'ancien libellé gardé ;
//   · à blanc n'écrit rien ; --attendu refuse avant d'écrire ; idempotent ; aucun autre champ ne bouge ; l'annonce de lot vient de la fonction de la garde ; le contrôle des Jumbo confondus.
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE du dépôt.
const path = require('path');
const fs = require('fs');
const DIR = process.env.TOOL_DIR || __dirname;
const T = require(path.join(DIR, 'collecte-cartes', 'variante-staff.js'));
const G = require(path.join(DIR, 'collecte-cartes', 'garde-lot.js'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const essayer = async (nom, f) => { try { await f(); } catch (e) { ko++; console.log(`❌ ${nom}\n   EXCEPTION ${String(e.stack).split('\n').slice(0, 3).join(' | ')}`); } };

// ── une base en mémoire (les seules formes de requête de l'outil) ─────────────────────────────────────────────────────────────────────────────────
function fausseBase() {
    const cols = new Map();
    const col = n => cols.get(n) || cols.set(n, new Map()).get(n);
    const lire = (o, k) => k.split('.').reduce((x, p) => Array.isArray(x) ? x.flatMap(e => e?.[p]) : x?.[p], o);
    const accepte = (d, f) => Object.entries(f || {}).every(([k, v]) => {
        const x = lire(d, k);
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            if ('$in' in v) return (Array.isArray(x) ? x : [x]).some(y => v.$in.includes(y));
            if ('$exists' in v) return (x !== undefined) === v.$exists;
            return false;
        }
        return Array.isArray(x) ? x.includes(v) : x === v;
    });
    const tous = (n, f) => [...col(n).values()].filter(d => accepte(d, f));
    const elements = (d, chemin, filtres, nomVar) => (d[chemin] || []).filter(e => e && (filtres || []).some(fl => Object.entries(fl).every(([k, v]) => k.startsWith(`${nomVar}.`) ? e[k.slice(nomVar.length + 1)] === v : false)));
    function appliquer(d, u, o) {
        const cibles = new Map();
        for (const k of [...Object.keys(u.$set || {}), ...Object.keys(u.$unset || {})]) { const m = /^([^.]+)\.\$\[(\w+)\]\./.exec(k); if (m && !cibles.has(`${m[1]}.${m[2]}`)) cibles.set(`${m[1]}.${m[2]}`, elements(d, m[1], o.arrayFilters, m[2])); }
        for (const [mode, champs] of [['$set', u.$set || {}], ['$unset', u.$unset || {}]]) {
            for (const [k, v] of Object.entries(champs)) {
                const m = /^([^.]+)\.\$\[(\w+)\]\.(.+)$/.exec(k);
                if (m) { for (const e of cibles.get(`${m[1]}.${m[2]}`)) { if (mode === '$set') e[m[3]] = structuredClone(v); else delete e[m[3]]; } }
                else if (mode === '$set') d[k] = structuredClone(v); else delete d[k];
            }
        }
    }
    const collection = n => ({
        find(f) { const r = { toArray: async () => structuredClone(tous(n, f)), project() { return r; } }; return r; },
        async findOne(f) { return structuredClone(tous(n, f)[0] ?? null); },
        async countDocuments(f) { return tous(n, f).length; },
        async updateOne(f, u, o = {}) {
            const d = tous(n, f)[0]; if (!d) return { matchedCount: 0, modifiedCount: 0 };
            const avant = JSON.stringify(d); appliquer(d, u, o);
            writes.push({ n, f, u, o });
            return { matchedCount: 1, modifiedCount: JSON.stringify(d) === avant ? 0 : 1 };
        },
        async updateMany() { throw new Error('updateMany : interdit à cet outil'); },
        async insertOne() { throw new Error('insertOne : interdit à cet outil'); },
        async deleteOne() { throw new Error('deleteOne : interdit à cet outil'); },
        async deleteMany() { throw new Error('deleteMany : interdit à cet outil'); },
        async replaceOne() { throw new Error('replaceOne : interdit à cet outil'); }
    });
    const writes = [];
    return { db: { collection }, col, cols, writes, instantane: () => JSON.stringify([...cols].map(([n, m]) => [n, [...m.values()]])) };
}

// ── le monde ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const SV = 'SV-Black-Star-Promos', SWSH = 'SWSH-Black-Star-Promos';
const PAIRES = [
    // { c: carteId, set, n: numero, ids: [V1, V2], type, tn (libellé actuel de l'entrée), cle }
    { c: 1001, set: SV, n: '004', ids: [11, 12], type: 'staff', tn: 'Staff', cle: 'tcgdex/SV/004-1001.webp' },
    { c: 1002, set: SWSH, n: 'SWSH111', ids: [21, 22], type: 'staff', tn: 'Staff', cle: 'tcgdex/SWSH/111-1002.webp' },
    { c: 1003, set: SWSH, n: 'SWSH195', ids: [31, 32], type: 'jumbo', tn: 'Play! Pokémon', cle: 'tcgdex/SWSH/195-1003.webp' },
    { c: 1004, set: SV, n: '018', ids: [41, 42], type: 'jumbo', tn: 'Play! Pokémon', cle: 'tcgdex/SV/018-1004.webp', sansDoc: true },
    // non séparable : marquée « tampon non séparable » avant, et rien ne doit changer
    { c: 1005, set: SV, n: '045', ids: [51, 52], type: null, tn: 'Staff', cle: 'tcgdex/SV/045-1005.webp' },
    // une ligne porte déjà une variante contraire
    { c: 1006, set: SV, n: '050', ids: [61, 62], type: 'staff', tn: 'Staff', cle: 'tcgdex/SV/050-1006.webp', varianteContraire: 62 },
    // aucune entrée ne porte la paire
    { c: 1007, set: SV, n: '060', ids: [71, 72], type: 'staff', tn: 'Staff', cle: 'tcgdex/SV/060-1007.webp', sansEntree: true }
];
function monde() {
    const B = fausseBase();
    const set = (n, d) => B.col(n).set(d._id, d);
    for (const p of PAIRES) {
        for (const [i, id] of p.ids.entries()) set('cartes_produits', { _id: `${p.c}|${id}`, carteId: p.c, idProduct: id, idExpansion: p.set === SV ? 5241 : 2916, slugSet: p.set, numeroFiche: p.n, slug: `X-V${i + 1}-${p.n}`, preuve: 'set+numero', ...(p.varianteContraire === id ? { variante: 'jumbo' } : {}) });
        const imgs = [{ set: p.set, source: 'tcgdex', cleR2: p.cle, numero: p.n, w: 600, h: 825, langue: 'en', vignette: { cleR2: `vignettes/${p.cle}`, w: 200, h: 275 }, ...(p.sansEntree ? {} : { produitsPartages: p.ids, partageeTamponNonSepare: true, tamponNonRepresente: p.tn }) },
            { set: p.set, source: 'bulbapedia', cleR2: `bulbapedia/autre-${p.c}.webp`, numero: '777', w: 600, h: 825, langue: 'en' }];
        set('cartes', { _id: p.c, nomEn: `Carte ${p.c}`, sets: [p.set], impressions: [{ tirage: 'intl', expansion: p.set, numero: p.n, total: null }], images: imgs });
        if (!p.sansDoc) set('images', { _id: p.cle.replace(/\.webp$/, ''), source: 'tcgdex', set: p.set, carteId: p.c, numero: p.n, cleR2: p.cle, etat: 'ok', ...(p.sansEntree ? {} : { produitsPartages: p.ids, partageeTamponNonSepare: true, tamponNonRepresente: p.tn }) });
    }
    // un Prize Pack voisin (autre marquage) : ne doit jamais bouger
    set('cartes', { _id: 2001, nomEn: 'Pack', sets: ['PP'], impressions: [], images: [{ set: 'PP', source: 'pokumon', cleR2: 'pokumon/pp.webp', numero: '1', partageeHoloNonHolo: true, produitsPartages: [9, 10] }] });
    return B;
}
// les verdicts et adresses qui correspondent (forme des fichiers réels)
const verdict = (n, p, v, extra = {}) => ({ n, set: p.set, numero: p.n, nom: `Carte ${p.c}`, tamponAttendu: 'Staff', verdict: v, motif: null, idEtiquete: p.ids[1], idNormale: p.ids[0], etiqueteeEstV2: true, idV1: p.ids[0], idV2: p.ids[1], ...extra });
const adresse = (n, p) => ({ n, set: p.set, numero: p.n, nom: `Carte ${p.c}`, tampon: 'Staff', versions: [{ v: 'V1', idProduct: p.ids[0] }, { v: 'V2', idProduct: p.ids[1] }] });
const pairesDe = (liste) => liste.map(p => ({ n: p.c, set: p.set, numero: p.n, nom: `Carte ${p.c}`, type: p.type, ruling: false, idNormale: p.ids[0], idEtiquete: p.ids[1] }));
const CHAMPS_IMG = ['partageeTamponNonSepare', 'tamponNonRepresente', 'tamponNonRepresenteAvant'];
const entreeDe = (B, c, cle) => B.col('cartes').get(c).images.find(e => e.cleR2 === cle);

(async () => {
    // ── 1. LA LISTE DES PAIRES ──
    await essayer('liste', () => {
        const [A, B, C, D] = PAIRES;
        const verdicts = [verdict(1, A, 'staff-identifie'), verdict(2, B, 'staff-identifie'), verdict(3, C, 'jumbo-identifie', { tamponAttendu: 'Play! Pokémon' }), verdict(4, D, 'jumbo-identifie', { tamponAttendu: 'Play! Pokémon' }),
            verdict(5, { ...PAIRES[4], set: SV, n: '045' }, 'douteux', { idEtiquete: null, idNormale: null, etiqueteeEstV2: null, motif: 'aucune pastille' }),
            // un ruling du coordinateur : SV 133 douteux (OCR Stamped) → staff
            { n: 6, set: SV, numero: '133', nom: 'Ledian', tamponAttendu: 'Staff', verdict: 'douteux', motif: 'OCR : Staff Stamped', idEtiquete: null, idNormale: null, etiqueteeEstV2: true, idV1: 81, idV2: 82 },
            // un douteux qui n'est pas un ruling : exclu
            { n: 7, set: SV, numero: '999', nom: 'Autre', tamponAttendu: 'Staff', verdict: 'douteux', motif: 'x', idEtiquete: null, idNormale: null, etiqueteeEstV2: true, idV1: 91, idV2: 92 }];
        const adresses = [adresse(1, A), adresse(2, B), adresse(3, C), adresse(4, D), adresse(5, PAIRES[4]),
            { n: 6, set: SV, numero: '133', nom: 'Ledian', tampon: 'Staff', versions: [{ v: 'V1', idProduct: 81 }, { v: 'V2', idProduct: 82 }] },
            { n: 7, set: SV, numero: '999', nom: 'Autre', tampon: 'Staff', versions: [{ v: 'V1', idProduct: 91 }, { v: 'V2', idProduct: 92 }] }];
        const l = T.listeDesPaires(verdicts, adresses);
        verifier('liste : 3 Staff (dont 1 ruling), 2 Jumbo (le jumbo-identifie), 2 exclues', [l.comptes.staff, l.comptes.jumbo, l.comptes.exclues], [3, 2, 2]);
        verifier('liste : le ruling est marqué, et il n\'y en a qu\'un', l.paires.filter(p => p.ruling).map(p => p.numero), ['133']);
        verifier('liste : la version étiquetée est V2 (idEtiquete = idV2), la normale V1', l.paires.map(p => [p.idNormale, p.idEtiquete]), [[11, 12], [21, 22], [31, 32], [41, 42], [81, 82]]);
        verifier('liste : un douteux sans ruling n\'est pas dans la liste', l.paires.some(p => p.numero === '999' || p.numero === '045'), false);
        const lance = (v, a) => { try { T.listeDesPaires(v, a); return null; } catch (e) { return String(e.message); } };
        verifier('liste : un verdict dont les idProduct ne sont pas ceux des adresses lève', typeof lance(verdicts, adresses.map(x => x.n === 1 ? { ...x, versions: [{ v: 'V1', idProduct: 1 }, { v: 'V2', idProduct: 2 }] } : x)), 'string');
        verifier('liste : une étiquette sur V1 (idEtiquete = idV1) lève : la version étiquetée est V2 dans les 61 paires', typeof lance(verdicts.map(x => x.n === 1 ? { ...x, idEtiquete: 11, idNormale: 12 } : x), adresses), 'string');
        verifier('liste : un verdict inconnu lève (jamais un silence)', typeof lance([{ ...verdicts[0], verdict: 'peut-etre' }], adresses), 'string');
        verifier('liste : un verdict sans adresse lève', typeof lance(verdicts, adresses.slice(1)), 'string');
    });
    // les vraies données, si elles sont là : 56 / 5 / 3
    const S7 = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S7/';
    await essayer('liste réelle', () => {
        const fv = S7 + 'STAFF-DETECT/verdicts-64-paires.json', fa = S7 + 'CM-PASSIF/ADRESSES-64-PAIRES.json';
        if (!fs.existsSync(fv) || !fs.existsSync(fa)) { console.log('⏭️  données réelles absentes : section sautée'); return; }
        const l = T.listeDesPaires(JSON.parse(fs.readFileSync(fv, 'utf8')), JSON.parse(fs.readFileSync(fa, 'utf8')));
        verifier('liste RÉELLE : 56 Staff, 5 Jumbo, 3 exclues', [l.comptes.staff, l.comptes.jumbo, l.comptes.exclues], [56, 5, 3]);
        verifier('liste RÉELLE : les 4 rulings sont SV 133 à 136', l.paires.filter(p => p.ruling).map(p => `${p.set}|${p.numero}`).sort(), ['SV-Black-Star-Promos|133', 'SV-Black-Star-Promos|134', 'SV-Black-Star-Promos|135', 'SV-Black-Star-Promos|136']);
        verifier('liste RÉELLE : les 3 exclues sont SV 045, SV 150, SWSH 296', l.exclues.map(p => `${p.set}|${p.numero}`).sort(), ['SV-Black-Star-Promos|045', 'SV-Black-Star-Promos|150', 'SWSH-Black-Star-Promos|296']);
        verifier('liste RÉELLE : les 5 Jumbo', l.paires.filter(p => p.type === 'jumbo').map(p => `${p.set}|${p.numero}`).sort(), ['SV-Black-Star-Promos|004', 'SV-Black-Star-Promos|018', 'SWSH-Black-Star-Promos|111', 'SWSH-Black-Star-Promos|195', 'SWSH-Black-Star-Promos|197']);
    });

    // ── 2. LE PLAN ──
    const paires = pairesDe(PAIRES.filter(p => p.type));
    let B = monde();
    const plan = async (m, ps = paires) => T.construirePlan({ cartesDb: m.db, paires: ps });
    await essayer('plan', async () => {
        const p = await plan(B);
        verifier('plan : 4 paires prouvées (2 Staff, 2 Jumbo) ; 2 refusées (variante contraire, entrée introuvable)', [p.paires.map(x => x.n).sort(), p.refus.map(x => x.n).sort()], [[1001, 1002, 1003, 1004], [1006, 1007]]);
        verifier('plan : les motifs sont nommés', Object.fromEntries(p.refus.map(r => [r.n, r.motif])), { 1006: 'variante-contraire', 1007: 'entree-introuvable' });
        const par = n => p.paires.find(x => x.n === n);
        verifier('plan : variante cible V1 « normale », V2 « staff » / « jumbo »', [par(1001).lignes.map(l => [l.idProduct, l.cible]), par(1003).lignes.map(l => [l.idProduct, l.cible])], [[[11, 'normale'], [12, 'staff']], [[31, 'normale'], [32, 'jumbo']]]);
        verifier('plan : l\'entrée visée est celle qui porte la paire (set, cleR2), pas l\'autre entrée de la carte', [par(1001).entree.set, par(1001).entree.cleR2], [SV, 'tcgdex/SV/004-1001.webp']);
        verifier('plan : le document images est trouvé ; sans document : motif nommé, la paire reste prouvée', [par(1001).doc?._id, par(1004).doc, par(1004).docMotif], ['tcgdex/SV/004-1001', null, 'document-absent']);
        verifier('plan : le plan n\'écrit rien', B.writes.length, 0);
        verifier('plan : comptes', [p.comptes.paires, p.comptes.refus, p.comptes.lignesDeja, p.comptes.entreesDeja], [4, 2, 0, 0]);
        verifier('plan : la preuve de variante nomme l\'étiquette, la version et la date', [/Staff/.test(par(1001).lignes[1].preuve), /V2/.test(par(1001).lignes[1].preuve), /2026-10-17/.test(par(1001).lignes[1].preuve), /Oversized/.test(par(1003).lignes[1].preuve), /V1|sans étiquette/.test(par(1001).lignes[0].preuve)], [true, true, true, true, true]);
    });

    // ── 3. L'ÉCRITURE ──
    B = monde();
    await essayer('ecriture', async () => {
        const avant = JSON.parse(B.instantane());
        const p = await plan(B);
        const sim = await T.appliquer(B.db, p, { ecrire: false });
        verifier('à blanc : rien n\'est écrit et le compte est rendu (8 lignes, 4 entrées, 3 documents)', [B.writes.length, sim.lignes, sim.entrees, sim.documents], [0, 8, 4, 3]);
        const r = await T.appliquer(B.db, p, { ecrire: true, attendu: 4 });
        verifier('écriture : 8 lignes, 4 entrées, 3 documents', [r.lignes, r.entrees, r.documents], [8, 4, 3]);
        const l = (c, id) => B.col('cartes_produits').get(`${c}|${id}`);
        verifier('écriture : V1 « normale », V2 « staff » avec leur preuve', [l(1001, 11).variante, l(1001, 12).variante, typeof l(1001, 11).variantePreuve, typeof l(1001, 12).variantePreuve], ['normale', 'staff', 'string', 'string']);
        verifier('écriture : V2 des Jumbo « jumbo »', [l(1003, 32).variante, l(1004, 42).variante], ['jumbo', 'jumbo']);
        const eS = entreeDe(B, 1001, 'tcgdex/SV/004-1001.webp'), eJ = entreeDe(B, 1003, 'tcgdex/SWSH/195-1003.webp');
        verifier('écriture : entrée Staff : partageeTamponNonSepare false, produitsPartages GARDÉ, « Staff » gardé, pas de champ Avant', [eS.partageeTamponNonSepare, eS.produitsPartages, eS.tamponNonRepresente, 'tamponNonRepresenteAvant' in eS], [false, [11, 12], 'Staff', false]);
        verifier('écriture : entrée Jumbo : false, produitsPartages gardé, « Jumbo », l\'ancien libellé gardé', [eJ.partageeTamponNonSepare, eJ.produitsPartages, eJ.tamponNonRepresente, eJ.tamponNonRepresenteAvant], [false, [31, 32], 'Jumbo', 'Play! Pokémon']);
        const dJ = B.col('images').get('tcgdex/SWSH/195-1003'), dS = B.col('images').get('tcgdex/SV/004-1001');
        verifier('écriture : documents images : mêmes valeurs que leur entrée', [dS.partageeTamponNonSepare, dS.tamponNonRepresente, dJ.partageeTamponNonSepare, dJ.tamponNonRepresente, dJ.tamponNonRepresenteAvant, dJ.produitsPartages], [false, 'Staff', false, 'Jumbo', 'Play! Pokémon', [31, 32]]);
        verifier('écriture : la paire non séparable (1005) n\'a pas bougé', [entreeDe(B, 1005, 'tcgdex/SV/045-1005.webp').partageeTamponNonSepare, B.col('cartes_produits').get('1005|51').variante ?? null, B.col('images').get('tcgdex/SV/045-1005').partageeTamponNonSepare], [true, null, true]);
        verifier('écriture : les paires refusées (1006, 1007) n\'ont rien reçu', [B.col('cartes_produits').get('1006|61').variante ?? null, B.col('cartes_produits').get('1006|62').variante, B.col('cartes_produits').get('1007|71').variante ?? null, entreeDe(B, 1006, 'tcgdex/SV/050-1006.webp').partageeTamponNonSepare], [null, 'jumbo', null, true]);
        verifier('écriture : une AUTRE entrée de la carte n\'a pas bougé', [CHAMPS_IMG.map(c => c in entreeDe(B, 1001, 'bulbapedia/autre-1001.webp'))], [[false, false, false]]);
        verifier('écriture : le Prize Pack voisin n\'a pas bougé', B.col('cartes').get(2001).images, [{ set: 'PP', source: 'pokumon', cleR2: 'pokumon/pp.webp', numero: '1', partageeHoloNonHolo: true, produitsPartages: [9, 10] }]);
        // aucun AUTRE champ n'a bougé : on retire les champs posés et on retrouve le monde d'avant
        const apres = JSON.parse(B.instantane());
        const ciblesLigne = new Set(['1001|11', '1001|12', '1002|21', '1002|22', '1003|31', '1003|32', '1004|41', '1004|42']);
        for (const [n, docs] of apres) for (const d of docs) {
            if (n === 'cartes_produits' && ciblesLigne.has(d._id)) { delete d.variante; delete d.variantePreuve; }
            for (const im of d.images || []) if (im.tamponNonRepresenteAvant !== undefined) delete im.tamponNonRepresenteAvant;
            if (n === 'images') delete d.tamponNonRepresenteAvant;
        }
        // les champs que le lot MODIFIE (true → false, Play! → Jumbo) sont remis à leur valeur d'avant pour la comparaison
        for (const [n, docs] of apres) for (const d of docs) {
            const cibles = n === 'images' ? [d] : (d.images || []);
            for (const im of cibles) if (im.partageeTamponNonSepare === false) { im.partageeTamponNonSepare = true; if (im.tamponNonRepresente === 'Jumbo') im.tamponNonRepresente = 'Play! Pokémon'; }
        }
        verifier('écriture : AUCUN autre champ n\'a bougé (monde moins les champs du lot = monde d\'avant)', JSON.stringify(apres), JSON.stringify(avant));
        verifier('écriture : seules cartes_produits, cartes et images sont écrites', [...new Set(B.writes.map(w => w.n))].sort(), ['cartes', 'cartes_produits', 'images']);
        // idempotence
        const nw = B.writes.length;
        const p2 = await plan(B);
        verifier('idempotence : le plan rejoué voit tout « déjà fait » (8 lignes, 4 entrées, 3 documents)', [p2.comptes.lignesDeja, p2.comptes.entreesDeja, p2.comptes.documentsDeja, p2.paires.length], [8, 4, 3, 4]);
        const r2 = await T.appliquer(B.db, p2, { ecrire: true, attendu: 4 });
        verifier('idempotence : un second passage n\'écrit rien et le dit', [B.writes.length - nw, r2.lignes, r2.entrees, r2.documents, r2.dejaFait], [0, 0, 0, 0, true]);
    });
    B = monde();
    await essayer('attendu', async () => {
        const p = await plan(B); const s = B.instantane();
        let msg = null; try { await T.appliquer(B.db, p, { ecrire: true, attendu: 61 }); } catch (e) { msg = String(e.message); }
        verifier('--attendu=61 alors que 4 paires sont prouvées : refuse AVANT d\'écrire', [/61/.test(msg || ''), B.writes.length, B.instantane() === s], [true, 0, true]);
        let msg2 = null; try { await T.appliquer(B.db, p, { ecrire: true }); } catch (e) { msg2 = String(e.message); }
        verifier('--ecrire sans --attendu : refuse (compte obligatoire à l\'écriture)', [typeof msg2, B.writes.length], ['string', 0]);
    });
    await essayer('etat inattendu', async () => {
        const m = monde();
        entreeDe(m, 1001, 'tcgdex/SV/004-1001.webp'); // (présence)
        m.col('cartes').get(1001).images[0].tamponNonRepresente = 'Prerelease';
        const p = await plan(m);
        verifier('une entrée dont le libellé n\'est pas celui du type (Staff attendu) : paire refusée, motif nommé', [p.paires.some(x => x.n === 1001), p.refus.find(x => x.n === 1001)?.motif], [false, 'tampon-inattendu']);
        const m2 = monde();
        m2.col('cartes').get(1003).images[0].tamponNonRepresente = 'Staff';
        const p2 = await plan(m2);
        verifier('un Jumbo dont l\'entrée dit « Staff » : refusée (le libellé Play! était le seul attendu)', p2.refus.find(x => x.n === 1003)?.motif, 'tampon-inattendu');
        const m3 = monde();
        m3.col('cartes').get(1003).images[0].partageeTamponNonSepare = false;
        const p3 = await plan(m3);
        verifier('une entrée Jumbo à false sans le libellé final ni l\'ancien (état à moitié écrit) : refusée, jamais devinée', p3.refus.find(x => x.n === 1003)?.motif, 'entree-etat-inattendu');
    });

    // ── 4. L'ANNONCE DE LOT : par la fonction de la garde ──
    B = monde();
    await essayer('annonce', async () => {
        const p = await plan(B);
        const a = await T.annonceDePlan(B.db, p);
        verifier('annonce : images-partagees-tampon baisse de 1 dans SV (1001... 2 entrées : 1001, 1004) et SWSH (2 : 1002, 1003)', a, { [`images-partagees-tampon set:${SV}`]: 2, [`images-partagees-tampon set:${SWSH}`]: 2 });
        verifier('annonce : valide pour la garde de lot (compteur connu, entier > 0)', (() => { try { G.validerAnnonces(a); return true; } catch { return false; } })(), true);
        // la garde, rejouée sur un vrai avant/après : annonce suffisante = aucune baisse non autorisée
        const lire = () => ({ cartes: [...B.col('cartes').values()].map(x => structuredClone(x)), cartesProduits: [...B.col('cartes_produits').values()].map(x => structuredClone(x)), sets: [] });
        const avant = G.compterEtat(lire());
        await T.appliquer(B.db, p, { ecrire: true, attendu: 4 });
        const apres = G.compterEtat(lire());
        verifier('garde : SANS annonce, la baisse arrête le lot (2 baisses non autorisées)', G.comparer(avant, apres).nonAutorisees.length, 2);
        const c = G.comparer(avant, apres, { annonces: a });
        verifier('garde : AVEC l\'annonce, aucune baisse non autorisée et aucune annonce non réalisée', [c.nonAutorisees.length, c.annoncesNonRealisees.length], [0, 0]);
    });

    // ── 4 bis. LE DIFF « SERVIS » : aucune fiche perdue ni changée, et il SAIT voir une perte ──
    await essayer('servis', async () => {
        const m = monde();
        m.col('sets').set(SV, { _id: SV, code: 'SVP', tirage: 'intl', idExpansion: [5241], bulba: { expansion: SV } });
        m.col('sets').set(SWSH, { _id: SWSH, code: 'SWSH', tirage: 'intl', idExpansion: [2916], bulba: { expansion: SWSH } });
        // la règle du site, ici un double : une fiche par impression du set, tous les produits de la carte sur sa fiche
        const regle = { fichesDuDocument: imp => imp.map((i, rang) => ({ rang, numero: i.numero, rarete: null })), setParImpression: () => false, produitsDeLaFiche: (prods) => prods };
        const p = await plan(m);
        const r = await T.diffServis({ cartesDb: m.db, regle, plan: p });
        verifier('servis : 8 produits touchés, tous servis avant et après, aucun perdu, aucune fiche changée', [r.produits, r.servisAvant, r.servisApres, r.perdus.length, r.changes.length], [8, 8, 8, 0, 0]);
        // un mutant de la règle du site qui réagirait au nouveau marquage des images (partageeTamponNonSepare: false) : la perte doit se VOIR
        const reg = { fichesDuDocument: regle.fichesDuDocument, setParImpression: docs => docs.some(d => d.images.some(i => i.partageeTamponNonSepare === false)),
            produitsDeLaFiche: (prods, rang, numeros) => numeros.length ? [] : prods };
        const r2 = await T.diffServis({ cartesDb: m.db, regle: reg, plan: p });
        verifier('servis : une règle qui réagirait au marquage → tous les produits des deux sets sont perdus, et le diff les voit (14)', r2.perdus.length, 14);
        verifier('servis : le diff ne touche à rien', m.writes.length, 0);
    });

    // ── 5. LE CONTRÔLE DES JUMBO CONFONDUS ──
    await essayer('jumbo', async () => {
        const J = fausseBase();
        const set = (n, d) => J.col(n).set(d._id, d);
        const ligne = (c, id, num, extra = {}) => set('cartes_produits', { _id: `${c}|${id}`, carteId: c, idProduct: id, idExpansion: 1, slugSet: 'S', numeroFiche: num, ...extra });
        const carte = (c, images) => set('cartes', { _id: c, nomEn: `c${c}`, sets: ['S'], images });
        // J1 : un Jumbo de paire marquée, sur la fiche de sa version normale : marqué, pas confondu
        ligne(1, 101, '1'); ligne(1, 102, '1'); carte(1, [{ set: 'S', cleR2: 'a.webp', numero: '1', produitsPartages: [101, 102], partageeTamponNonSepare: false, tamponNonRepresente: 'Jumbo' }]);
        // J2 : un Jumbo seul sur sa fiche
        ligne(2, 201, '2'); carte(2, [{ set: 'S', cleR2: 'b.webp', numero: '2' }]);
        // J3 : un Jumbo qui partage la fiche d'une version normale SANS aucun marquage : CONFONDU (fiche)
        ligne(3, 301, '3'); ligne(3, 302, '3'); carte(3, [{ set: 'S', cleR2: 'c.webp', numero: '3' }]);
        // J4 : aucune ligne
        // J5 : deux Jumbo ensemble sur la fiche, pas de version normale : pas confondu
        ligne(5, 501, '5'); ligne(5, 502, '5'); carte(5, [{ set: 'S', cleR2: 'e.webp', numero: '5' }]);
        // J6 : fiche propre, mais le fichier d'image est aussi servi à une AUTRE carte (la version normale) sans marquage : CONFONDU (image)
        ligne(6, 601, '6'); carte(6, [{ set: 'S', cleR2: 'f.webp', numero: '6' }]); ligne(7, 701, '6'); carte(7, [{ set: 'S', cleR2: 'f.webp', numero: '6' }]);
        // J7 : variante « jumbo » déjà posée sur la ligne : marqué
        ligne(8, 801, '8', { variante: 'jumbo' }); ligne(8, 802, '8', { variante: 'normale' }); carte(8, [{ set: 'S', cleR2: 'g.webp', numero: '8' }]);
        const r = await T.controleJumbo({ cartesDb: J.db, jumboIds: [102, 201, 301, 404, 501, 502, 601, 801] });
        verifier('jumbo : 8 candidats lus, 2 confondus (J3 par la fiche, J6 par l\'image)', [r.total, r.confondus.map(x => [x.idProduct, x.par]).sort((a, b) => a[0] - b[0])], [8, [[301, 'fiche'], [601, 'image']]]);
        verifier('jumbo : marqués (paire marquée, variante posée) 2 ; seuls 1 ; sans ligne 1 ; entre Jumbo 2', [r.marques, r.seuls, r.sansLigne, r.entreJumbo], [2, 1, 1, 2]);
        verifier('jumbo : le cas confondu nomme la fiche et les produits normaux avec lesquels il la partage', [r.confondus.find(x => x.idProduct === 301).normaux, r.confondus.find(x => x.idProduct === 601).normaux], [[302], [701]]);
        verifier('jumbo : le contrôle ne touche à rien', J.writes.length, 0);
    });

    // ── 5 bis. L'EXÉCUTEUR de bout en bout ──
    await essayer('executeur', async () => {
        const { executer } = require(path.join(DIR, 'poser-variante-staff.js'));
        const [A, B2, C, D] = PAIRES;
        const verdicts = [verdict(1, A, 'staff-identifie'), verdict(2, B2, 'staff-identifie'), verdict(3, C, 'jumbo-identifie'), verdict(4, D, 'jumbo-identifie'),
            verdict(5, PAIRES[4], 'douteux', { idEtiquete: null, idNormale: null, etiqueteeEstV2: null })];
        const adresses = [adresse(1, A), adresse(2, B2), adresse(3, C), adresse(4, D), adresse(5, PAIRES[4])];
        const m = monde();
        m.col('sets').set(SV, { _id: SV, code: 'SVP', tirage: 'intl', idExpansion: [5241], bulba: { expansion: SV } });
        m.col('sets').set(SWSH, { _id: SWSH, code: 'SWSH', tirage: 'intl', idExpansion: [2916], bulba: { expansion: SWSH } });
        const regle = { fichesDuDocument: imp => imp.map((i, rang) => ({ rang, numero: i.numero, rarete: null })), setParImpression: () => false, produitsDeLaFiche: prods => prods };
        const sortie = [], os = require('os');
        const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stf-')), 'annonce.json');
        const base = { cartesDb: m.db, verdicts, adresses, regle, jumboIds: [32, 42], attenduListe: { staff: 2, jumbo: 2, exclues: 1 }, log: s => sortie.push(s) };
        await executer({ ...base, annonceVers: f });
        verifier('script : l\'essai à blanc n\'écrit rien, imprime la liste, l\'annonce, les servis et les Jumbo', [m.writes.length, /2 paires Staff/.test(sortie.join('\n')), /ANNONCE DE LOT/.test(sortie.join('\n')), /perdus 0/.test(sortie.join('\n')), /JUMBO : 2 candidats/.test(sortie.join('\n')), /essai à blanc/.test(sortie.join('\n'))], [0, true, true, true, true, true]);
        verifier('script : le fichier d\'annonce est écrit et c\'est celui de la fonction de la garde', JSON.parse(fs.readFileSync(f, 'utf8')), { [`images-partagees-tampon set:${SV}`]: 2, [`images-partagees-tampon set:${SWSH}`]: 2 });
        sortie.length = 0; await executer({ ...base, ecrire: true, attendu: 4 });
        verifier('script : l\'écriture relit et le dit (4/4 entrées, 8 lignes, 3 documents)', /relu : 4\/4 entrées, 8 lignes et 3 documents/.test(sortie.join('\n')), true);
        sortie.length = 0; const nw = m.writes.length; await executer({ ...base, ecrire: true, attendu: 4 });
        verifier('script : un second passage ne réécrit rien et le dit', [m.writes.length - nw, /déjà écrit|idempotent/.test(sortie.join('\n'))], [0, true]);
        let msg = null; try { await executer({ ...base, attenduListe: { staff: 56, jumbo: 5, exclues: 3 } }); } catch (e) { msg = String(e.message); }
        verifier('script : des verdicts qui ne donnent pas 56/5/3 arrêtent tout', /56/.test(msg || ''), true);
    });

    // ── 6. LA LIGNE DE COMMANDE : écrite par ce qu'elle autorise ──
    await essayer('script', () => {
        const { spawnSync } = require('child_process');
        const lancer = (...args) => spawnSync(process.execPath, [path.join(DIR, 'poser-variante-staff.js'), ...args], { encoding: 'utf8', env: { ...process.env, MONGODB_URI: '', MONGODB_CARTES_URI: '' } });
        verifier('ligne de commande : un argument inconnu refuse avant toute connexion (code 2)', [lancer('--bidon').status, lancer('--ecrire=1').status], [2, 2]);
        verifier('ligne de commande : --ecrire sans --attendu refuse avant toute connexion (code 2)', lancer('--ecrire').status, 2);
    });

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e.stack); process.exit(1); });
