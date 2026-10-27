// node test-servir-scans-base-set.js — servir le scan Unlimited sans tampon à la place du scan « Edition 1 » sur 48 fiches Base-Set (collecte-cartes/servir-scans-base-set.js + servir-scans-base-set.js).
// Base EN MÉMOIRE, aucune requête, jamais une vraie base ni un dossier du testeur (sauvegardes dans un dossier temporaire).
const fs = require('fs');
const os = require('os');
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const S = require(path.join(DIR, 'collecte-cartes', 'servir-scans-base-set.js'));
const CLI = require(path.join(DIR, 'servir-scans-base-set.js'));
const { entreeBulba } = require(path.join(DIR, 'collecteur-images-bulba.js'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const essayer = async (nom, f) => { try { await f(); } catch (e) { ko++; console.log(`❌ ${nom}\n   EXCEPTION ${String(e.stack).split('\n').slice(0, 3).join(' | ')}`); } };
const leve = async f => { try { await f(); return null; } catch (e) { return e.message; } };

// une base en mémoire : find / findOne / updateOne ($set, $unset, $pull, $push) ; filtres : égalité, $ne sur 'images.cleR2', $elemMatch sur images
function fausseBase({ pannes = new Set() } = {}) {
    const cols = new Map();
    const col = n => cols.get(n) || cols.set(n, new Map()).get(n);
    const accepte = (d, f) => Object.entries(f || {}).every(([k, v]) => {
        if (k === 'images.cleR2') { const vals = (d.images || []).map(i => i.cleR2); return v && typeof v === 'object' && '$ne' in v ? !vals.includes(v.$ne) : vals.includes(v); }
        const x = d[k];
        if (v && typeof v === 'object' && '$elemMatch' in v) return (x || []).some(e => Object.entries(v.$elemMatch).every(([a, b]) => e[a] === b));
        return x === v;
    });
    const tous = (n, f) => [...col(n).values()].filter(d => accepte(d, f));
    const writes = [];
    const collection = n => ({
        find(f) { return { toArray: async () => structuredClone(tous(n, f)) }; },
        async findOne(f) { return structuredClone(tous(n, f)[0] ?? null); },
        async updateOne(f, u, o = {}) {
            if (pannes.has(writes.length)) { writes.push({ n, f, u, panne: true }); throw new Error('panne simulée'); }
            const d = tous(n, f)[0]; if (!d) return { matchedCount: 0, modifiedCount: 0 };
            const avant = JSON.stringify(d);
            for (const [k, v] of Object.entries(u.$set || {})) {
                const m = /^(\w+)\.\$\[(\w+)\](?:\.(\w+))?$/.exec(k);
                if (m) { const af = (o.arrayFilters || []).find(a => Object.keys(a).every(c => c.startsWith(`${m[2]}.`))); d[m[1]] = d[m[1]].map(e => af && Object.entries(af).every(([c, b]) => e[c.slice(m[2].length + 1)] === b) ? (m[3] ? { ...e, [m[3]]: structuredClone(v) } : structuredClone(v)) : e); }
                else d[k] = structuredClone(v);
            }
            for (const k of Object.keys(u.$unset || {})) delete d[k];
            for (const [k, c] of Object.entries(u.$pull || {})) d[k] = (d[k] || []).filter(e => !Object.entries(c).every(([a, b]) => e[a] === b));
            for (const [k, v] of Object.entries(u.$push || {})) d[k] = [...(d[k] || []), structuredClone(v)];
            writes.push({ n, f, u });
            return { matchedCount: 1, modifiedCount: JSON.stringify(d) === avant ? 0 : 1 };
        },
        async updateMany() { throw new Error('updateMany : interdit'); }, async insertOne() { throw new Error('insertOne : interdit'); },
        async deleteOne() { throw new Error('deleteOne : interdit'); }, async deleteMany() { throw new Error('deleteMany : interdit'); }, async replaceOne() { throw new Error('replaceOne : interdit'); }
    });
    return { db: { collection }, col, writes, instantane: () => JSON.stringify([...cols].map(([n, m]) => [n, [...m.values()]])) };
}

// deux fiches synthétiques, de la forme exacte de la liste (n° 1 et n° 4)
const L1 = { numero: '1', carteId: 101, nom: 'Alakazam', cleTcgdex: 'tcgdex/Base-Set/1-101.webp', cleBulba: 'bulbapedia/Base-Set/1-101.webp', unlimited: [11], shadowless: [12] };
const L4 = { numero: '4', carteId: 104, nom: 'Charizard', cleTcgdex: 'tcgdex/Base-Set/4-104.webp', cleBulba: 'bulbapedia/Base-Set/4-104.webp', unlimited: [41], shadowless: [42] };
const LISTE = [L1, L4];
const entreeT = l => ({ set: 'Base-Set', source: 'tcgdex', cleR2: l.cleTcgdex, numero: l.numero, w: 600, h: 825, langue: 'en', jointeLe: new Date('2026-09-24T01:33:29.219Z'), vignette: { cleR2: `vignettes/${l.cleTcgdex}`, w: 200, h: 275 } });
const docT = l => ({ _id: `tcgdex/Base-Set/${l.carteId}/${l.numero}`, source: 'tcgdex', set: 'Base-Set', carteId: l.carteId, numero: l.numero, cleR2: l.cleTcgdex, etat: 'ok' });
const docB = l => ({ _id: `bulbapedia/Base-Set/${l.carteId}/${l.numero}`, source: 'bulbapedia', set: 'Base-Set', carteId: l.carteId, numero: l.numero, cleR2: l.cleBulba, etat: 'ok', sha256: 'abc', w: 700, h: 979, fmt: 'webp', urlOriginal: `https://exemple.invalid/${l.numero}.jpg`, preuve: 'nom-de-fichier', page: `${l.nom} (Base Set ${l.numero})`, langue: null, languePreuve: 'format', wOriginal: 732 });
function remplir(f, retouche = {}) {
    for (const l of LISTE) {
        f.col('cartes').set(l.carteId, { _id: l.carteId, nomEn: l.nom, images: [{ set: 'Base-Set-2', source: 'tcgdex', cleR2: `tcgdex/Base-Set-2/x-${l.carteId}.webp`, numero: '9' }, entreeT(l), { set: 'Legendary-Collection', source: 'tcgdex', cleR2: `tcgdex/LC/y-${l.carteId}.webp`, numero: '3' }] });
        f.col('images').set(docT(l)._id, docT(l));
        f.col('images').set(docB(l)._id, docB(l));
    }
    for (const [cle, fn] of Object.entries(retouche)) fn(f, cle);
    return f;
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'servir-bs-'));
const fichier = n => path.join(tmp, n);

(async () => {
    // ── la LISTE fermée
    verifier('liste : 48 fiches, n° 1 à 69 sans 8 ni 18 (tamponnés), cartes distinctes', [S.LISTE.length, S.LISTE.every(l => Number(l.numero) >= 1 && Number(l.numero) <= 69 && !['8', '18'].includes(l.numero)), new Set(S.LISTE.map(l => l.carteId)).size], [48, true, 48]);
    verifier('liste : chaque clé est celle du (set, numéro, carte) de la ligne, des deux côtés', S.LISTE.every(l => l.cleTcgdex === `tcgdex/Base-Set/${l.numero}-${l.carteId}.webp` && l.cleBulba === `bulbapedia/Base-Set/${l.numero}-${l.carteId}.webp`), true);
    verifier('liste : chaque fiche nomme au moins un produit Unlimited et un Shadowless, jamais le même', S.LISTE.every(l => l.unlimited.length >= 1 && l.shadowless.length >= 1 && !l.unlimited.some(p => l.shadowless.includes(p))), true);
    verifier('liste : la preuve ne nomme aucune source', /bulbapedia|tcgdex|cardmarket|tcgplayer/i.test(S.PREUVE), false);

    // ── simulation
    await essayer('simulation', async () => {
        const f = remplir(fausseBase()), avant = f.instantane();
        const p = await S.simuler(f.db, LISTE);
        verifier('simulation : deux fiches conformes → 2 à servir, 0 refus', [p.aServir.length, p.refus.length], [2, 0]);
        verifier('simulation : lecture seule, rien n\'est écrit', [f.writes.length, f.instantane() === avant], [0, true]);
        verifier('annonce : aucune baisse attendue (une entrée remplace une entrée, la vignette est refabriquée)', S.annonce(p), {});
    });
    const refusDe = async retouche => (await S.simuler(remplir(fausseBase(), retouche).db, LISTE)).refus.map(r => [r.entree.numero, r.raison.split(' :')[0]]);
    await essayer('refus', async () => {
        verifier('refus : le document du scan candidat n\'est pas « ok »', await refusDe({ a: f => { f.col('images').get(docB(L1)._id).etat = 'retire'; } }), [['1', 'document candidat']]);
        verifier('refus : le document du scan candidat porte une AUTRE carte', await refusDe({ a: f => { f.col('images').get(docB(L1)._id).carteId = 999; } }), [['1', 'document candidat']]);
        verifier('refus : l\'entrée servie au n° de la ligne n\'est pas celle de la liste (autre source)', await refusDe({ a: f => { f.col('cartes').get(101).images[1].source = 'pkc'; } }), [['1', 'entrée servie']]);
        verifier('refus : aucune entrée au n° de la ligne', await refusDe({ a: f => { f.col('cartes').get(101).images[1].numero = '2'; } }), [['1', 'entrées Base-Set']]);
        verifier('refus : la carte porte DÉJÀ les deux scans (relecture : le remplacement échouerait)', await refusDe({ a: f => { f.col('cartes').get(101).images.push({ set: 'Base-Set-2', source: 'bulbapedia', cleR2: L1.cleBulba, numero: '1' }); } }), [['1', 'les deux scans']]);
        verifier('refus : deux entrées Base-Set au même numéro sur la carte', await refusDe({ a: f => { f.col('cartes').get(104).images.push({ set: 'Base-Set', source: 'pkc', cleR2: 'pkc/x.webp', numero: '4' }); } }), [['4', 'entrées Base-Set']]);
        verifier('refus : le document servi n\'est pas « ok » (déjà retiré)', await refusDe({ a: f => { f.col('images').get(docT(L4)._id).etat = 'retire'; } }), [['4', 'document servi']]);
        verifier('refus : carte absente', await refusDe({ a: f => { f.col('cartes').delete(104); } }), [['4', 'carte absente']]);
        verifier('refus : le document candidat n\'est pas de la source attendue', await refusDe({ a: f => { f.col('images').get(docB(L1)._id).source = 'pkc'; } }), [['1', 'document candidat']]);
        verifier('refus : DEUX documents portent la clé du candidat', await refusDe({ a: f => { f.col('images').set('double', { ...docB(L1), _id: 'double' }); } }), [['1', 'document candidat']]);
        const fp = remplir(fausseBase({ pannes: new Set([0]) })), svp = fichier('panne-0.json');
        await leve(async () => S.servir(fp.db, await S.simuler(fp.db, LISTE), { sauvegarde: svp }));
        verifier('sauvegarde : écrite AVANT la première écriture (présente même si la 1re écriture tombe)', [fs.existsSync(svp), S.lireSauvegarde(fs.readFileSync(svp, 'utf8')).lignes.length], [true, 2]);
    });

    // ── écriture, relu, rejeu, restauration
    await essayer('écriture', async () => {
        const f = remplir(fausseBase()), origine = f.instantane();
        const p = await S.simuler(f.db, LISTE);
        verifier('écriture : sans sauvegarde → refus, rien écrit', [await leve(() => S.servir(f.db, p, {})) !== null, f.writes.length], [true, 0]);
        const existe = fichier('existe.json'); fs.writeFileSync(existe, '{}');
        verifier('écriture : une sauvegarde EXISTANTE n\'est jamais écrasée → refus, rien écrit', [await leve(() => S.servir(f.db, p, { sauvegarde: existe })) !== null, f.writes.length, fs.readFileSync(existe, 'utf8')], [true, 0, '{}']);
        const sv = fichier('sauvegarde.json'), le = new Date('2026-10-27T15:00:00Z');
        const n = await S.servir(f.db, p, { sauvegarde: sv, maintenant: le });
        const c1 = f.col('cartes').get(101);
        verifier('écriture : 2 fiches servies', n, 2);
        verifier('écriture : la carte ne porte plus l\'entrée « Edition 1 » et porte le scan candidat, construit par la règle de la jointure (entreeBulba)', [c1.images.filter(i => i.set === 'Base-Set').map(i => i.cleR2), JSON.stringify({ ...c1.images.find(i => i.cleR2 === L1.cleBulba), collecteLe: 'horodaté par la règle' })], [[L1.cleBulba], JSON.stringify({ ...entreeBulba('Base-Set', docB(L1), le), collecteLe: 'horodaté par la règle' })]);
        verifier('écriture : remplacement EN PLACE (même position), les entrées d\'autres sets intactes', c1.images.map(i => i.set), ['Base-Set-2', 'Base-Set', 'Legendary-Collection']);
        verifier('écriture : toutes les cartes d\'abord, puis les documents (relecture : un arrêt ne laisse jamais un document retiré sans son remplaçant)', f.writes.map(w => w.n), ['cartes', 'cartes', 'images', 'images']);
        const dT = f.col('images').get(docT(L1)._id);
        verifier('écriture : le document « Edition 1 » passe à « retire », remplacé par le scan servi (une recollecte ne le reprend pas)', [dT.etat, dT.retrait.etatAvant, dT.retrait.remplacePar], ['retire', 'ok', { source: 'bulbapedia', cleR2: L1.cleBulba }]);
        verifier('écriture : le motif du retrait ne nomme aucune source', /bulbapedia|tcgdex|cardmarket|tcgplayer/i.test(dT.retrait.motif), false);
        verifier('écriture : le document du scan servi n\'est pas modifié', f.col('images').get(docB(L1)._id).etat, 'ok');
        const sauv = S.lireSauvegarde(fs.readFileSync(sv, 'utf8'));
        verifier('sauvegarde : écrite AVANT, une ligne par fiche, avec l\'entrée retirée entière ; les dates restent des dates (EJSON, relecture)', [sauv.lignes.length, sauv.lignes[0].entreeRetiree.cleR2, sauv.lignes[0].entreeRetiree.vignette.cleR2, sauv.lignes[0].entreeRetiree.jointeLe instanceof Date], [2, L1.cleTcgdex, `vignettes/${L1.cleTcgdex}`, true]);
        const rejeu = await S.simuler(f.db, LISTE);
        verifier('rejeu : plus rien à servir ni à finir, deux refus « déjà servi »', [rejeu.aServir.length, rejeu.aFinir.length, rejeu.refus.map(r => r.raison.split(' :')[0])], [0, 0, ['déjà servi', 'déjà servi']]);
        verifier('restaurer : sans --attendu en écriture → refus', await leve(() => S.restaurer(f.db, sauv, { ecrire: true })) !== null, true);
        verifier('restaurer : --attendu faux → refus', await leve(() => S.restaurer(f.db, sauv, { ecrire: true, attendu: 3 })) !== null, true);
        const r = await S.restaurer(f.db, sauv, { ecrire: true, attendu: 2 });
        verifier('restaurer : la base revient EXACTEMENT à l\'origine (ordre des entrées compris) ; relu 2/2', [f.instantane() === origine, r.relu], [true, { rendues: 2 }]);
        verifier('restaurer : la date restaurée est une Date', f.col('cartes').get(101).images[1].jointeLe instanceof Date, true);
        const r2 = await S.restaurer(f.db, sauv, { ecrire: true, attendu: 2 });
        verifier('restaurer : rejouée → reprenable, rien de plus n\'est écrit, relu 2/2', [f.instantane() === origine, r2.relu], [true, { rendues: 2 }]);
    });

    // ── un arrêt au milieu (relecture) : la reprise finit le travail, la restauration aussi
    await essayer('reprise', async () => {
        // panne sur la 3e écriture : les deux cartes sont faites, aucun document
        const f = remplir(fausseBase({ pannes: new Set([2]) })), origine = f.instantane();
        const sv = fichier('panne.json');
        verifier('panne : servir lève au milieu', (await leve(async () => S.servir(f.db, await S.simuler(f.db, LISTE), { sauvegarde: sv }))) !== null, true);
        const p = await S.simuler(f.db, LISTE);
        verifier('panne : la simulation suivante voit 2 documents à finir (cartes déjà servies, document encore « ok »)', [p.aServir.length, p.aFinir.length, p.refus.length], [0, 2, 0]);
        const k = f.writes.length;
        const n = await S.servir(f.db, p, { sauvegarde: fichier('panne-2.json') });
        verifier('reprise : finit les 2 documents, n\'écrit aucune carte', [n, f.writes.slice(k).map(w => w.n)], [2, ['images', 'images']]);
        verifier('reprise : rien ne reste', [(await S.simuler(f.db, LISTE)).aFinir.length], [0]);
        const r = await S.restaurer(f.db, S.lireSauvegarde(fs.readFileSync(sv, 'utf8')), { ecrire: true, attendu: 2 });
        verifier('restaurer après panne + reprise : base d\'origine, relu 2/2', [f.instantane() === origine, r.relu], [true, { rendues: 2 }]);
    });
    await essayer('restauration partielle', async () => {
        // panne dans la restauration : la seconde restauration termine
        const f = remplir(fausseBase()), origine = f.instantane();
        const sv = fichier('rest.json');
        await S.servir(f.db, await S.simuler(f.db, LISTE), { sauvegarde: sv });
        const sauv = S.lireSauvegarde(fs.readFileSync(sv, 'utf8'));
        const ecritesAvant = f.writes.length;
        const g = fausseBase({ pannes: new Set([ecritesAvant + 1]) });   // même contenu, panne à la 2e écriture de la restauration
        for (const [n, m] of [['cartes', f.col('cartes')], ['images', f.col('images')]]) for (const [k, v] of m) g.col(n).set(k, structuredClone(v));
        for (let i = 0; i < ecritesAvant; i++) g.writes.push({});
        verifier('restaurer : panne au milieu → lève', (await leve(() => S.restaurer(g.db, sauv, { ecrire: true, attendu: 2 }))) !== null, true);
        const r = await S.restaurer(g.db, sauv, { ecrire: true, attendu: 2 });
        verifier('restaurer : relancée, elle termine ; base d\'origine, relu 2/2', [g.instantane() === origine, r.relu], [true, { rendues: 2 }]);
    });

    // ── la LANGUE lue à l'image (2026-10-27, après le lot : la règle de langue du site refuse un scan sans langue dont le format n'est pas audité)
    await essayer('langue', async () => {
        const f = remplir(fausseBase());
        await S.servir(f.db, await S.simuler(f.db, LISTE), { sauvegarde: fichier('l0.json') });
        const avant = f.instantane();
        const p = await S.simulerLangue(f.db, LISTE);
        verifier('langue : deux scans servis sans langue → 2 à poser, lecture seule', [p.aPoser.length, p.deja.length, p.refus.length, f.instantane() === avant], [2, 0, 0, true]);
        verifier('langue : la preuve ne nomme aucune source et dit la lecture à l\'image', [/bulbapedia|tcgdex|cardmarket|tcgplayer/i.test(S.LANGUE_LUE.languePreuve), /lu .*image/.test(S.LANGUE_LUE.languePreuve), S.LANGUE_LUE.langue], [false, true, 'en']);
        verifier('langue : sans sauvegarde → refus, rien écrit', (await leve(() => S.poserLangue(f.db, p, {}))) !== null && f.instantane() === avant, true);
        const sv = fichier('langue.json');
        const n = await S.poserLangue(f.db, p, { sauvegarde: sv });
        const e1 = f.col('cartes').get(101).images.find(i => i.cleR2 === L1.cleBulba), d1 = f.col('images').get(docB(L1)._id);
        verifier('langue : 2 posées, sur l\'entrée servie ET sur son document (le rejeu de la jointure reprend la langue du document)', [n, e1.langue, e1.languePreuve === S.LANGUE_LUE.languePreuve, d1.langue, d1.languePreuve === S.LANGUE_LUE.languePreuve], [2, 'en', true, 'en', true]);
        verifier('langue : l\'entrée de la jointure rejouée sur ce document porte la langue lue', entreeBulba('Base-Set', d1).langue, 'en');
        verifier('langue : les autres entrées de la carte sont intactes', f.col('cartes').get(101).images.filter(i => i.set !== 'Base-Set').every(i => i.langue === undefined), true);
        const rejeu = await S.simulerLangue(f.db, LISTE);
        verifier('langue : rejeu → plus rien à poser, 2 déjà', [rejeu.aPoser.length, rejeu.deja.length], [0, 2]);
        const g = remplir(fausseBase());
        verifier('langue : une fiche pas encore servie → refus (on ne pose la langue que sur le scan servi)', (await S.simulerLangue(g.db, LISTE)).refus.map(r => r.raison.split(' :')[0]), ['pas servi', 'pas servi']);
        const h = remplir(fausseBase()); await S.servir(h.db, await S.simuler(h.db, LISTE), { sauvegarde: fichier('l1.json') }); h.col('images').get(docB(L4)._id).langue = 'ja';
        verifier('langue : une langue DÉJÀ écrite autre que l\'anglais → refus, jamais écrasée', (await S.simulerLangue(h.db, LISTE)).refus.map(r => [r.entree.numero, r.raison.split(' :')[0]]), [['4', 'langue déjà écrite']]);
        const r = await S.restaurerLangue(f.db, S.lireSauvegarde(fs.readFileSync(sv, 'utf8')), { ecrire: true, attendu: 2 });
        verifier('langue : restaurée → base d\'avant la pose, relu 2/2', [f.instantane() === avant, r.relu], [true, { rendues: 2 }]);
        const k2 = remplir(fausseBase()); await S.servir(k2.db, await S.simuler(k2.db, LISTE), { sauvegarde: fichier('l2.json') }); k2.col('cartes').get(104).images.find(i => i.cleR2 === L4.cleBulba).langue = 'ja';
        verifier('langue : une ENTRÉE déjà en japonais (document propre) → refus, jamais écrasée', (await S.simulerLangue(k2.db, LISTE)).refus.map(r => [r.entree.numero, r.raison.split(' :')[0]]), [['4', 'langue déjà écrite']]);
        // panne au milieu (relecture) : la reprise termine ; la PREMIÈRE sauvegarde garde les vraies valeurs d'avant et restaure tout
        const pz = remplir(fausseBase()); await S.servir(pz.db, await S.simuler(pz.db, LISTE), { sauvegarde: fichier('l3.json') });
        const avantPose = pz.instantane(), k = pz.writes.length;
        const pp = fausseBase({ pannes: new Set([k + 1]) });
        for (const [n, m] of [['cartes', pz.col('cartes')], ['images', pz.col('images')]]) for (const [c, v] of m) pp.col(n).set(c, structuredClone(v));
        for (let i = 0; i < k; i++) pp.writes.push({});
        const sv1 = fichier('langue-1.json');
        verifier('langue : panne au milieu → lève', (await leve(async () => S.poserLangue(pp.db, await S.simulerLangue(pp.db, LISTE), { sauvegarde: sv1 }))) !== null, true);
        await S.poserLangue(pp.db, await S.simulerLangue(pp.db, LISTE), { sauvegarde: fichier('langue-2.json') });
        verifier('langue : la reprise termine (plus rien à poser)', (await S.simulerLangue(pp.db, LISTE)).aPoser.length, 0);
        const rr = await S.restaurerLangue(pp.db, S.lireSauvegarde(fs.readFileSync(sv1, 'utf8')), { ecrire: true, attendu: 2 });
        verifier('langue : la PREMIÈRE sauvegarde restaure l\'état d\'avant la pose, relu 2/2', [pp.instantane() === avantPose, rr.relu], [true, { rendues: 2 }]);
    });

    // ── la ligne de commande
    await essayer('CLI', async () => {
        const f = remplir(fausseBase()), logs = [];
        let gardes = 0;
        const garde = () => { gardes++; };
        verifier('CLI : simulation → rien écrit, garde non appelée', [(await CLI.executer({ db: f.db, liste: LISTE, log: m => logs.push(m), garde })).plan.aServir.length, f.writes.length, gardes], [2, 0, 0]);
        verifier('CLI : --attendu différent du plan → arrêt, rien écrit', [await leve(() => CLI.executer({ db: f.db, liste: LISTE, ecrire: true, attendu: 3, sauvegarde: fichier('cli1.json'), log: () => {}, garde })) !== null, f.writes.length], [true, 0]);
        let vignettes = 0;
        const res = await CLI.executer({ db: f.db, liste: LISTE, ecrire: true, attendu: 2, sauvegarde: fichier('cli2.json'), log: () => {}, garde, vignetter: async () => { vignettes++; return { vg: { fabriquees: 2, echecs: 0 }, sets: ['Base-Set'] }; } });
        verifier('CLI : écriture → garde appelée AVANT, 2 servies, relu 0 restant, vignettes refabriquées une fois', [gardes, res.n, res.reste, vignettes], [1, 2, 0, 1]);
        verifier('CLI : arguments autorisés seulement', ['--ecrire', '--attendu=48', '--sauvegarde=x.json', '--restaurer=x.json', '--annonce-vers=a.json', '--langue', '--force'].map(a => CLI.AUTORISES.some(r => r.test(a))), [true, true, true, true, true, true, false]);
        const gl = gardes;
        verifier('CLI --langue : simulation → 2 à poser, rien écrit, garde non appelée', [(await CLI.executerLangue({ db: f.db, liste: LISTE, log: () => {}, garde })).plan.aPoser.length, gardes], [2, gl]);
        verifier('CLI --langue : --attendu faux → arrêt', (await leve(() => CLI.executerLangue({ db: f.db, liste: LISTE, ecrire: true, attendu: 5, sauvegarde: fichier('cl0.json'), log: () => {}, garde }))) !== null, true);
        const rl = await CLI.executerLangue({ db: f.db, liste: LISTE, ecrire: true, attendu: 2, sauvegarde: fichier('cl1.json'), log: () => {}, garde });
        verifier('CLI --langue : écriture → garde appelée, 2 posées, 0 restant', [gardes, rl.n, rl.reste], [gl + 1, 2, 0]);
    });

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})();
