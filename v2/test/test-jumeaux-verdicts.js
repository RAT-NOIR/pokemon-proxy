'use strict';
// JUMEAUX-VERDICTS — plus de panne INDISPONIBLE quand le filtre de nom laisse UN candidat dont personne n'avait préparé le verdict.
// Cas fondateur (essai e833578c, 3 scans sur 50 : produits 606848, 606812, 549141) : la chaîne rend 2 candidats [606848 Dark Exeggutor, 606889 Dark Porygon2], le nom lu « Dark Exeggutor » (confiance haute)
// contredit le second ; l'adaptateur retire 606889, appelle garde() sur 606848 — dont le verdict n'avait pas été préparé (idsAffirmes sur le corps BRUT : 2 candidats = aucun id) → « la colonne ne conclut pas » → 503.
// Pas de base, pas de réseau. Les fonctions sont celles de la PRODUCTION : creerConstructeur(), fournisseurParDefaut, idsAPreparer, adapter ; seul le catalogue (plusRecentDansMetacarte) est un faux.
const H = require('./_harnais');
const fs = require('fs');
const path = require('path');
const { creerConstructeur } = require('../chargeur/version');
const J = require('../identifier/jumeaux');
const { adapter } = require('../identifier/adaptateur');
const { lireConfig } = require('../config');
const cfg = lireConfig({});

const img = (cle, w, h) => ({ cle, w, h });
const brut = (id, meta) => ({ idProduct: id, vignette: img(`vignettes/${id}.webp`, 200, 279), grande: null, visuel: 'du-set', mention: null, idMetacard: meta, numero: '1', rarete: 'Rare', total: '100', variante: null, setNom: 'S', lien: null });
const col = (idProduct, idMetacard, idExpansion, numero, tirage) => ({ idProduct, idMetacard, idExpansion, numero, tirage });
const META_EXEG = 212546, META_PORY = 300001;
const NOMS = { 606848: 'Dark Exeggutor [Triple Headbutt | MAX Burst]', 606889: 'Dark Porygon2 [Rock Tumble | Cheek]', 606900: 'Dark Exeggutor [Triple Headbutt | MAX Burst]' };
const ligne = id => ({ idProduct: id, nomCardmarket: NOMS[id], set: { slug: 's' + id, nom: 'Set ' + id }, numero: '51', total: '100', langue: 'JA', variante: null, rarete: 'Rare',
    prixGuide: { trend: 5, low: 4, avg30: 4.5, guideDu: new Date('2026-10-04') }, visuel: { url: `https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/${id}.webp`, w: 255, h: 356 } });
const produits = new Map([606848, 606889, 606900].map(id => [id, ligne(id)]));
const version = ({ avecJumeau = false } = {}) => {
    const c = creerConstructeur();
    c.entree(brut(606848, META_EXEG));
    c.jumeau(col(606848, META_EXEG, 4509, '51', 'jp'));
    c.jumeau(col(606889, META_PORY, 4509, '52', 'jp'));
    if (avecJumeau) c.jumeau(col(606900, META_EXEG, 4510, '51', 'jp'));        // un AUTRE créneau de la même métacarte et du même tirage : le jumeau de 606848
    return c.finir(new Date('2026-10-24T10:00:00.000Z'));
};
const corpsDe = (candidats, extra = {}) => ({ success: true, scanId: 's1', question: null,
    carte: { idProduct: candidats[0], ambigu: true, niveauReserve: null, raisonReserve: null, concurrent: null, nbExAequo: candidats.length, name: 'Dark Exeggutor', nomBrut: 'Dark Exeggutor', nomConfiance: 'haute' },
    etat: { estimeIA: 'EX', confianceIA: 'haute', defautsVus: [], declareVendeur: null, retenu: 'GD' }, candidats: candidats.map(idProduct => ({ idProduct, score: 9 })),
    classement: [], reverse: { attendue: false, strategie: null }, codeLangue: 1, ...extra });
const catFaux = (reponse = false) => { const appels = []; return { appels, plusRecentDansMetacarte: async (max, meta) => { appels.push(meta); if (reponse === 'leve') { const e = new Error('mongo muet : secret-ne-pas-journaliser'); e.name = 'MongoNetworkError'; throw e; } return typeof reponse === 'function' ? reponse(meta) : reponse; } }; };
const jouer = async ({ corps, ids, ver, cat = catFaux(), ctxExtra = {}, tous = ids === undefined }) => {      // sans `ids` : le chemin du DRAPEAU ALLUMÉ (idsAPreparer + { tous: true }) ; avec `ids` : l'appel d'e833578c
    const fourn = await J.fournisseurParDefaut(cat, ver, ids === undefined ? J.idsAPreparer(corps, ctxExtra.candidatsDeRefus) : ids, tous ? { tous: true } : undefined);
    return adapter({ statutHttp: 200, corps }, { produits, langueInterface: 'fr', cfg, jumeaux: fourn, ...ctxExtra });
};
const resume = r => ({ issue: r.issue, erreur: r.erreur || null, motif: r.motif || null, raison: r.analyse && r.analyse.raison, statut: r.analyse && r.analyse.cartes && r.analyse.cartes[0].statut, ids: r.analyse && r.analyse.cartes && r.analyse.cartes[0].candidats.map(x => x.idProduct), carte: r.analyse && r.analyse.cartes && r.analyse.cartes[0].carte && r.analyse.cartes[0].carte.idProduct });
const SRC = f => fs.readFileSync(path.join(__dirname, '..', 'identifier', f), 'utf8');

(async () => {
    const v0 = version(), vJ = version({ avecJumeau: true });
    const deux = corpsDe([606848, 606889]), un = corpsDe([606848]);

    // ── 1. le mécanisme de l'enquête (témoin : l'ANCIEN appel, idsAffirmes sur le corps brut) : la panne existe, et elle porte ce motif
    H.v('TÉMOIN du défaut : 2 candidats, verdicts préparés seulement pour idsAffirmes (aucun id) → l\'adaptateur rend la panne INDISPONIBLE jumeaux-indisponibles', (({ issue, erreur, motif }) => ({ issue, erreur, motif }))(await jouer({ corps: deux, ids: J.idsAffirmes(deux), ver: v0 })), { issue: 'panne', erreur: { code: 'INDISPONIBLE' }, motif: 'jumeaux-indisponibles' });
    H.v('   idsAffirmes ne prépare rien pour 2 candidats ; un seul candidat d\'origine prépare son id', [J.idsAffirmes(deux), J.idsAffirmes(un)], [[], [606848]]);

    // ── 2. la correction : pas de panne, et EXACTEMENT ce que rendrait le même cas avec un seul candidat d'origine (la garde elle-même n'a pas changé)
    const rDeux = resume(await jouer({ corps: deux, ver: v0 })), rUn = resume(await jouer({ corps: un, ver: v0 }));
    H.v('2 candidats [606848, 606889], nom lu « Dark Exeggutor » haute : plus de panne', rDeux.issue !== 'panne', true);
    H.v('   le résultat est EXACTEMENT celui du même cas avec un seul candidat d\'origine (question « est-ce cette carte ? » sur 606848, sans jumeau)', rDeux, rUn);
    H.v('   … et c\'est une question à UN choix sur le produit qui reste, jamais une affirmation que la garde n\'aurait pas permise', [rDeux.issue, rDeux.statut, rDeux.ids, rDeux.carte], ['question', 'a-trancher', [606848], null]);
    // un candidat qui a un JUMEAU : la décision de la garde (question de départage entre lui et son jumeau) est inchangée
    const rJ2 = resume(await jouer({ corps: deux, ver: vJ })), rJ1 = resume(await jouer({ corps: un, ver: vJ }));
    H.v('même cas, 606848 a un jumeau (606900) : le résultat est celui du seul candidat d\'origine — la question de départage, jamais une affirmation', [rJ2, rJ2.issue, rJ2.ids], [rJ1, 'question', [606848, 606900]]);
    // le nom lu ne contredit personne : la question à 2 est inchangée (aucun verdict utilisé, aucune panne)
    const corpsLarge = corpsDe([606848, 606900]);
    H.v('deux candidats que le nom ne contredit pas : la question à 2 candidats d\'avant (le chemin n\'est pas touché)', (r => [r.issue, r.ids])(resume(await jouer({ corps: corpsLarge, ver: vJ }))), ['question', [606848, 606900]]);
    // l'égalité délibérée : les candidats viennent du contexte (candidatsDeRefus), le corps n'en porte pas
    const refus = (extra = {}) => ({ success: false, natureRefus: 'refus-delibere', motifRefus: 'nom-contredit-egalite', cardInfo: { name: 'Dark Exeggutor', nomBrut: 'Dark Exeggutor', nomConfiance: 'haute' }, etat: { estimeIA: 'EX', confianceIA: 'haute' }, ...extra });
    const rRefusCtx = resume(await jouer({ corps: refus(), ver: v0, ctxExtra: { candidatsDeRefus: [{ idProduct: 606848 }, { idProduct: 606889 }] } }));
    const rRefusUn = resume(await jouer({ corps: refus({ candidats: [{ idProduct: 606848 }] }), ver: v0 }));
    H.v('égalité délibérée, candidats dans ctx.candidatsDeRefus : plus de panne, et le résultat du même cas avec un seul candidat d\'origine', [rRefusCtx.issue !== 'panne', rRefusCtx, ], [true, rRefusUn]);
    H.v('   sans passer ctx.candidatsDeRefus à idsAPreparer (l\'oubli) : la panne d\'avant — c\'est le paramètre qui compte', (await jouer({ corps: refus(), ver: v0, ids: J.idsAPreparer(refus()), ctxExtra: { candidatsDeRefus: [{ idProduct: 606848 }, { idProduct: 606889 }] } })).issue, 'panne');

    // ── 3. une VRAIE panne reste une panne (la garde ne change pas d'un caractère) et se VOIT
    const avertissements = []; const warn0 = console.warn; console.warn = (...a) => { avertissements.push(a.join(' ')); };
    let rLeve; try { rLeve = await jouer({ corps: deux, ver: v0, cat: catFaux('leve') }); } finally { console.warn = warn0; }
    H.v('la requête du catalogue LÈVE : la panne INDISPONIBLE reste une panne (jamais un introuvable, jamais une affirmation)', [rLeve.issue, rLeve.erreur, rLeve.motif], ['panne', { code: 'INDISPONIBLE' }, 'jumeaux-indisponibles']);
    const ligneVerdict = avertissements.filter(l => l.includes('verdicts impossibles'));
    H.v('   elle est JOURNALISÉE : UN seul avertissement agrégé pour l\'appel (le compte, 2 sur 2), avec le code réduit à [A-Z0-9_]', [ligneVerdict.length, /2 sur 2/.test(ligneVerdict.join('|')), /codes : MONGONETWORKERROR\)/.test(ligneVerdict.join('|'))], [1, true, true]);
    H.v('   … sans la moindre valeur sensible (le message de l\'exception n\'est jamais écrit)', avertissements.some(l => l.includes('secret-ne-pas-journaliser')), false);
    const rPerime = resume(await jouer({ corps: deux, ver: v0, cat: catFaux(meta => meta === META_EXEG) }));
    H.v('un produit plus récent sous la métacarte : « périmé », la panne jumeaux-perimes (inchangé)', [rPerime.issue, rPerime.motif], ['panne', 'jumeaux-perimes']);
    const sansColonne = creerConstructeur(); sansColonne.entree(brut(606848, META_EXEG));
    const cat0 = catFaux();
    const rSans = resume(await jouer({ corps: deux, ver: sansColonne.finir(new Date()), cat: cat0 }));
    H.v('colonne absente : la panne, et le catalogue n\'est même pas interrogé', [rSans.issue, rSans.motif, cat0.appels.length], ['panne', 'jumeaux-indisponibles', 0]);

    // ── 4. ce qu'on prépare, et la borne
    const q = n => Array.from({ length: n }, (_, i) => ({ idProduct: 700000 + i }));
    H.v('idsAPreparer : l\'affirmé d\'abord, puis les candidats d\'une réponse que l\'adaptateur lit (réussite ; égalité délibérée) ; un seul candidat = le même id que idsAffirmes', [
        J.idsAPreparer(deux), J.idsAPreparer(un), J.idsAPreparer(refus({ candidats: [{ idProduct: 5 }, { idProduct: 6 }] })), J.idsAPreparer(refus(), [{ idProduct: 606848 }, { idProduct: 606889 }]),
        J.idsAPreparer({ success: true, carte: { idProduct: 7, ambigu: false }, candidats: [{ idProduct: 8 }, { idProduct: 7 }] })],
        [[606848, 606889], [606848], [5, 6], [606848, 606889], [7, 8]]);
    H.v('   ce que l\'adaptateur ne lit pas ne prépare rien de plus que idsAffirmes : refus technique, motif de refus inconnu, corps absent', [
        J.idsAPreparer({ success: false, natureRefus: 'echec-technique', motifRefus: 'ia-echec', candidats: [{ idProduct: 5 }, { idProduct: 6 }] }), J.idsAPreparer({ success: false, natureRefus: 'refus-delibere', motifRefus: 'numero-illisible', candidats: [{ idProduct: 5 }, { idProduct: 6 }] }),
        J.idsAPreparer(null), J.idsAPreparer('x'), J.idsAPreparer({})], [[], [], [], [], []]);
    H.v('   ids non entiers ignorés, doublons retirés', J.idsAPreparer({ success: true, carte: { ambigu: true }, candidats: [{ idProduct: 'a' }, { idProduct: 3 }, { idProduct: 3 }, null, { idProduct: 4.5 }] }), [3]);
    const grand = corpsDe([]); grand.candidats = q(25); grand.carte.idProduct = 700000; grand.carte.ambigu = false;
    const preparesGrand = J.idsAPreparer(grand);
    H.v('BORNE : au plus MAX_PREPARES (10, le pool de la chaîne) produits, donc 10 requêtes indexées au plus ; le produit affirmé en tête n\'est jamais coupé', [J.MAX_PREPARES, preparesGrand.length, preparesGrand[0]], [10, 10, 700000]);
    const catBorne = catFaux();
    await J.fournisseurParDefaut(catBorne, v0, J.idsAPreparer(deux));
    H.v('   le coût du cas fondateur : 2 requêtes (une par candidat, 1 si les deux partagent une métacarte) — contre 0 avant', catBorne.appels.length, 2);
    const catMeme = catFaux(); const vMeme = (() => { const c = creerConstructeur(); c.entree(brut(606848, META_EXEG)); c.jumeau(col(606848, META_EXEG, 4509, '51', 'jp')); c.jumeau(col(606900, META_EXEG, 4510, '51', 'jp')); return c.finir(); })();
    await J.fournisseurParDefaut(catMeme, vMeme, J.idsAPreparer(corpsLarge));
    H.v('   deux candidats : jamais plus d\'une requête par id préparé (le fournisseur dédoublonne les ids)', catMeme.appels.length <= J.idsAPreparer(corpsLarge).length, true);

    // ── 5. les trois endroits qui préparent les verdicts, derrière le DRAPEAU (V2_JUMEAUX_PREPARER_TOUS) : allumé, la fonction de ce module ; éteint, l'appel d'e833578c
    const routes = SRC('routes.js'), lot = SRC('lot.js'), charge = SRC('langue-decisive-charge.js');
    H.v('routes.js (une carte) : allumé idsAPreparer(c) + { tous: true } ; éteint idsAffirmes(c) sans option (l\'appel d\'e833578c)', [/fournisseurParDefaut\(catalogue, version0, cfg\.jumeauxPreparerTous === true \? idsAPreparer\(c\) : idsAffirmes\(c\), cfg\.jumeauxPreparerTous === true \? \{ tous: true \} : undefined\)/.test(routes), /deps, tous: cfg\.jumeauxPreparerTous === true/.test(routes)], [true, true]);
    H.v('lot.js (le lot) : allumé idsAPreparerLot(tous les corps) + { tous: true } (UN budget pour le lot) ; éteint le flatMap d\'idsAffirmes d\'avant', [/cfg\.jumeauxPreparerTous === true \? idsAPreparerLot\(resultats\.map\(corpsDe\)\) : resultats\.flatMap\(r => idsAffirmes\(corpsDe\(r\)\)\)/.test(lot), /deps, tous: cfg\.jumeauxPreparerTous === true/.test(lot), /idsAPreparer\(/.test(lot)], [true, true, false]);
    H.v('langue-decisive-charge.js : allumé, reprend les verdicts déjà établis (jumeaux.verdicts) au lieu de refaire les requêtes ; éteint, l\'appel d\'e833578c', [/tous === true \? \{ tous: true, deja: jumeaux && jumeaux\.verdicts instanceof Map/.test(charge), /idsAPreparer/.test(charge.replace(/\/\/.*$/gm, ''))], [true, false]);
    const cfgFlag = e => lireConfig({ MONGODB_BASE: 'test_scratch', ...e });
    let leveDeux = false; try { cfgFlag({ V2_JUMEAUX_PREPARER_TOUS: '2' }); } catch { leveDeux = true; }
    H.v('DRAPEAU : absent ou « 0 » = éteint, « 1 » = allumé, toute autre valeur rend la configuration invalide', [cfgFlag({}).jumeauxPreparerTous, cfgFlag({ V2_JUMEAUX_PREPARER_TOUS: '0' }).jumeauxPreparerTous, cfgFlag({ V2_JUMEAUX_PREPARER_TOUS: '1' }).jumeauxPreparerTous, leveDeux], [false, false, true, true]);

    // le lot, composé comme lot.js (drapeau allumé) : UN budget pour tout le lot
    const catLot = catFaux();
    const fLot = await J.fournisseurParDefaut(catLot, v0, J.idsAPreparerLot([deux, corpsDe([606889])]), { tous: true });
    H.v('LOT (même composition que lot.js) : les verdicts de TOUS les candidats de toutes les cartes sont préparés, la garde conclut pour 606848 comme pour 606889', [fLot(606848).conclu, fLot(606889).conclu], [true, true]);
    const rLot = [deux, corpsDe([606889])].map(c => adapter({ statutHttp: 200, corps: c }, { produits, langueInterface: 'fr', cfg, jumeaux: fLot, lot: true }));
    H.v('   et l\'adaptateur en mode lot rend, pour la carte au filtre de nom, la même question qu\'avec un seul candidat d\'origine (jamais une panne)', [resume(rLot[0]), rLot[1].issue !== 'panne'], [rUn, true]);

    // ── 6. BORNE GLOBALE du lot : 20 cartes × 10 candidats → au plus 40 requêtes, l'affirmé de chaque carte d'abord, puis tour de rôle
    const idDe = (i, k) => 800000 + i * 100 + k;
    const corpsPlein = (i, affirme) => { const c = corpsDe([]); c.candidats = Array.from({ length: 10 }, (_, k) => ({ idProduct: idDe(i, k) })); c.carte.idProduct = idDe(i, 0); c.carte.ambigu = !affirme; return c; };
    const vingt = Array.from({ length: 20 }, (_, i) => corpsPlein(i, true));
    const idsLot = J.idsAPreparerLot(vingt);
    H.v('BORNE DU LOT : 20 cartes × 10 candidats → 40 ids au plus (MAX_PREPARES_LOT), tous distincts', [J.MAX_PREPARES_LOT, idsLot.length, new Set(idsLot).size], [40, 40, 40]);
    H.v('   l\'ordre : l\'affirmé de chaque carte d\'abord (20), puis le 2e candidat de chaque carte, à tour de rôle (20)', [idsLot.slice(0, 20).join() === Array.from({ length: 20 }, (_, i) => idDe(i, 0)).join(), idsLot.slice(20).join() === Array.from({ length: 20 }, (_, i) => idDe(i, 1)).join()], [true, true]);
    const ambigues = Array.from({ length: 20 }, (_, i) => corpsPlein(i, false));
    const idsAmb = J.idsAPreparerLot(ambigues);
    H.v('   des cartes sans affirmé (20 ambiguës) : 40 ids, deux par carte, aucune carte ne mange le budget des autres', [idsAmb.length, ambigues.every((_, i) => idsAmb.filter(id => Math.floor((id - 800000) / 100) === i).length === 2)], [40, true]);
    H.v('   un lot qui tient dans le budget n\'est pas tronqué ; un lot vide ou une liste absente rend []', [J.idsAPreparerLot([deux, un]).join(), J.idsAPreparerLot([]).length, J.idsAPreparerLot(null).length], ['606848,606889', 0, 0]);
    const grandeVersion = (() => { const c = creerConstructeur(); c.entree(brut(idDe(0, 0), 1)); for (let i = 0; i < 20; i++) for (let k = 0; k < 10; k++) c.jumeau(col(idDe(i, k), idDe(i, k), 4509, String(k + 1), 'jp')); return c.finir(new Date('2026-10-24T10:00:00.000Z')); })();
    const catGrand = catFaux();
    const fGrand = await J.fournisseurParDefaut(catGrand, grandeVersion, idsLot, { tous: true });
    H.v('   le COÛT RÉEL : 20 cartes × 10 candidats = 40 requêtes au plus (200 sans budget)', catGrand.appels.length <= 40 && catGrand.appels.length === 40, true);
    H.v('   un id au-delà du budget (le 10e candidat de la carte 0) n\'est pas préparé : il ne conclut pas (jumeaux-indisponibles), jamais « ok » ; ceux du budget concluent', [fGrand(idDe(0, 9)), fGrand(idDe(0, 0)).conclu, fGrand(idDe(19, 1)).conclu], [{ conclu: false, ids: [], motif: 'jumeaux-indisponibles' }, true, true]);

    // ── 7. DÉLAI, CONCURRENCE, maxTimeMS : un délai dépassé est une panne, jamais un « ok »
    const jamais = { plusRecentDansMetacarte: () => new Promise(() => { }) };
    const t0 = Date.now();
    const fMuet = await J.fournisseurParDefaut(jamais, v0, J.idsAPreparer(deux), { tous: true, delaiMs: 150 });
    const duree = Date.now() - t0;
    H.v('DÉLAI : une base qui ne répond jamais — la préparation rend la main à ~150 ms (jamais bloquée), aucun verdict ne conclut', [duree >= 140 && duree < 1500, fMuet(606848).conclu, fMuet(606848).motif], [true, false, 'jumeaux-indisponibles']);
    const rMuet = resume(adapter({ statutHttp: 200, corps: deux }, { produits, langueInterface: 'fr', cfg, jumeaux: fMuet }));
    H.v('   … l\'adaptateur rend la panne INDISPONIBLE (jamais une affirmation, jamais un introuvable)', [rMuet.issue, rMuet.erreur], ['panne', { code: 'INDISPONIBLE' }]);
    const tardive = { plusRecentDansMetacarte: () => new Promise(res => setTimeout(() => res(false), 400)) };
    const fTard = await J.fournisseurParDefaut(tardive, v0, J.idsAPreparer(deux), { tous: true, delaiMs: 100 });
    await new Promise(res => setTimeout(res, 500));
    H.v('   un « faux franc » qui arrive APRÈS le délai est ignoré : l\'id reste « ne conclut pas »', [fTard(606848).conclu, fTard(606889).conclu], [false, false]);
    const delaiSansLimite = J.DELAI_VERDICTS_MS;
    H.v('   le délai par défaut est borné (3 s) et la requête porte maxTimeMS 1 500 ms, quatre à la fois', [delaiSansLimite, J.MAX_TIME_MS_VERDICT, J.CONCURRENCE_VERDICTS], [3000, 1500, 4]);
    let enVol = 0, maxVol = 0; const options = [];
    const compteur = { plusRecentDansMetacarte: async (...a) => { options.push(a.length === 3 ? a[2] : null); enVol++; maxVol = Math.max(maxVol, enVol); await new Promise(res => setTimeout(res, 20)); enVol--; return false; } };
    await J.fournisseurParDefaut(compteur, grandeVersion, idsLot.slice(0, 12), { tous: true });
    H.v('CONCURRENCE : 12 ids, jamais plus de 4 requêtes en vol (et 4 effectivement), chacune avec maxTimeMS 1500', [maxVol, options.length, options.every(o => o && o.maxTimeMS === 1500)], [4, 12, true]);
    const optionsOff = []; let enVolOff = 0, maxVolOff = 0;
    const compteurOff = { plusRecentDansMetacarte: async (...a) => { optionsOff.push(a.length); enVolOff++; maxVolOff = Math.max(maxVolOff, enVolOff); await new Promise(res => setTimeout(res, 5)); enVolOff--; throw new Error('muet : secret'); } };
    const avertOff = []; const w1 = console.warn; console.warn = (...a) => { avertOff.push(a.join(' ')); };
    let fOff; try { fOff = await J.fournisseurParDefaut(compteurOff, grandeVersion, idsLot.slice(0, 6)); } finally { console.warn = w1; }
    H.v('ÉTEINT (sans option) : la boucle en SÉRIE d\'e833578c — une requête à la fois, à deux arguments, sans maxTimeMS, sans le moindre avertissement', [maxVolOff, optionsOff.every(n => n === 2), avertOff.length, fOff(idsLot[0]).conclu], [1, true, 0, false]);
    // la réutilisation des verdicts : le second fournisseur (LANGUE-DECISIVE) ne refait pas les requêtes déjà faites
    const cat1 = catFaux();
    const f1 = await J.fournisseurParDefaut(cat1, v0, J.idsAPreparer(deux), { tous: true });
    const cat2 = catFaux();
    const f2 = await J.fournisseurParDefaut(cat2, v0, [606848, 606889], { tous: true, deja: f1.verdicts });
    H.v('RÉUTILISATION : le fournisseur refait avec { deja } ne redemande rien (0 requête), et garde TOUS les verdicts', [cat2.appels.length, f2(606848).conclu, f2(606889).conclu, f2.verdicts.size], [0, true, true, 2]);
    const cat3 = catFaux();
    const f3 = await J.fournisseurParDefaut(cat3, vJ, [606848, 606900], { tous: true, deja: f1.verdicts });
    H.v('   seul l\'id qui manque est demandé (1 requête) ; un « indisponible » déjà établi reste fermé', [cat3.appels.length, f3(606848).conclu, f3(606900).conclu], [1, true, true]);
    const fermeDeja = await J.fournisseurParDefaut(catFaux(), v0, [606848], { tous: true, deja: new Map([[606848, 'indisponible']]) });
    H.v('   … et ne se rouvre pas', fermeDeja(606848).conclu, false);
    // le code journalisé est réduit
    const bizarre = { plusRecentDansMetacarte: async () => { const e = new Error('m'); e.code = 'ECONN-reset! ' + 'x'.repeat(80); throw e; } };
    const lignes = []; const w2 = console.warn; console.warn = (...a) => { lignes.push(a.join(' ')); };
    try { await J.fournisseurParDefaut(bizarre, v0, [606848], { tous: true }); } finally { console.warn = w2; }
    const code = (/codes : ([^)]*)\)/.exec(lignes.join('|')) || [])[1] || '';
    H.v('JOURNAL : le code est réduit à [A-Z0-9_]{1,40}', [/^[A-Z0-9_]{1,40}$/.test(code), code.startsWith('ECONNRESET')], [true, true]);

    H.bilan();
})().catch(e => { console.error('❌ EXCEPTION', e); process.exitCode = 1; });
