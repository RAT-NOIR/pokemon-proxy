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
const jouer = async ({ corps, ids, ver, cat = catFaux(), ctxExtra = {} }) => {
    const fourn = await J.fournisseurParDefaut(cat, ver, ids === undefined ? J.idsAPreparer(corps, ctxExtra.candidatsDeRefus) : ids);
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
    const ligneVerdict = avertissements.filter(l => l.includes('verdict impossible'));
    H.v('   elle est JOURNALISÉE : une ligne par produit dont la requête a levé, avec le nom de l\'erreur', [ligneVerdict.length >= 1, /produit=606848/.test(ligneVerdict.join('|')), /MongoNetworkError/.test(ligneVerdict.join('|'))], [true, true, true]);
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

    // ── 5. les trois endroits qui préparent les verdicts appellent la MÊME fonction (une règle, pas trois copies)
    const routes = SRC('routes.js'), lot = SRC('lot.js'), charge = SRC('langue-decisive-charge.js');
    H.v('routes.js (une carte) : fournisseurParDefaut(…, idsAPreparer(c)) — et plus idsAffirmes(c)', [/fournisseurParDefaut\(catalogue, version0, idsAPreparer\(c\)\)/.test(routes), /fournisseurParDefaut\(catalogue, version0, idsAffirmes\(c\)\)/.test(routes)], [true, false]);
    H.v('lot.js (le lot) : idsAPreparer(corpsDe(r)) sur chaque résultat — et plus idsAffirmes', [/fournisseurParDefaut\(catalogue, version0, resultats\.flatMap\(r => idsAPreparer\(corpsDe\(r\)\)\)\)/.test(lot), /idsAffirmes/.test(lot)], [true, false]);
    H.v('langue-decisive-charge.js (le fournisseur refait, qui REMPLACE celui de la route) : idsAPreparer — sinon il perdrait les verdicts des candidats', [/idsAPreparer\(c\)/.test(charge), /idsAffirmes/.test(charge.replace(/\/\/.*$/gm, ''))], [true, false]);
    // le lot, composé comme lot.js : flatMap sur les corps de TOUTES les cartes
    const catLot = catFaux();
    const fLot = await J.fournisseurParDefaut(catLot, v0, [deux, corpsDe([606889])].flatMap(c => J.idsAPreparer(c)));
    H.v('LOT (même composition que lot.js) : les verdicts de TOUS les candidats de toutes les cartes sont préparés, la garde conclut pour 606848 comme pour 606889', [fLot(606848).conclu, fLot(606889).conclu], [true, true]);
    const rLot = [deux, corpsDe([606889])].map(c => adapter({ statutHttp: 200, corps: c }, { produits, langueInterface: 'fr', cfg, jumeaux: fLot, lot: true }));
    H.v('   et l\'adaptateur en mode lot rend, pour la carte au filtre de nom, la même question qu\'avec un seul candidat d\'origine (jamais une panne)', [resume(rLot[0]), rLot[1].issue !== 'panne'], [rUn, true]);

    H.bilan();
})().catch(e => { console.error('❌ EXCEPTION', e); process.exitCode = 1; });
