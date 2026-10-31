'use strict';
// LOT PERF-SCAN, P2 — les deux index du catalogue (code × numéro, familles) construits en LISant un curseur par lots, sans jamais tenir les 74 000 documents d'une collection à la fois (c'était le transitoire du pic de mémoire des
// premiers scans : `find({}).toArray()` sur numeros_cartes ET catalogue_produits). Le critère est l'IDENTITÉ : le même index que la construction d'avant, sur des catalogues tirés au sort (graine fixe) aux cas difficiles — doublons
// d'idProduct (le dernier gagne), noms vides, métacartes absentes, numéros numériques, accents et casse dans les noms, produits sans ligne de numéro.
const H = require('./_harnais'); const db = require('../db');
const LD = require('../identifier/langue-decisive'); const DES = require('../identifier/designation'); const { creerCatalogue } = require('../identifier/catalogue'); const { lireConfig } = require('../config');
const taire = async f => { const w = console.warn; console.warn = () => { }; try { return await f(); } finally { console.warn = w; } };
async function* flux(tableau, lot = 7) { for (let i = 0; i < tableau.length; i += lot) { await new Promise(r => setImmediate(r)); for (const d of tableau.slice(i, i + lot)) yield d; } }   // un curseur : par lots, jamais d'un bloc
function alea(graine) { let s = graine >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const MOTS = ['Pikachu', 'pikachu', 'PIKACHU', 'Pikachu ex', 'Pikachu  V', 'Raichu', 'Dragonite Lv.61', 'Milotic δ Delta Species', 'Flabébé', 'Flabebe', 'Mr. Mime', 'Eevee', 'Dark Raichu', 'Mew', 'Mewtwo'];

function catalogueAuHasard(graine, n, { plage = 0.9, suffixes = 0 } = {}) {
    const r = alea(graine), numeros = [], produits = [];
    const pick = a => a[Math.floor(r() * a.length)];
    for (let i = 0; i < n; i++) {
        const id = 100 + Math.floor(r() * n * plage);                                                // 10 % de doublons d'idProduct environ : le dernier gagne
        const nom = r() < 0.05 ? (r() < 0.5 ? '' : '   ') : `${pick(MOTS)}${r() < 0.5 ? ` [${pick(['Gnaw', 'Thunder Jolt', 'Hydro Pump'])} | ${pick(['Tackle', 'Slash'])}]` : ''}`;
        produits.push({ idProduct: id, idMetacard: r() < 0.15 ? null : Math.floor(r() * n * 0.3), name: r() < 0.03 ? null : (suffixes && nom.trim() ? `${nom} #${Math.floor(r() * suffixes)}` : nom) });
        if (r() < 0.9) numeros.push({ idProduct: r() < 0.97 ? id : id + 7, codeSet: r() < 0.1 ? null : pick(['SV1', 'sv2', ' M6A ', 'PRE', 'TG', '']), numero: r() < 0.1 ? null : r() < 0.3 ? Math.floor(r() * 300) : String(Math.floor(r() * 300)).padStart(3, '0'), numeroUrl: r() < 0.3 ? `TG${Math.floor(r() * 30)}` : null, setTcgdex: r() < 0.5 ? pick(['sv01', 'swsh12', null, '  ']) : null });
    }
    for (const d of [{ idProduct: 5, name: 'x' }, { name: 'sans id' }, null, { idProduct: 'texte', name: 'faux id' },
        { idProduct: 2 ** 40, name: 'Gros identifiant', idMetacard: -5 }, { idProduct: 2 ** 40 + 1, name: 'Gros identifiant', idMetacard: -5 }]) produits.push(d);   // + hors du domaine du tri natif (identifiant ≥ 2^35, métacarte négative) : le tri par comparateur donne le même ordre   // des lignes que l'ancienne construction écarte
    return { numeros, produits };
}
const visuelBanc = id => (id % 5 === 0 ? null : { total: id % 3 === 0 ? '064' : null, tirage: id % 4 === 0 ? 'intl' : null });
const lecteur = () => visuelBanc;

(async () => {
    // ── 1. code × numéro : l'index d'un curseur = l'index d'un tableau
    const lignes = [];
    { const r = alea(7); for (let i = 0; i < 3000; i++) lignes.push({ codeSet: r() < 0.1 ? null : `S${Math.floor(r() * 80)}${r() < 0.5 ? 'A' : ''}`, numero: r() < 0.1 ? null : r() < 0.2 ? Math.floor(r() * 300) : String(Math.floor(r() * 300)).padStart(3, '0'), numeroUrl: r() < 0.3 ? `TG${Math.floor(r() * 30)}` : null }); }
    const avantLD = LD.construireIndexVerifie(lignes, 100, lignes.length);
    const apresLD = await LD.construireIndexVerifieDepuisCurseur(flux(lignes), 100, lignes.length);
    const sondes = []; { const r = alea(11); for (let i = 0; i < 4000; i++) sondes.push([r() < 0.1 ? 'sv' : `S${Math.floor(r() * 90)}${r() < 0.5 ? 'A' : ''}`, r() < 0.2 ? Math.floor(r() * 300) : String(Math.floor(r() * 300)).padStart(3, '0'), r() < 0.5 ? 'S5' : null]); }
    let dif = 0, vrais = 0; for (const [c, n, x] of sondes) { const a = avantLD.existe(c, n, x), b = apresLD.existe(c, n, x); if (a !== b) dif++; if (a) vrais++; }
    H.v('code × numéro : taille identique', apresLD.taille, avantLD.taille);
    H.v(`code × numéro : existe() identique sur ${sondes.length} sondes (${vrais} vraies : le banc peut échouer)`, [dif, vrais > 100 && vrais < sondes.length - 100], [0, true]);
    const tronque = await taire(async () => { try { await LD.construireIndexVerifieDepuisCurseur(flux(lignes.slice(0, 2900)), 100, 3000); return 'pas levé'; } catch (e) { return e.message; } });
    H.v('code × numéro : moins de documents LUS que COMPTÉS = refus (la garde d\'avant)', tronque, 'index code × numéro : lecture tronquée');
    const compteur0 = LD.compteurs().indexTronques;
    await taire(async () => { try { await LD.construireIndexVerifieDepuisCurseur(flux(lignes.slice(0, 5)), 100, 3000); } catch { } });
    H.v('…et la lecture tronquée est comptée', LD.compteurs().indexTronques, compteur0 + 1);
    const sous = await taire(async () => { try { await LD.construireIndexVerifieDepuisCurseur(flux(lignes.slice(0, 3)), 10000, 3); return 'pas levé'; } catch (e) { return e.message; } });
    H.v('code × numéro : sous le plancher = refus (la garde d\'avant)', sous, 'index code × numéro sous le plancher (10000)');
    H.v('code × numéro : un curseur qui lève est propagé (jamais un index partiel)', await (async () => { async function* casse() { yield lignes[0]; throw new Error('coupure'); } try { await LD.construireIndexVerifieDepuisCurseur(casse(), 1, null); return 'pas levé'; } catch (e) { return e.message; } })(), 'coupure');

    // ── 2. familles : l'index de deux curseurs = l'index de deux tableaux, produit par produit
    let totalFamilles = 0, difFam = 0, nulls = 0, lignesVues = 0;
    for (const [graine, n] of [[1, 400], [2, 1500], [3, 60]]) {
        const { numeros, produits } = catalogueAuHasard(graine, n);
        const avant = DES.creerIndexFamilles(numeros, produits, lecteur);
        const apres = await DES.creerIndexFamillesDepuisFlux(flux(numeros, 13), flux(produits, 17), lecteur);
        H.v(`familles (graine ${graine}, ${produits.length} produits) : taille identique`, apres.taille, avant.taille);
        const ids = [...new Set([...produits.map(p => p && p.idProduct), 5, 999999, -1, null, 'texte'])];
        for (const id of ids) {
            const a = avant.famille(id), b = apres.famille(id);
            totalFamilles++;
            if (a === null) nulls++; else lignesVues += a.length;
            if (JSON.stringify(a) !== JSON.stringify(b)) { difFam++; if (difFam <= 3) console.log('   ↳ DIFFÉRENCE', id, JSON.stringify(a).slice(0, 300), JSON.stringify(b).slice(0, 300)); }
        }
    }
    H.v(`familles : ${totalFamilles} produits, famille() identique (lignes, ORDRE et ordre des clés compris) ; ${nulls} inconnus (null), ${lignesVues} lignes de famille vues`, [difFam, nulls > 0, lignesVues > 1000], [0, true, true]);
    const trF = await taire(async () => { try { await DES.creerIndexFamillesDepuisFlux(flux([{ idProduct: 1 }]), flux([{ idProduct: 1, name: 'A' }, { idProduct: 2, name: 'B' }]), lecteur, { numerosAttendus: 1, produitsAttendus: 3 }); return 'pas levé'; } catch (e) { return e.message; } });
    H.v('familles : moins de produits LUS que COMPTÉS = refus (la garde d\'avant)', trF, 'index des familles : lecture tronquée');
    const trN = await taire(async () => { try { await DES.creerIndexFamillesDepuisFlux(flux([]), flux([{ idProduct: 1, name: 'A' }]), lecteur, { numerosAttendus: 2, produitsAttendus: 1 }); return 'pas levé'; } catch (e) { return e.message; } });
    H.v('familles : moins de lignes de numéros LUES que COMPTÉES = refus', trN, 'index des familles : lecture tronquée');
    // le lecteur d'archive est appelé une fois PAR APPEL de famille (une version pour tout l'appel), comme avant
    let appels = 0; const idxL = await DES.creerIndexFamillesDepuisFlux(flux([]), flux([{ idProduct: 1, name: 'A', idMetacard: 1 }, { idProduct: 2, name: 'A', idMetacard: 1 }]), () => { appels++; return () => null; });
    idxL.famille(1); idxL.famille(2); idxL.famille(3);
    H.v('le lecteur est appelé une fois par famille() d\'un produit connu (pas pour un inconnu)', appels, 2);

    // ── 3. le catalogue de la route : mêmes index qu'avant, lus par curseur, jamais par toArray()
    await H.ouvrirBac('test-index-en-flux.js');
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const { numeros, produits } = catalogueAuHasard(5, 16000, { plage: 3, suffixes: 1500 });                                    // assez de produits distincts (> 10 000) pour passer le plancher (la garde d'avant), comme le vrai catalogue
    const propres = produits.filter(p => p && Number.isInteger(p.idProduct));
    await db.col('catalogue_produits').insertMany(propres.map(p => ({ ...p })));
    await db.col('numeros_cartes').insertMany(numeros.map(n => ({ ...n })));
    const col = db.col, lectures = { toArray: 0, curseurs: 0 };
    db.col = nom => { const c = col(nom); return new Proxy(c, { get(t, p) { if (p !== 'find') return typeof t[p] === 'function' ? t[p].bind(t) : t[p]; return (...a) => { const cur = t.find(...a); lectures.curseurs++; const toArray = cur.toArray.bind(cur); cur.toArray = (...b) => { lectures.toArray++; return toArray(...b); }; return cur; }; } }); };
    try {
        const cat = creerCatalogue({ cfg, visuels: { instantane: () => ({ entree: id => (visuelBanc(id) ? { total: visuelBanc(id).total } : null), tirage: id => (visuelBanc(id) ? visuelBanc(id).tirage : null) }) } });
        const fam = await taire(() => cat.indexFamilles());
        const refDocsN = await col('numeros_cartes').find({}, { projection: { idProduct: 1, codeSet: 1, numero: 1, numeroUrl: 1, setTcgdex: 1 } }).toArray(), refDocsP = await col('catalogue_produits').find({}, { projection: { idProduct: 1, idMetacard: 1, name: 1 } }).toArray();
        const ref = DES.creerIndexFamilles(refDocsN, refDocsP, () => id => { const e = visuelBanc(id) ? { total: visuelBanc(id).total } : null; return { total: (e || {}).total ?? null, tirage: visuelBanc(id) ? visuelBanc(id).tirage : null }; });
        let d = 0, comparees = 0; for (const p of refDocsP.filter((_, i) => i % 9 === 0)) { comparees++; if (JSON.stringify(ref.famille(p.idProduct)) !== JSON.stringify(fam.famille(p.idProduct))) d++; }
        H.v(`catalogue.indexFamilles() sur la base de banc : famille() identique à la construction par tableaux (${comparees} produits sur ${refDocsP.length}, taille ${ref.taille})`, [fam.taille, d], [ref.taille, 0]);
        H.v('…lu par CURSEUR : aucun toArray() sur ces deux collections', [lectures.curseurs >= 2, lectures.toArray], [true, 0]);
        lectures.curseurs = 0; lectures.toArray = 0;
        // l'index code × numéro passe par la garde (plancher) : la base de banc a moins de 10 000 couples, il refuse, comme avant
        const refus = await taire(async () => { try { await cat.indexCodeNumero(); return 'pas levé'; } catch (e) { return e.message; } });
        H.v('catalogue.indexCodeNumero() : la base de banc est sous le plancher de 10 000 couples = refus (inchangé), lu par curseur', [refus, lectures.toArray], ['index code × numéro sous le plancher (10000)', 0]);
        // ── 4. le préchauffage : les deux index sont construits AVANT le premier scan (indexSansAttente rend l'index prêt dès le premier appel), sans lever quand l'un des deux est refusé
        const cat2 = creerCatalogue({ cfg, visuels: { instantane: () => ({ entree: () => null, tirage: () => null }) } });
        H.v('avant le préchauffage : rien de prêt (l\'index naît au premier besoin, en arrière-plan)', [cat2.indexFamillesSansAttente()], [null]);
        const cat3 = creerCatalogue({ cfg, visuels: { instantane: () => ({ entree: () => null, tirage: () => null }) } });
        const bilanP = await taire(() => cat3.prechauffer({ delaiMs: 5000 }));
        H.v('préchauffage : le code × numéro est refusé (sous le plancher, la base de banc), les familles construites — et rien ne lève', bilanP, { codeNumero: false, familles: true });
        H.v('…après le préchauffage, l\'index des familles est PRÊT au premier appel sans attente', cat3.indexFamillesSansAttente() !== null, true);
        // le drapeau V2_INDEX_AU_DEMARRAGE : éteint par défaut, lecture stricte (« 1 » seulement)
        const cat4 = creerCatalogue({ cfg, visuels: { instantane: () => ({ entree: () => null, tirage: () => null }) } });
        delete process.env.V2_INDEX_AU_DEMARRAGE;
        H.v('V2_INDEX_AU_DEMARRAGE absent : rien n\'est construit (null)', await cat4.prechaufferSiDemande(), null);
        for (const v of ['0', 'true', '2', '']) { process.env.V2_INDEX_AU_DEMARRAGE = v; H.v(`V2_INDEX_AU_DEMARRAGE="${v}" : rien n'est construit`, await cat4.prechaufferSiDemande(), null); }
        process.env.V2_INDEX_AU_DEMARRAGE = '1';
        H.v('V2_INDEX_AU_DEMARRAGE="1" : construit (les familles ; le code × numéro est refusé sous le plancher de la base de banc)', await taire(() => cat4.prechaufferSiDemande({ delaiMs: 5000 })), { codeNumero: false, familles: true });
        delete process.env.V2_INDEX_AU_DEMARRAGE;
    } finally { db.col = col; }
    await H.fermerBac(); H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.fermerBac(); } catch { } process.exit(1); });
