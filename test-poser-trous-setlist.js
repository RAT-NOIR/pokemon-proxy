'use strict';
// Banc de poser-trous-setlist.js — fonctions PURES (aucune base). Les fixtures reprennent les formes RÉELLES lues en base le 2026-11-01
// (Double Blaze 089/090, HeartGold & SoulSilver 121 : Énergie jointe par le nom, sans impression).
const assert = require('assert');
const { planifier, entreesDeTitres, ecrire, chargerClone } = require('./poser-trous-setlist');

let ok = 0, ko = 0;
const t = (nom, f) => { try { f(); ok++; console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  KO  ' + nom + '\n      ' + String(e.message).split('\n').join('\n      ')); } };

const cible = { idExpansion: 3836, expansionBulba: 'Double Blaze', tirage: 'jp', slugSet: 'Double-Blaze' };
const imp = (numero, expansion = 'Double Blaze', tirage = 'jp') => ({ tirage, expansion, numero, total: '095', deck: null, rarete: null });
const carte = (id, nomEn, impressions) => ({ _id: id, nomEn, attaques: [], impressions });
const produit = (idProduct, name, nom, numero) => ({ idProduct, idExpansion: 3836, idMetacard: idProduct, name, nom, attaques: [], numero, slug: nom.replace(/ /g, '-'), slugSet: 'Double-Blaze', variante: null });
const page = (titre, pageid) => ({ titre, pageid, revid: 1, etat: 'ok' });
const artofpkm = (carteId, numero, nomEn) => ({ source: 'artofpkm', etat: 'ok', set: 'Double-Blaze', carteId, numero, nomEn, _id: `artofpkm/378/${Number(numero)}` });

// Le monde réel : Bulbapedia imprime 089 sur Dust Island ET sur Martial Arts Dojo ; la Setlist (et Cardmarket) range Dust Island au 90.
const base = () => ({
    slugSet: 'Double-Blaze', cible,
    cartes: [carte(235852, 'Martial Arts Dojo', [imp('089')]), carte(235857, 'Dust Island', [imp('089')]), carte(235858, 'Triple Acceleration Energy', [imp('091')])],
    produits: [produit(557447, 'Martial Arts Dojo', 'Martial Arts Dojo', '089'), produit(557448, 'Dust Island', 'Dust Island', '090'), produit(557449, 'Triple Acceleration Energy', 'Triple Acceleration Energy', '091')],
    titres: ['Martial Arts Dojo (Double Blaze 89)', 'Dust Island (Double Blaze 90)', 'Triple Acceleration Energy (Double Blaze 91)', 'Dust Island (Unbroken Bonds 168)'],
    pages: [page('Martial Arts Dojo (Double Blaze 89)', 235852), page('Dust Island (Double Blaze 90)', 235857), page('Triple Acceleration Energy (Double Blaze 91)', 235858), page('Dust Island (Unbroken Bonds 168)', 235857)],
    images: [artofpkm(235857, '090', 'Dust Island')],
    existantes: new Map([[557447, [235852]], [557449, [235858]]]),
    cibles: [557448], relevesTcgdex: new Map()
});
const un = (e, id) => planifier(e).find(r => r.idProduct === id);

console.log('entreesDeTitres');
t('lit « Nom (Set N) » et garde le jeton du set', () => {
    const e = entreesDeTitres(['Dust Island (Double Blaze 90)', 'Mew ☆ δ (EX Holon Phantoms 103)']);
    assert.deepStrictEqual(e.map(x => [x.a, x.b]), [['Double Blaze', '90'], ['EX Holon Phantoms', '103']]);
});

console.log('planifier');
t('JOIGNABLE : Setlist 90 + Cardmarket 090 + artofpkm 090, témoin du nom muet', () => {
    const r = un(base(), 557448);
    assert.strictEqual(r.statut, 'joignable', JSON.stringify(r));
    assert.strictEqual(r.carteId, 235857);
    assert.strictEqual(r.ligne.idProduct, 557448);
    assert.strictEqual(r.ligne.carteId, 235857);
    assert.strictEqual(r.impression.numero, '090');
    assert.strictEqual(r.impression.source, 'setlist');
    assert.ok(r.sources.includes('artofpkm'));
});
t('UNE SEULE SOURCE : sans relevé indépendant, rien ne se pose (Bulbapedia ne compte pas)', () => {
    const e = base(); e.images = [];
    assert.strictEqual(un(e, 557448).statut, 'une-seule-source');
});
t('un relevé « bulbapedia » ne vaut pas seconde source', () => {
    const e = base(); e.images = [{ ...artofpkm(235857, '090', 'Dust Island'), source: 'bulbapedia' }];
    assert.strictEqual(un(e, 557448).statut, 'une-seule-source');
});
t('un relevé artofpkm à un AUTRE numéro ne confirme pas', () => {
    const e = base(); e.images = [artofpkm(235857, '089', 'Dust Island')];
    assert.strictEqual(un(e, 557448).statut, 'une-seule-source');
});
t('un relevé artofpkm sur une AUTRE carte ne confirme pas', () => {
    const e = base(); e.images = [artofpkm(235852, '090', 'Dust Island')];
    assert.strictEqual(un(e, 557448).statut, 'une-seule-source');
});
t('TÉMOIN DU NOM : la Setlist range la mauvaise carte au 90 → rien (le nom contredit le numéro)', () => {
    const e = base();
    e.titres = ['Martial Arts Dojo (Double Blaze 89)', 'Martial Arts Dojo (Double Blaze 90)', 'Triple Acceleration Energy (Double Blaze 91)'];
    e.pages = [page('Martial Arts Dojo (Double Blaze 89)', 235852), page('Martial Arts Dojo (Double Blaze 90)', 235852), page('Triple Acceleration Energy (Double Blaze 91)', 235858)];
    e.images = [artofpkm(235852, '090', 'Dust Island')];
    const r = un(e, 557448);
    assert.notStrictEqual(r.statut, 'joignable', JSON.stringify(r));
    assert.ok(!r.ligne);
});
t('SETLIST AMBIGUË : deux cartes au même numéro → rien', () => {
    const e = base();
    e.titres.push('Martial Arts Dojo (Double Blaze 90)'); e.pages.push(page('Martial Arts Dojo (Double Blaze 90)', 235852));
    assert.strictEqual(un(e, 557448).statut, 'setlist-ambigu');
});
t('SANS TITRE : le numéro du produit n\'est pas dans la Setlist → rien', () => {
    const e = base(); e.titres = e.titres.filter(x => !/ 90\)/.test(x)); e.pages = e.pages.filter(p => !/ 90\)/.test(p.titre));
    assert.strictEqual(un(e, 557448).statut, 'sans-titre-setlist');
});
t('une entrée d\'un AUTRE set (réimpression listée) ne donne pas son numéro', () => {
    const e = base(); e.titres = ['Martial Arts Dojo (Double Blaze 89)', 'Triple Acceleration Energy (Double Blaze 91)', 'Dust Island (Unbroken Bonds 90)'];
    e.pages = [page('Martial Arts Dojo (Double Blaze 89)', 235852), page('Triple Acceleration Energy (Double Blaze 91)', 235858), page('Dust Island (Unbroken Bonds 90)', 235857)];
    assert.strictEqual(un(e, 557448).statut, 'sans-titre-setlist');
});
t('DÉJÀ JOINT : le produit a une ligne, et la carte porte son numéro → rien à faire', () => {
    const e = base(); e.cibles = [557447];
    assert.strictEqual(un(e, 557447).statut, 'deja-joint');
});
t('PRODUIT ABSENT du catalogue → nommé', () => {
    const e = base(); e.cibles = [999];
    assert.strictEqual(un(e, 999).statut, 'produit-absent');
});
t('IMPRESSION SEULE (Énergie jointe par le nom, sans impression) : seule l\'impression se pose, avec un relevé TCGdex', () => {
    const e = base();
    e.cible = { idExpansion: 1566, expansionBulba: 'HeartGold & SoulSilver', tirage: 'intl', slugSet: 'HeartGold-SoulSilver' };
    e.slugSet = 'HeartGold-SoulSilver';
    e.cartes = [carte(23485, 'Darkness Energy', [])];
    e.produits = [{ idProduct: 279093, idExpansion: 1566, idMetacard: 1, name: 'Darkness Energy', nom: 'Darkness Energy', attaques: [], numero: '121', slug: 'Darkness-Energy-HS121', slugSet: 'HeartGold-SoulSilver', variante: null }];
    e.titres = ['Darkness Energy (HeartGold & SoulSilver 121)']; e.pages = [page('Darkness Energy (HeartGold & SoulSilver 121)', 23485)];
    e.images = []; e.existantes = new Map([[279093, [23485]]]); e.cibles = [279093];
    e.relevesTcgdex = new Map([[279093, [{ source: 'tcgdex', set: 'HeartGold-SoulSilver', numero: '121', nom: 'Darkness Energy', ref: 'data/hgss1/121' }]]]);
    const r = un(e, 279093);
    assert.strictEqual(r.statut, 'impression-seule', JSON.stringify(r));
    assert.strictEqual(r.impression.numero, '121');
    assert.ok(!r.ligne);
    e.relevesTcgdex = new Map();
    assert.strictEqual(un(e, 279093).statut, 'une-seule-source');
});
t('SUFFIXE [FB] : « Drifblim [FB] Lv.50 » est la carte « Drifblim FB » — l\'image artofpkm la nomme « Drifblim FB »', () => {
    const e = base();
    e.cartes = [carte(71404, 'Drifblim FB', [imp('038')])];
    e.produits = [{ ...produit(677601, 'Drifblim [FB] Lv.50 [Pump Up | Shadow Ball]', 'Drifblim', '050'), attaques: ['Pump Up', 'Shadow Ball'] }];
    e.titres = ['Drifblim FB (Double Blaze 50)']; e.pages = [page('Drifblim FB (Double Blaze 50)', 71404)];
    e.images = [artofpkm(71404, '050', 'Drifblim FB')]; e.existantes = new Map([[677601, [71404]]]); e.cibles = [677601];
    assert.strictEqual(un(e, 677601).statut, 'impression-seule');
    e.cartes = [carte(71404, 'Drifblim FBX', [imp('038')])];
    assert.notStrictEqual(un(e, 677601).statut, 'impression-seule', 'un nom qui ne vaut pas « <nom> <groupe> » ne passe pas');
});
t('DÉRIVE : l\'impression ne doit poser AUCUNE ligne non demandée (un autre produit au même numéro)', () => {
    const e = base();
    e.produits.push(produit(557450, 'Dust Island', 'Dust Island', '090'));
    assert.strictEqual(un(e, 557448).statut, 'derive');
    e.cibles = [557448, 557450];
    assert.strictEqual(un(e, 557448).statut, 'joignable');
    assert.strictEqual(un(e, 557450).statut, 'joignable');
});
t('un set dont la carte porte DÉJÀ le numéro (anomalie) n\'est pas réécrit', () => {
    const e = base(); e.cartes[1] = carte(235857, 'Dust Island', [imp('089'), imp('090')]);
    assert.notStrictEqual(un(e, 557448).statut, 'joignable');
});

console.log('chargerClone (LÈVE : un clone absent ferait régénérer une liste plus courte)');
t('--clone absent → lève', () => assert.throws(() => chargerClone(undefined, () => ({})), /--clone/));
t('--clone illisible → lève', () => assert.throws(() => chargerClone('x.js', () => { throw new Error('introuvable'); }), /illisible/));
t('--clone sans lireClone → lève', () => assert.throws(() => chargerClone('x.js', () => ({})), /lireClone/));
t('--clone vide (0 carte) → lève', () => assert.throws(() => chargerClone('x.js', () => ({ lireClone: () => ({ cartes: [], sets: [] }) })), /vide/));
t('--clone lisible → rendu', () => assert.strictEqual(chargerClone('x.js', () => ({ lireClone: () => ({ cartes: [{}], sets: [] }) })).cartes.length, 1));

console.log('ecrire (fausse base, additif)');
const fauxDb = () => {
    const cols = { cartes: [], cartes_produits: [] }; const journal = [];
    const doc = (c, f) => cols[c].find(f);
    return {
        journal, cols,
        collection: nom => ({
            updateOne: async (filtre, maj, o = {}) => { journal.push([nom, filtre, maj, o]); return { modifiedCount: 1, upsertedCount: o.upsert ? 1 : 0 }; },
            find: () => ({ toArray: async () => [] })
        })
    };
};
(async () => {
    const e = base();
    const plan = planifier(e);
    const db = fauxDb();
    const R = await ecrire({ db, plan, retenus: new Set([557448]), log: () => { }, err: () => { } });
    const ops = db.journal.map(j => JSON.stringify(j[2]));
    const interdit = ops.filter(o => /\$unset|\$pull|\$delete|\$rename/.test(o));
    try {
        assert.strictEqual(interdit.length, 0, 'opérateurs destructifs : ' + interdit.join(' ; '));
        assert.ok(db.journal.some(j => j[0] === 'cartes_produits' && j[3].upsert), 'la ligne est posée par upsert');
        const lig = db.journal.find(j => j[0] === 'cartes_produits');
        assert.deepStrictEqual(Object.keys(lig[2]), ['$setOnInsert'], 'la ligne est posée par $setOnInsert SEUL (strictement additif, jamais $set)');
        const imp = db.journal.find(j => j[0] === 'cartes' && j[2].$push);
        assert.ok(imp[1].impressions && imp[1].impressions.$not && imp[1].impressions.$not.$elemMatch, 'le filtre $not/$elemMatch protège l\'impression');
        assert.deepStrictEqual(Object.keys(imp[1].impressions.$not.$elemMatch).sort(), ['expansion', 'numero', 'tirage'], 'le filtre porte tirage, expansion, numero');
        assert.ok(db.journal.some(j => j[0] === 'cartes' && j[2].$push), 'l\'impression est poussée');
        assert.strictEqual(R.lignes, 1);
        ok++; console.log('  ok  écriture additive (opérateurs relevés)');
    } catch (err) { ko++; console.log('  KO  écriture additive\n      ' + err.message); }
    // un produit hors de la liste n'est pas écrit
    const db2 = fauxDb();
    const R2 = await ecrire({ db: db2, plan, retenus: new Set([1]), log: () => { }, err: () => { } });
    try { assert.strictEqual(db2.journal.length, 0); assert.strictEqual(R2.lignes, 0); ok++; console.log('  ok  hors liste : rien d\'écrit'); } catch (err) { ko++; console.log('  KO  hors liste\n      ' + err.message); }
    await bancPrincipal();
    console.log(`\n${ok} ok, ${ko} KO`);
    process.exit(ko ? 1 : 0);
})();

// ───── le CHEMIN --ecrire de principal(), de bout en bout, sur une fausse base de la VRAIE forme (2026-11-01, tour 2 : `cx.db` n'existe pas, la base est `cx.cartes.db`)
async function bancPrincipal() {
    const fs = require('fs'), os = require('os'), path = require('path');
    const { principal } = require('./poser-trous-setlist');
    const correspond = (d, f) => Object.entries(f).every(([k, v]) => {
        if (k === 'impressions') return true;
        if (v && typeof v === 'object' && Array.isArray(v.$in)) return v.$in.includes(d[k]);
        if (Array.isArray(d[k])) return d[k].includes(v);
        return d[k] === v;
    });
    const faux = (s) => ({
        collection: nom => ({
            find: (f = {}) => ({ toArray: async () => (s[nom] || []).filter(d => correspond(d, f)) }),
            findOne: async (f = {}) => (s[nom] || []).find(d => correspond(d, f)) || null,
            updateOne: async (f, maj, o = {}) => {
                const col = s[nom] || (s[nom] = []);
                let d = col.find(x => x._id === f._id);
                const nm = f.impressions && f.impressions.$not && f.impressions.$not.$elemMatch;
                if (nm && d && (d.impressions || []).some(i => Object.entries(nm).every(([k, v]) => i[k] === v))) return { modifiedCount: 0 };
                if (!d) { if (!o.upsert) return { modifiedCount: 0 }; d = { _id: f._id, ...(maj.$setOnInsert || {}) }; col.push(d); return { modifiedCount: 0, upsertedCount: 1 }; }
                if (maj.$push && maj.$push.impressions) d.impressions = [...(d.impressions || []), maj.$push.impressions];
                if (maj.$addToSet) { d.liens = d.liens || {}; d.liens.idProduct = [...new Set([...(d.liens.idProduct || []), maj.$addToSet['liens.idProduct']])]; }
                return { modifiedCount: 1 };
            }
        })
    });
    const monde = () => {
        const b = base();
        const cartes = b.cartes.map(c => ({ ...c, sets: ['Double-Blaze'] }));
        const cartesStore = {
            cartes, collecte_etat: [{ _id: 'Double-Blaze', titres: b.titres, pages: b.pages }],
            images: b.images.map(i => ({ ...i })), cartes_produits: [{ _id: '235852|557447', carteId: 235852, idProduct: 557447, idExpansion: 3836 }, { _id: '235858|557449', carteId: 235858, idProduct: 557449, idExpansion: 3836 }]
        };
        const prodStore = {
            catalogue_produits: b.produits.map(p => ({ idProduct: p.idProduct, idExpansion: 3836, idMetacard: p.idMetacard, name: p.name })),
            numeros_cartes: b.produits.map(p => ({ idProduct: p.idProduct, numero: p.numero, slug: p.slug, slugSet: p.slugSet, variante: null }))
        };
        return { cartesStore, dbCartes: faux(cartesStore), dbProd: faux(prodStore) };
    };
    const liste = path.join(os.tmpdir(), `f3-banc-${process.pid}.json`);
    fs.writeFileSync(liste, JSON.stringify([557448]));
    const argv = ['--produits=557448', '--clone=x', `--seulement=${liste}`, '--attendu=1', '--ecrire'];
    const charger = () => ({ lireClone: () => ({ cartes: [{ cardmarket: [], noms: {}, famille: 'data', setId: 'x', localId: '1' }], sets: [] }) });
    const muet = async f => { const l = console.log; console.log = () => { }; try { return await f(); } finally { console.log = l; } };
    const lancer = async (m, formeConnexion) => {
        process.exitCode = 0;
        const ouvrirLecture = async () => ({ prod: m.dbProd, cartes: m.dbCartes, fermer: async () => { } });
        const ouvrirConnexions = async () => formeConnexion(m);
        let erreur = null;
        await muet(() => principal({ argv, ouvrirLecture, ouvrirConnexions, charger }).catch(x => { erreur = x; }));
        const code = process.exitCode; process.exitCode = 0;
        return { erreur, code };
    };
    const essai = async (nom, f) => { try { await f(); ok++; console.log('  ok  ' + nom); } catch (err) { ko++; console.log('  KO  ' + nom + '\n      ' + String(err.message).split('\n').join('\n      ')); } };
    console.log('principal --ecrire (fausse ouvrirConnexions de la vraie forme { cartes: { db }, prod, fermer })');
    await essai('--ecrire jusqu\'à ecrire() + relecture : impression, ligne, liens, code de sortie 0', async () => {
        const m = monde();
        const r = await lancer(m, mm => ({ cartes: { db: mm.dbCartes }, prod: null, fermer: async () => { } }));
        assert.strictEqual(r.erreur, null, 'principal a levé : ' + (r.erreur && r.erreur.message));
        assert.strictEqual(r.code, 0, 'la relecture ne retrouve pas tout');
        const c = m.cartesStore.cartes.find(x => x._id === 235857);
        assert.ok(c.impressions.some(i => i.source === 'setlist' && i.numero === '090'), 'impression « setlist » 090 écrite sur la carte');
        assert.ok(m.cartesStore.cartes_produits.some(l => l.idProduct === 557448 && l.carteId === 235857), 'ligne écrite');
        assert.deepStrictEqual(c.liens.idProduct, [557448]);
    });
    await essai('une connexion de la MAUVAISE forme ({ db }) est refusée sans rien écrire', async () => {
        const m = monde();
        const r = await lancer(m, mm => ({ db: mm.dbCartes, fermer: async () => { } }));
        assert.ok(r.erreur && /ouvrirConnexions/.test(r.erreur.message), 'doit lever en nommant ouvrirConnexions : ' + (r.erreur && r.erreur.message));
        assert.strictEqual(m.cartesStore.cartes_produits.length, 2);
    });
    fs.unlinkSync(liste);
}
