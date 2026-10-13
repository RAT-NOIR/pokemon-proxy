'use strict';
// Lot JA-2 — BANC DE BOUT EN BOUT d'une ligne à `plageDeRangs`, à travers `collecterSet` lui-même (la fonction du worker), client artofpkm et base FAUX en mémoire : aucune requête, aucune base,
// aucun bucket. Les lignes sont les VRAIES IPNC et IPNT (table-sets.js + sources-sets.js : liste 42, plages [1,40] et [41,80]), sur une liste de 80 entrées sans numéro imprimé.
//   · chaque ligne mesure, télécharge et joint SEULEMENT sa plage (le client faux compte ce qu'on lui demande) ;
//   · la Potion du deck Chikorita (rang 15) et celle du deck Totodile (rang 60) vont chacune à SON set, au numéro de son deck (15 / 20) ;
//   · une plage sans aucune entrée dans la liste → refus, rien demandé au-delà de la liste ;
//   · le REJEU de la jointure (liste d'état non filtrée) écrit le même `completImages` que la collecte ;
//   · une ligne SANS plage (témoin : IPB) télécharge toute sa liste comme avant.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.R2_BUCKET_IMAGES = 'bucket-faux';
const src = require('./collecte-cartes/artofpkm');
const r2 = require('./collecte-cartes/r2');
const { collecterSet, joindreImages } = require('./collecteur-images.js');
const { ligne } = require('./collecte-cartes/table-sets');
const { sourceDe } = require('./collecte-cartes/sources-sets');

let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log('  ✅', nom); } catch (e) { ko++; console.log('  ❌', nom, '—', e.message); } };
const silencieux = async f => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => { }; try { return await f(); } finally { console.log = l; console.warn = w; console.error = e; } };

// ── la base fausse : les seules formes de requête de collecterSet et de joindreImages (même banc que test-collecte-sous-section-v8.js) ──
function fausseBase() {
    const cols = { cartes: new Map(), images: new Map(), etat: new Map(), sets: new Map(), restes: [] };
    const lire = (o, k) => k.split('.').reduce((x, p) => x?.[p], o);
    const ecrire = (o, k, v) => { const ps = k.split('.'); let x = o; for (const p of ps.slice(0, -1)) x = x[p] ??= {}; x[ps.at(-1)] = v; };
    const accepte = (d, f) => Object.entries(f || {}).every(([k, v]) => {
        if (k === '$or') return v.some(s => accepte(d, s));
        const x = lire(d, k);
        if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
            if ('$in' in v) return Array.isArray(x) ? x.some(y => v.$in.map(Number).includes(Number(y)) || v.$in.includes(y)) : v.$in.some(y => y === x || (typeof y === 'number' && Number(x) === y));
            if ('$exists' in v) return (x !== undefined) === v.$exists;
            if ('$ne' in v) return x !== v.$ne;
            if ('$elemMatch' in v) return Array.isArray(x) && x.some(e => accepte(e, v.$elemMatch));
            return false;
        }
        if (v === null) return x == null;
        return Array.isArray(x) && !Array.isArray(v) ? x.includes(v) : x === v;
    });
    const appliquer = (d, u) => {
        for (const [k, v] of Object.entries(u.$set || {})) ecrire(d, k, v);
        for (const k of Object.keys(u.$unset || {})) delete d[k];
        for (const [k, v] of Object.entries(u.$pull || {})) d[k] = (d[k] || []).filter(e => !accepte(e, v));
        for (const [k, v] of Object.entries(u.$push || {})) (d[k] ??= []).push(...(v.$each || [v]));
    };
    const tous = (col, f) => [...col.values()].filter(d => accepte(d, f));
    const requete = liste => ({ lean: async () => structuredClone(liste), select() { return this; } });
    const requete2 = d => ({ lean: async () => structuredClone(d), select() { return this; } });
    const modele = col => ({
        find: f => requete(tous(col, f)),
        findById: id => requete2(col.get(id) ?? null),
        async countDocuments(f) { return tous(col, f).length; },
        async updateOne(f, u, o = {}) {
            let d = tous(col, f)[0];
            if (!d) { if (!o.upsert) return { matchedCount: 0, modifiedCount: 0 }; d = { _id: f._id }; col.set(d._id, d); }
            appliquer(d, u); return { matchedCount: 1, modifiedCount: 1 };
        },
        findOneAndUpdate(f, u) { let d = col.get(f._id); if (!d) { d = { _id: f._id, ...(u.$setOnInsert || {}) }; col.set(d._id, d); } appliquer(d, u); return { lean: async () => structuredClone(d) }; }
    });
    const M = {
        Carte: modele(cols.cartes), Image: modele(cols.images), EtatImages: modele(cols.etat), Set: modele(cols.sets),
        Etat: { findById: () => requete2(null) },
        Reste: { async deleteMany() { cols.restes.length = 0; }, async insertMany(l) { cols.restes.push(...l); } }
    };
    return { cols, M };
}

// ── le monde d'Intro Pack Neo : la Potion est dans les DEUX decks (n°15 Chikorita, n°20 Totodile) ; Chikorita n°1 et n°30 ; Pikachu n°1 du deck Totodile ──
const SC = 'Intro-Pack-Neo-Chikorita', ST = 'Intro-Pack-Neo-Totodile', EXP = 'Intro Pack Neo', CH = 'Chikorita Half Deck', TO = 'Totodile Half Deck';
const imp = (deck, numero) => ({ tirage: 'jp', expansion: EXP, deck, numero });
const semer = B => {
    B.cols.sets.set(SC, { _id: SC }); B.cols.sets.set(ST, { _id: ST });
    const cartes = [
        { _id: 1, nomEn: 'Potion', sets: [SC, ST], images: [], impressions: [imp(CH, '15'), imp(TO, '20')] },
        { _id: 2, nomEn: 'Chikorita', sets: [SC], images: [], impressions: [imp(CH, '1'), imp(CH, '30')] },
        { _id: 3, nomEn: 'Pikachu', sets: [ST], images: [], impressions: [imp(TO, '1')] }
    ];
    for (const c of cartes) B.cols.cartes.set(c._id, c);
    const titres = { 1: 'Chikorita', 15: 'Potion', 30: 'Chikorita', 41: 'Pikachu', 60: 'Potion' };
    return Array.from({ length: 80 }, (_, i) => ({ titre: titres[i + 1] || `Remplissage ${i + 1}`, sourceSetId: 42, n: i + 1, original: `https://cdn.faux/42-${i + 1}`, cleCdn: `42-${i + 1}`, vignette: null }));
};
const demandes = { listes: 0, mesures: [], pages: [], telechargements: [] };
function brancherLeClientFaux(liste) {
    demandes.listes = 0; demandes.mesures = []; demandes.pages = []; demandes.telechargements = [];
    src.listerSet = async () => { demandes.listes++; const l = liste.map(x => ({ ...x })); Object.defineProperty(l, 'pages', { value: [{ lot: 1, chemin: 'sets/42/cards', lues: l.length, nouvelles: l.length, suites: [] }] }); return l; };
    src.enTeteImage = async url => { demandes.mesures.push(url); return { fmt: 'webp', w: 593, h: 834, octets: 1000, type: 'image/webp' }; };
    src.pageCarte = async (sid, n) => { demandes.pages.push(`${sid}/${n}`); return { numero: null, total: null, nomEn: liste.find(x => x.sourceSetId === sid && x.n === n).titre, nomJa: null, illustrateur: null, rarete: null, setNomSource: 'Fake', setNomJa: null, original: `https://cdn.faux/${sid}-${n}` }; };
    src.telecharger = async url => { demandes.telechargements.push(url); return { buffer: Buffer.from('x'), octets: 1, sha256: `sha-${url}`, w: 593, h: 834, fmt: 'webp', type: 'image/webp' }; };
    r2.deposerBinaire = async () => { };
}
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'ja2-plage-'));
const rangs = ds => ds.map(x => Number(String(x).split('-').pop().split('/').pop())).sort((a, b) => a - b);

(async () => {
    assert.deepStrictEqual(sourceDe('IPNC').plageDeRangs, [1, 40], 'le banc suppose les vraies lignes IPNC / IPNT'); assert.deepStrictEqual(sourceDe('IPNT').plageDeRangs, [41, 80]);
    const B = fausseBase(); const liste = semer(B); brancherLeClientFaux(liste);
    await t('IPNC : collecterSet sort « verifie »', async () => {
        const c = await silencieux(() => collecterSet('IPNC', B.M, dossier));
        assert.strictEqual(c.etat, 'verifie', JSON.stringify(c).slice(0, 200));
    });
    await t('IPNC : MESURE dans SA plage (rangs 1, 2, 3), 40 pages et 40 originaux, aucun du rang 41 à 80', () => {
        assert.deepStrictEqual(rangs(demandes.mesures), [1, 2, 3]);
        assert.deepStrictEqual(rangs(demandes.pages), Array.from({ length: 40 }, (_, i) => i + 1));
        assert.deepStrictEqual(rangs(demandes.telechargements), Array.from({ length: 40 }, (_, i) => i + 1));
    });
    await t('IPNC : seuls des documents image des rangs 1-40 sont écrits, sous le slug du set', () => {
        const docs = [...B.cols.images.values()];
        assert.strictEqual(docs.length, 40); assert.ok(docs.every(d => d.n <= 40 && d.set === SC), 'un document hors plage ou sous un autre slug');
    });
    await t('IPNC : la Potion reçoit le rang 15 au n°15 ; Chikorita ses rangs 1 et 30 aux n°1 et n°30 ; rien du deck Totodile', () => {
        assert.deepStrictEqual(B.cols.cartes.get(1).images.map(i => `${i.set}|${i.numero}|${i.cleR2}`), [`${SC}|15|artofpkm/42/15.webp`]);
        assert.deepStrictEqual(B.cols.cartes.get(2).images.map(i => `${i.numero}|${i.cleR2}`).sort(), ['1|artofpkm/42/1.webp', '30|artofpkm/42/30.webp']);
        assert.deepStrictEqual(B.cols.cartes.get(3).images, []);
    });
    await t('IPNC : COMPLÉTUDE — entrées source = 40 (la plage), concordance vraie', () => {
        const c = B.cols.sets.get(SC).completImages;
        assert.strictEqual(c.entreesSource, 40, `entreesSource ${c.entreesSource}`); assert.strictEqual(c.concordance, true, JSON.stringify(c));
    });
    await t('IPNT sur la MÊME base : sa plage seule (rangs 41-80), la Potion y reçoit le rang 60 au n°20 SANS toucher l\'entrée du set Chikorita', async () => {
        brancherLeClientFaux(liste);
        const c = await silencieux(() => collecterSet('IPNT', B.M, dossier));
        assert.strictEqual(c.etat, 'verifie', JSON.stringify(c).slice(0, 200));
        assert.deepStrictEqual(rangs(demandes.pages), Array.from({ length: 40 }, (_, i) => i + 41));
        assert.deepStrictEqual(rangs(demandes.mesures), [41, 42, 43]);
        assert.deepStrictEqual(B.cols.cartes.get(1).images.map(i => `${i.set}|${i.numero}|${i.cleR2}`).sort(), [`${SC}|15|artofpkm/42/15.webp`, `${ST}|20|artofpkm/42/60.webp`].sort());
        assert.deepStrictEqual(B.cols.cartes.get(3).images.map(i => `${i.set}|${i.numero}`), [`${ST}|1`]);
        assert.strictEqual([...B.cols.images.values()].length, 80);
    });
    await t('REJEU (liste d\'état NON filtrée, comme --rejouer-jointure) : le MÊME completImages que la collecte', async () => {
        const avant = B.cols.sets.get(SC).completImages;
        const r = await silencieux(() => joindreImages(B.M, ligne('IPNC'), SC, sourceDe('IPNC'), { 42: liste }, {}, dossier, { silencieux: true }));
        for (const k of ['entreesSource', 'cartesDuSet', 'imagesOk', 'rattachements', 'cartesCouvertes', 'emplacements', 'concordance']) assert.deepStrictEqual(r[k], avant[k], `${k} : rejeu ${JSON.stringify(r[k])} ≠ collecte ${JSON.stringify(avant[k])}`);
    });
    await t('PLAGE ABSENTE de la liste (liste de 30 entrées, IPNT [41,80]) : « refuse-sous-section-absente »-équivalent, rien téléchargé', async () => {
        const B2 = fausseBase(); const l2 = semer(B2).slice(0, 30); brancherLeClientFaux(l2);
        const r = await silencieux(() => collecterSet('IPNT', B2.M, dossier));
        assert.ok(/^refuse/.test(r.etat), JSON.stringify(r).slice(0, 200));
        assert.strictEqual(demandes.telechargements.length, 0); assert.strictEqual(demandes.pages.length, 0);
    });
    console.log(`\n${ok} réussi(s), ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ÉCHEC DU BANC', e.stack || e.message); process.exit(2); });
