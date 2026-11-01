'use strict';
// Banc de corriger-f3.js — fonctions PURES et fausse base en mémoire (aucune connexion, aucune écriture réelle).
// Les fixtures reprennent les formes RÉELLES lues en base le 2026-11-01 (Energy Restore 059/050, Drifblim FB 038 / Electivire FB 71322, Wind-from-the-Sea 087, Primal Kyogre-EX Gaia Volcano 073).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('./corriger-f3');

let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  KO  ' + nom + '\n      ' + String(e.message).split('\n').join('\n      ')); } };
const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

// ───── fausse base en mémoire : find/delete/replace/update avec les seuls opérateurs que l'outil emploie ─────
function fauxDb(init, avantEcriture = () => { }) {
    const cols = clone(init); const journal = [];
    const col = n => cols[n] || (cols[n] = []);
    const match = (d, f) => Object.entries(f).every(([k, v]) => JSON.stringify(d[k]) === JSON.stringify(v));
    const chemin = (d, p, creer) => { const ks = p.split('.'); let o = d; for (const k of ks.slice(0, -1)) { if (o[k] == null) { if (!creer) return [null]; o[k] = {}; } o = o[k]; } return [o, ks.at(-1)]; };
    return {
        cols, journal,
        collection: n => ({
            findOne: async f => clone(col(n).find(d => match(d, f))),
            deleteOne: async f => { avantEcriture(n, 'deleteOne'); journal.push([n, 'deleteOne', f]); const i = col(n).findIndex(d => match(d, f)); if (i >= 0) col(n).splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; },
            replaceOne: async (f, doc, o = {}) => { avantEcriture(n, 'replaceOne'); journal.push([n, 'replaceOne', f]); const i = col(n).findIndex(d => match(d, f)); if (i >= 0) { col(n)[i] = clone(doc); return { modifiedCount: 1, upsertedCount: 0 }; } if (o.upsert) { col(n).push(clone(doc)); return { modifiedCount: 0, upsertedCount: 1 }; } return { modifiedCount: 0, upsertedCount: 0 }; },
            updateOne: async (f, u) => {
                avantEcriture(n, 'updateOne'); journal.push([n, 'updateOne', f, u]);
                const d = col(n).find(x => match(x, f)); if (!d) return { modifiedCount: 0 };
                let mod = 0;
                for (const [op, spec] of Object.entries(u)) for (const [p, v] of Object.entries(spec)) {
                    if (op === '$set') { const [o, k] = chemin(d, p, true); o[k] = clone(v); mod = 1; }
                    else if (op === '$pull') {
                        const [o, k] = chemin(d, p, false); if (!o || !Array.isArray(o[k])) continue; const avant = o[k].length;
                        o[k] = o[k].filter(e => !(v && typeof v === 'object' ? Object.entries(v).every(([kk, vv]) => e[kk] === vv) : e === v)); mod = o[k].length < avant ? 1 : mod;
                    } else if (op === '$addToSet') { const [o, k] = chemin(d, p, true); o[k] = o[k] || []; if (!o[k].includes(v)) { o[k].push(v); mod = 1; } }
                    else if (op === '$push') { const [o, k] = chemin(d, p, true); o[k] = o[k] || []; const items = v.$each ? v.$each : [v]; o[k].splice(v.$position ?? o[k].length, 0, ...clone(items)); mod = 1; }
                    else throw new Error(`opérateur non géré par la fausse base : ${op}`);
                }
                return { modifiedCount: mod };
            }
        })
    };
}

// ───── fixtures ─────
const FAUX_ER = { tirage: 'jp', expansion: 'Base Expansion Pack', deck: null, numero: '059', total: '128', rarete: 'Uncommon', illustrateur: null, illustrateurPreuve: 'aucune source interrogée ne porte ce tirage (jp Base Expansion Pack)' };
const VRAI_ER = { tirage: 'jp', expansion: 'Base Expansion Pack', numero: '050', total: null, deck: null, rarete: null, source: 'setlist' };
const D_ER = M.IMPRESSIONS.find(d => d.carteId === 29833);
const D_KY = M.IMPRESSIONS.find(d => d.carteId === 200932);
const pg = (titre, pageid) => ({ titre, pageid, revid: 1, etat: 'ok' });
const prod = (idProduct, name, numero) => ({ idProduct, name, numero });
const er = () => ({
    carte: { _id: 29833, nomEn: 'Energy Restore', images: [{ set: 'Base-Expansion-Pack', numero: '050' }], impressions: [clone(FAUX_ER), clone(VRAI_ER)] },
    cartesFaux: new Map([[29839, { _id: 29839, nomEn: 'Pokémon Reversal', impressions: [{ tirage: 'jp', expansion: 'Base Expansion Pack', numero: '059' }] }]]),
    titres: ['Pokémon Reversal (Base Expansion Pack 59)', 'Energy Restore (Base Expansion Pack 50)'],
    pages: [pg('Pokémon Reversal (Base Expansion Pack 59)', 29839), pg('Energy Restore (Base Expansion Pack 50)', 29833)],
    produits: [prod(650641, 'Pokémon Reversal', '059'), prod(650640, 'Energy Restore', '050')], images: [], lignes: []
});
const ky = () => ({
    carte: { _id: 200932, nomEn: 'Primal Kyogre-EX', images: [{ set: 'Tidal-Storm', numero: '032' }, { set: 'Tidal-Storm', numero: '073' }], impressions: [{ tirage: 'jp', expansion: 'Tidal Storm', numero: '032', total: '070', rarete: 'RR', illustrateur: '5ban Graphics' }, { tirage: 'jp', expansion: 'Gaia Volcano', numero: '073', total: '070', rarete: 'SR', illustrateur: null }, { tirage: 'jp', expansion: 'Tidal Storm', numero: '073', source: 'setlist', total: null }] },
    cartesFaux: new Map([[200990, { _id: 200990, nomEn: 'Primal Groudon-EX', impressions: [{ tirage: 'jp', expansion: 'Gaia Volcano', numero: '073' }] }]]),
    titres: ['Primal Groudon-EX (Gaia Volcano 73)'], pages: [pg('Primal Groudon-EX (Gaia Volcano 73)', 200990)],
    produits: [prod(563880, 'Primal Groudon-EX [Eruption]', '073')], images: [], lignes: []
});

(async () => {
    console.log('jugerImpression');
    await t('PRÊTE : le n°059 est celui de Pokémon Reversal (Setlist + produit), la bonne impression 050 est là, rien n\'en dépend', () => {
        const r = M.jugerImpression(D_ER, er());
        assert.strictEqual(r.statut, 'prete', JSON.stringify(r));
        assert.strictEqual(r.avant.index, 0);
        assert.strictEqual(r.avant.impression.numero, '059');
        assert.strictEqual(r.preuve.autreCarte, 29839);
    });
    await t('ATTEND : la bonne impression n\'est pas encore sur la carte (le lot f3 n\'est pas passé)', () => {
        const e = er(); e.carte.impressions = [clone(FAUX_ER)];
        const r = M.jugerImpression(D_ER, e); assert.strictEqual(r.statut, 'attend', JSON.stringify(r)); assert.ok(/lot f3/.test(r.raison));
    });
    await t('HYPOTHÈSE f3 : la simulation peut présumer la bonne impression, et le dit', () => {
        const e = er(); e.carte.impressions = [clone(FAUX_ER)]; e.hypothese = true;
        const r = M.jugerImpression(D_ER, e); assert.strictEqual(r.statut, 'prete'); assert.strictEqual(r.hypothese, true);
    });
    await t('PRÉMISSE REJOUÉE — la Setlist range le numéro faux à la carte ELLE-MÊME : le numéro n\'est pas faux → refus', () => {
        const e = er(); e.titres = ['Energy Restore (Base Expansion Pack 59)']; e.pages = [pg('Energy Restore (Base Expansion Pack 59)', 29833)];
        assert.strictEqual(M.jugerImpression(D_ER, e).statut, 'refus');
    });
    await t('PRÉMISSE REJOUÉE — aucune entrée de Setlist au numéro faux → refus (un seul témoin ne suffit pas)', () => {
        const e = er(); e.titres = ['Energy Restore (Base Expansion Pack 50)']; e.pages = [pg('Energy Restore (Base Expansion Pack 50)', 29833)];
        assert.strictEqual(M.jugerImpression(D_ER, e).statut, 'refus');
    });
    await t('PRÉMISSE REJOUÉE — deux entrées de Setlist au même numéro → refus', () => {
        const e = er(); e.titres.push('Autre (Base Expansion Pack 59)'); e.pages.push(pg('Autre (Base Expansion Pack 59)', 1));
        assert.strictEqual(M.jugerImpression(D_ER, e).statut, 'refus');
    });
    await t('PRÉMISSE REJOUÉE — le produit Cardmarket du numéro faux porte un AUTRE nom que l\'autre carte → refus', () => {
        const e = er(); e.produits = [prod(650641, 'Mystery Card', '059'), prod(650640, 'Energy Restore', '050')];
        const r = M.jugerImpression(D_ER, e); assert.strictEqual(r.statut, 'refus', JSON.stringify(r)); assert.ok(/nom de l'autre carte/.test(r.raison));
    });
    await t('PRÉMISSE REJOUÉE — aucun produit Cardmarket à ce numéro → refus', () => {
        const e = er(); e.produits = [prod(650640, 'Energy Restore', '050')];
        assert.strictEqual(M.jugerImpression(D_ER, e).statut, 'refus');
    });
    await t('PRÉMISSE REJOUÉE — l\'autre carte ne porte pas elle-même ce numéro → refus', () => {
        const e = er(); e.cartesFaux.get(29839).impressions = [];
        assert.strictEqual(M.jugerImpression(D_ER, e).statut, 'refus');
    });
    await t('ILLUSTRATEUR lu au numéro faux (décision du 2026-11-01) : la carte reste PRÊTE, l\'illustrateur est retiré avec l\'impression et la preuve le note', () => {
        const e = er(); e.carte.impressions[0].illustrateur = '5ban Graphics'; e.carte.impressions[0].illustrateurPreuve = 'TCGdex SM10-089';
        const r = M.jugerImpression(D_ER, e); assert.strictEqual(r.statut, 'prete', JSON.stringify(r));
        assert.ok(/illustrateur lu au numéro faux, retiré avec l'impression/.test(r.raison));
        assert.strictEqual(r.perd.illustrateur, '5ban Graphics'); assert.strictEqual(r.preuve.illustrateurRetire, '5ban Graphics');
    });
    await t('SORTIE — une IMAGE du set faux au numéro faux dépend de l\'impression', () => {
        const e = er(); e.carte.images.push({ set: 'Base-Expansion-Pack', numero: '059' });
        assert.strictEqual(M.jugerImpression(D_ER, e).statut, 'sortie');
        const e2 = er(); e2.images = [{ set: 'Base-Expansion-Pack', numero: '59', carteId: 29833 }];
        assert.strictEqual(M.jugerImpression(D_ER, e2).statut, 'sortie');
    });
    await t('SORTIE — une LIGNE de jointure au numéro faux dépend de l\'impression', () => {
        const e = er(); e.lignes = [{ _id: '29833|650641', idProduct: 650641 }];
        assert.strictEqual(M.jugerImpression(D_ER, e).statut, 'sortie');
    });
    const D_DR = M.IMPRESSIONS.find(d => d.carteId === 71404);
    const dr = () => ({
        carte: { _id: 71404, nomEn: 'Drifblim FB', images: [{ set: 'Beat-of-the-Frontier', numero: '050' }], impressions: [{ tirage: 'jp', expansion: 'Beat of the Frontier', numero: '038', total: '100', rarete: 'Rare Holo', illustrateur: null }, { tirage: 'jp', expansion: 'Beat of the Frontier', numero: '050', source: 'setlist' }] },
        cartesFaux: new Map([[71322, { _id: 71322, nomEn: 'Electivire FB', impressions: [{ tirage: 'jp', expansion: 'Beat of the Frontier', numero: '038' }] }]]),
        titres: ['Electivire FB (Beat of the Frontier 38)'], pages: [pg('Electivire FB (Beat of the Frontier 38)', 71322)],
        produits: [prod(677582, 'Electivire [FB] Lv.50 [Dump and Draw | Electric Current]', '038')], images: [], lignes: [{ _id: '71404|677582', idProduct: 677582 }]
    });
    await t('Drifblim FB : la ligne fausse 71404|677582 retient l\'impression 038 (sortie), SAUF si ce même lot la détache — et alors l\'impression en dépend', () => {
        assert.strictEqual(M.jugerImpression(D_DR, dr()).statut, 'sortie');
        const e = dr(); e.lignesRetirees = new Set(['71404|677582']);
        const r = M.jugerImpression(D_DR, e); assert.strictEqual(r.statut, 'prete', JSON.stringify(r)); assert.deepStrictEqual(r.dependDe, ['ligne:71404|677582']);
    });
    await t('une impression qui dépend de la détache d\'une ligne ne s\'écrit pas sans elle (trancher)', () => {
        const plan = [{ id: 'ligne:A', statut: 'prete' }, { id: 'imp:X', statut: 'prete', dependDe: ['ligne:A'] }];
        assert.ok(M.trancher({ plan, liste: new Set(['imp:X']), attendu: 1 }).motif);
        assert.strictEqual(M.trancher({ plan, liste: new Set(['imp:X', 'ligne:A']), attendu: 2 }).motif, null);
    });
    await t('DÉJÀ FAIT : la carte ne porte plus l\'impression → rien', () => {
        const e = er(); e.carte.impressions = [clone(VRAI_ER)];
        assert.strictEqual(M.jugerImpression(D_ER, e).statut, 'deja-fait');
    });
    await t('REFUS : une impression posée par un outil (source) n\'est pas celle que la décision vise', () => {
        const e = er(); e.carte.impressions[0].source = 'numero-cardmarket';
        assert.strictEqual(M.jugerImpression(D_ER, e).statut, 'refus');
    });
    await t('Primal Kyogre-EX : le faux est « Gaia Volcano 073 », la Setlist de GAIA VOLCANO le range à Primal Groudon-EX ; le vrai est « Tidal Storm 073 »', () => {
        const r = M.jugerImpression(D_KY, ky());
        assert.strictEqual(r.statut, 'prete', JSON.stringify(r));
        assert.strictEqual(r.avant.index, 1);
        assert.strictEqual(r.avant.impression.expansion, 'Gaia Volcano');
    });
    await t('Primal Kyogre-EX : l\'image Tidal Storm 073 ne dépend PAS de l\'impression Gaia Volcano (autre set)', () => {
        assert.strictEqual(M.jugerImpression(D_KY, ky()).statut, 'prete');
    });

    console.log('jugerLigne');
    const LG = M.LIGNES[0];
    const lg = () => ({
        ligne: { _id: '71404|677582', carteId: 71404, idProduct: 677582, preuve: 'set+numero', idExpansion: 4286 },
        produit: { idProduct: 677582, name: 'Electivire [FB] Lv.50 [Dump and Draw | Electric Current]', numero: '038' },
        carte: { _id: 71404, nomEn: 'Drifblim FB', liens: { idProduct: [677582, 677601] } },
        cartesDuSet: [{ _id: 71404, nomEn: 'Drifblim FB', impressions: [{ tirage: 'jp', expansion: 'Beat of the Frontier', numero: '038' }] }, { _id: 71322, nomEn: 'Electivire FB', impressions: [{ tirage: 'jp', expansion: 'Beat of the Frontier', numero: '038' }] }],
        lignesDuProduit: [{ carteId: 71322 }, { carteId: 71404 }], expansions: ['Beat of the Frontier'], tirage: 'jp'
    });
    await t('PRÊTE : « Electivire [FB] » n\'est pas « Drifblim FB », la carte 71322 « Electivire FB » porte le n°038 et a déjà la bonne ligne', () => {
        const r = M.jugerLigne(LG, lg()); assert.strictEqual(r.statut, 'prete', JSON.stringify(r)); assert.strictEqual(r.preuve.autreCarte, 71322); assert.strictEqual(r.avant.liensAvaient, true);
    });
    await t('PRÉMISSE REJOUÉE — le nom du produit concorde avec la carte → refus (la ligne n\'est pas contredite)', () => {
        const e = lg(); e.carte.nomEn = 'Electivire FB'; assert.strictEqual(M.jugerLigne(LG, e).statut, 'refus');
    });
    await t('PRÉMISSE REJOUÉE — aucune autre carte du set ne porte ce nom → refus', () => {
        const e = lg(); e.cartesDuSet = e.cartesDuSet.filter(c => c._id !== 71322); assert.strictEqual(M.jugerLigne(LG, e).statut, 'refus');
    });
    await t('la bonne ligne manque : détacher laisserait le produit sans fiche → refus', () => {
        const e = lg(); e.lignesDuProduit = [{ carteId: 71404 }]; assert.strictEqual(M.jugerLigne(LG, e).statut, 'refus');
    });
    await t('l\'autre carte ne porte pas le numéro du produit → refus', () => {
        const e = lg(); e.cartesDuSet[1].impressions = []; assert.strictEqual(M.jugerLigne(LG, e).statut, 'refus');
    });
    await t('ligne déjà absente → déjà fait', () => { const e = lg(); e.ligne = null; assert.strictEqual(M.jugerLigne(LG, e).statut, 'deja-fait'); });

    console.log('jugerTotal');
    const D_T = M.TOTAUX[0];
    const tot = () => ({
        setDoc: { _id: 'Wind-from-the-Sea', totalImprime: 92 },
        docsImages: new Map(D_T.scans.map(s => [s.cle, { set: 'Wind-from-the-Sea', carteId: s.carteId, numero: s.numero, total: '087', urlOriginal: 'https://cdn.artofpkm.com/x', langue: 'ja' }])),
        totauxImpressions: { '087': 89, '87': 1 }, fichiers: new Set(D_T.scans.map(s => s.fichier))
    });
    await t('PRÊTE : trois scans de trois cartes lus « /087 », sourcés, recoupés par 100 % des impressions', () => {
        const r = M.jugerTotal(D_T, tot()); assert.strictEqual(r.statut, 'prete', JSON.stringify(r)); assert.strictEqual(r.apres.totalImprime, 87); assert.strictEqual(r.avant.totalImprime, 92); assert.strictEqual(r.preuve.scans.length, 3);
    });
    await t('ATTEND : un seul scan (une seule carte) ne recoupe rien', () => {
        const d = { ...D_T, scans: [D_T.scans[0]] }; assert.strictEqual(M.jugerTotal(d, tot()).statut, 'attend');
        const d2 = { ...D_T, scans: [D_T.scans[0], { ...D_T.scans[0], cle: 'artofpkm/57/13' }] }; assert.strictEqual(M.jugerTotal(d2, tot()).statut, 'attend');
    });
    await t('REFUS : une lecture dont le dénominateur n\'est pas la valeur retenue', () => {
        const d = { ...D_T, scans: [{ ...D_T.scans[0], lu: '012/092' }, D_T.scans[1]] }; assert.strictEqual(M.jugerTotal(d, tot()).statut, 'refus');
    });
    await t('REFUS : le document images ne désigne pas la carte lue', () => {
        const e = tot(); e.docsImages.get('artofpkm/57/12').carteId = 1; assert.strictEqual(M.jugerTotal(D_T, e).statut, 'refus');
    });
    await t('REFUS : la source d\'origine (urlOriginal) n\'est pas écrite', () => {
        const e = tot(); delete e.docsImages.get('artofpkm/57/12').urlOriginal; assert.strictEqual(M.jugerTotal(D_T, e).statut, 'refus');
    });
    await t('REFUS : le fichier local n\'existe plus', () => {
        const e = tot(); e.fichiers = new Set(); assert.strictEqual(M.jugerTotal(D_T, e).statut, 'refus');
    });
    await t('REFUS : la base n\'est plus à 92 (elle a bougé)', () => {
        const e = tot(); e.setDoc.totalImprime = 90; assert.strictEqual(M.jugerTotal(D_T, e).statut, 'refus');
    });
    await t('REFUS : la valeur lue n\'est pas recoupée par les impressions du set (< 90 %)', () => {
        const e = tot(); e.totauxImpressions = { '087': 40, '092': 50 }; assert.strictEqual(M.jugerTotal(D_T, e).statut, 'refus');
    });
    await t('DÉJÀ FAIT : le total vaut déjà 87', () => { const e = tot(); e.setDoc.totalImprime = 87; assert.strictEqual(M.jugerTotal(D_T, e).statut, 'deja-fait'); });
    await t('la valeur retenue de la décision est LUE (87), pas déduite : elle n\'est ni le nombre de produits (90) ni celui de la Setlist (90)', () => {
        assert.strictEqual(D_T.lu, 87); assert.notStrictEqual(D_T.lu, 90); assert.ok(D_T.scans.every(s => /\/087$/.test(s.lu)));
    });

    console.log('trancher / liste');
    const planTest = [{ id: 'a', statut: 'prete' }, { id: 'b', statut: 'attend' }, { id: 'c', statut: 'prete', hypothese: true }];
    await t('--attendu : le nombre de modifications prêtes retenues doit être exact', () => {
        assert.strictEqual(M.trancher({ plan: planTest, liste: new Set(['a']), attendu: 1 }).motif, null);
        assert.ok(M.trancher({ plan: planTest, liste: new Set(['a']), attendu: 2 }).motif);
        assert.ok(M.trancher({ plan: planTest, liste: new Set(['a']), attendu: NaN }).motif);
    });
    await t('un identifiant de la liste qui n\'est pas « prête » (attend, hypothèse, inconnu) ARRÊTE tout', () => {
        for (const id of ['b', 'c', 'z']) assert.ok(M.trancher({ plan: planTest, liste: new Set(['a', id]), attendu: 2 }).motif, id);
    });
    await t('une liste vide ou mal formée est refusée', () => {
        assert.throws(() => M.lireListe('[]')); assert.throws(() => M.lireListe('pas du json')); assert.throws(() => M.lireListe('[1]')); assert.throws(() => M.lireListe('["a","a"]'));
        assert.deepStrictEqual([...M.lireListe('["a","b"]')], ['a', 'b']);
    });

    console.log('écriture (fausse base) + retour arrière');
    const base = () => ({
        cartes: [
            { _id: 29833, nomEn: 'Energy Restore', impressions: [clone(FAUX_ER), clone(VRAI_ER)], liens: { idProduct: [1] } },
            { _id: 71404, nomEn: 'Drifblim FB', impressions: [], liens: { idProduct: [677582, 677601] } }
        ],
        cartes_produits: [{ _id: '71404|677582', carteId: 71404, idProduct: 677582, preuve: 'set+numero' }, { _id: '71322|677582', carteId: 71322, idProduct: 677582, preuve: 'set+numero' }],
        sets: [{ _id: 'Wind-from-the-Sea', totalImprime: 92 }]
    });
    const planE = () => [
        { id: M.idLigne(LG), type: 'ligne', statut: 'prete', carteId: 71404, avant: { ligne: base().cartes_produits[0], liensAvaient: true, liensIndex: 0, liensAvant: [677582, 677601] } },
        { id: M.idImp(D_ER), type: 'impression', statut: 'prete', carteId: 29833, avant: { index: 0, impression: clone(FAUX_ER) } },
        { id: M.idTotal(D_T), type: 'total', statut: 'prete', avant: { totalImprime: 92 }, apres: { totalImprime: 87 } },
        { id: 'imp:autre', type: 'impression', statut: 'attend', carteId: 5, avant: null }
    ];
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f3m-'));
    const tous = new Set(planE().filter(p => p.statut === 'prete').map(p => p.id));
    await t('ÉCRIT : ligne supprimée, lien retiré, impression retirée, total corrigé — et la bonne impression, l\'autre ligne, rien d\'autre ne bouge', async () => {
        const f = path.join(tmp, 'retour1.json'); const db = fauxDb(base());
        const R = await M.ecrire({ db, plan: planE(), retenus: tous, fichierRetour: f, log: () => { } });
        assert.deepStrictEqual([R.lignes, R.impressions, R.totaux], [1, 1, 1]);
        assert.strictEqual(db.cols.cartes_produits.length, 1); assert.strictEqual(db.cols.cartes_produits[0]._id, '71322|677582');
        assert.deepStrictEqual(db.cols.cartes.find(c => c._id === 71404).liens.idProduct, [677601]);
        assert.deepStrictEqual(db.cols.cartes.find(c => c._id === 29833).impressions.map(i => i.numero), ['050']);
        assert.strictEqual(db.cols.sets[0].totalImprime, 87);
    });
    await t('LE RETOUR EST ÉCRIT AVANT LA PREMIÈRE ÉCRITURE (la fausse base le vérifie à chaque opération) et porte l\'ancienne valeur exacte', async () => {
        const f = path.join(tmp, 'retour2.json'); let vus = 0;
        const db = fauxDb(base(), () => { vus++; assert.ok(fs.existsSync(f), 'le fichier de retour n\'existe pas encore'); });
        await M.ecrire({ db, plan: planE(), retenus: tous, fichierRetour: f, log: () => { } });
        assert.ok(vus >= 4);
        const r = JSON.parse(fs.readFileSync(f, 'utf8'));
        assert.strictEqual(r.modifications.length, 3);
        const imp = r.modifications.find(m => m.type === 'impression'); assert.deepStrictEqual(imp.valeur, FAUX_ER); assert.strictEqual(imp.index, 0); assert.strictEqual(imp._id, 29833);
        const lig = r.modifications.find(m => m.type === 'ligne'); assert.strictEqual(lig.document._id, '71404|677582'); assert.strictEqual(lig.liensAvaient, true);
        const tt = r.modifications.find(m => m.type === 'total'); assert.deepStrictEqual([tt.avant, tt.apres, tt.champ, tt._id], [92, 87, 'totalImprime', 'Wind-from-the-Sea']);
    });
    await t('si le fichier de retour ne peut pas s\'écrire, RIEN ne s\'écrit', async () => {
        const f = path.join(tmp, 'retour3.json'); fs.writeFileSync(f, 'déjà là');
        const db = fauxDb(base());
        await assert.rejects(M.ecrire({ db, plan: planE(), retenus: tous, fichierRetour: f, log: () => { } }));
        assert.strictEqual(db.journal.length, 0); assert.strictEqual(fs.readFileSync(f, 'utf8'), 'déjà là');
    });
    await t('hors liste : rien d\'écrit', async () => {
        const f = path.join(tmp, 'retour4.json'); const db = fauxDb(base());
        const R = await M.ecrire({ db, plan: planE(), retenus: new Set(['nimporte']), fichierRetour: f, log: () => { } });
        assert.strictEqual(db.journal.length, 0); assert.deepStrictEqual([R.lignes, R.impressions, R.totaux], [0, 0, 0]);
    });
    await t('une modification « attend » n\'est jamais écrite, même dans la liste', async () => {
        const f = path.join(tmp, 'retour5.json'); const db = fauxDb(base());
        await M.ecrire({ db, plan: planE(), retenus: new Set([...tous, 'imp:autre']), fichierRetour: f, log: () => { } });
        assert.strictEqual(JSON.parse(fs.readFileSync(f, 'utf8')).modifications.length, 3);
    });
    await t('REVENIR : la base revient exactement à l\'état d\'avant (ligne, lien, impression à sa place, total) — et le rejeu est idempotent', async () => {
        const f = path.join(tmp, 'retour6.json'); const db = fauxDb(base());
        await M.ecrire({ db, plan: planE(), retenus: tous, fichierRetour: f, log: () => { } });
        const retour = JSON.parse(fs.readFileSync(f, 'utf8'));
        const R = await M.revenir({ db, retour, log: () => { } });
        assert.strictEqual(R.remises, 3);
        const att = base();
        const norm = c => c.slice().sort((a, b) => String(a._id).localeCompare(String(b._id)));
        assert.deepStrictEqual(norm(db.cols.cartes), norm(att.cartes));   // SANS trier : l'ordre de liens.idProduct et des impressions doit être celui d'origine
        assert.deepStrictEqual(db.cols.cartes.find(c => c._id === 71404).liens.idProduct, [677582, 677601]);
        assert.deepStrictEqual(norm(db.cols.cartes_produits), norm(att.cartes_produits));
        assert.deepStrictEqual(db.cols.sets, att.sets);
        assert.deepStrictEqual(db.cols.cartes.find(c => c._id === 29833).impressions.map(i => i.numero), ['059', '050']);
        const R2 = await M.revenir({ db, retour, log: () => { } });
        assert.strictEqual(R2.remises, 0); assert.strictEqual(R2.deja, 3);
        assert.deepStrictEqual(db.cols.cartes.find(c => c._id === 29833).impressions.map(i => i.numero), ['059', '050']);
    });
    await t('REVENIR ne remet pas un total que la base a déjà changé depuis (il ne piétine pas une autre valeur)', async () => {
        const f = path.join(tmp, 'retour7.json'); const db = fauxDb(base());
        await M.ecrire({ db, plan: planE(), retenus: tous, fichierRetour: f, log: () => { } });
        db.cols.sets[0].totalImprime = 99;
        await M.revenir({ db, retour: JSON.parse(fs.readFileSync(f, 'utf8')), log: () => { } });
        assert.strictEqual(db.cols.sets[0].totalImprime, 99);
    });
    await t('LE FILTRE DU RETRAIT (tirage, expansion, numéro) : une impression au même numéro et à la même expansion d\'un AUTRE tirage survit', async () => {
        const b = base(); b.cartes[0].impressions.push({ tirage: 'intl', expansion: 'Base Expansion Pack', numero: '059', total: '102' });
        const db = fauxDb(b);
        await M.ecrire({ db, plan: planE(), retenus: tous, fichierRetour: path.join(tmp, 'retour8.json'), log: () => { } });
        assert.deepStrictEqual(db.cols.cartes.find(c => c._id === 29833).impressions.map(i => `${i.tirage}:${i.numero}`), ['jp:050', 'intl:059']);
    });
    await t('PLUSIEURS impressions identiques (même tirage, expansion, numéro) : refus, jamais deux retirées d\'un coup', () => {
        const e = er(); e.carte.impressions.push(clone(FAUX_ER));
        const r = M.jugerImpression(D_ER, e); assert.strictEqual(r.statut, 'refus', JSON.stringify(r)); assert.ok(/impressions identiques/.test(r.raison));
    });
    await t('CHEMIN --ecrire RÉEL : ouvrirConnexions rend { cartes, prod, fermer } (la base native est cx.cartes.db, PAS cx.db) ; la connexion est fermée', async () => {
        const f = path.join(tmp, 'retour9.json'); const db = fauxDb(base()); let ferme = 0;
        const cx = { cartes: { db }, prod: null, fermer: async () => { ferme++; } };
        const R = await M.lancerEcriture({ ouvrir: async () => cx, plan: planE(), liste: tous, attendu: 3, fichierRetour: f, log: () => { }, err: () => { } });
        assert.strictEqual(R.relu, 3); assert.strictEqual(R.attendu, 3); assert.strictEqual(ferme, 1);
        assert.strictEqual(db.cols.sets[0].totalImprime, 87); assert.strictEqual(db.cols.cartes_produits.length, 1);
    });
    await t('CHEMIN --ecrire RÉEL : un --attendu faux ou une liste non « prête » n\'ouvre même pas la connexion', async () => {
        let ouvertures = 0; const ouvrir = async () => { ouvertures++; return { cartes: { db: fauxDb(base()) }, prod: null, fermer: async () => { } }; };
        await assert.rejects(M.lancerEcriture({ ouvrir, plan: planE(), liste: tous, attendu: 2, fichierRetour: path.join(tmp, 'retour10.json'), log: () => { }, err: () => { } }));
        await assert.rejects(M.lancerEcriture({ ouvrir, plan: planE(), liste: new Set([...tous, 'imp:autre']), attendu: 4, fichierRetour: path.join(tmp, 'retour11.json'), log: () => { }, err: () => { } }));
        assert.strictEqual(ouvertures, 0);
    });
    await t('CHEMIN --revenir RÉEL : même forme de connexion, base remise, connexion fermée', async () => {
        const f = path.join(tmp, 'retour12.json'); const db = fauxDb(base());
        await M.ecrire({ db, plan: planE(), retenus: tous, fichierRetour: f, log: () => { } });
        let ferme = 0; const cx = { cartes: { db }, prod: null, fermer: async () => { ferme++; } };
        const R = await M.lancerRetour({ ouvrir: async () => cx, retour: JSON.parse(fs.readFileSync(f, 'utf8')), log: () => { } });
        assert.strictEqual(R.remises, 3); assert.strictEqual(ferme, 1); assert.strictEqual(db.cols.sets[0].totalImprime, 92);
    });
    await t('la décision : 1 ligne, 10 impressions, 1 total ; aucun doublon', () => {
        assert.strictEqual(M.LIGNES.length, 1); assert.strictEqual(M.IMPRESSIONS.length, 10); assert.strictEqual(M.TOTAUX.length, 1);
        assert.strictEqual(new Set(M.IMPRESSIONS.map(M.idImp)).size, 10);
    });

    console.log(`\n${ok} ok, ${ko} KO`);
    process.exit(ko ? 1 : 0);
})();
