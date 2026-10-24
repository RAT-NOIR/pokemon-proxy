'use strict';
// Banc PRIX-LISIBLE (pur : aucune base, aucun réseau) — le REPLI HONNÊTE du prix : `prixRepli`.
// Règle de l'éditeur (2026-10-24) : jamais « prix illisible » quand la fiche a une donnée de prix ; le repli est la tendance et les moyennes du guide, ou l'offre dans l'état le plus proche
// si l'extension l'a envoyée, TOUJOURS avec une mention fermée, `fiable: false` et aucun verdict ; sans aucune donnée de prix, aucun repli.
// Les chiffres de Tauros (Jungle 47/64) et d'Arcanin [G] Lv.60 (Supreme Victors 15/147) sont les champs RÉELS du guide, relevés en lecture seule dans rm_essai (fixtures/prix-repli-reels.json) : aucune valeur inventée.
const fs = require('fs'), path = require('path');
const { v, vrai, bilan } = require('./_harnais');
const { lireConfig } = require('../config');
const { construireProduit } = require('../identifier/produit');
const { adapter } = require('../identifier/adaptateur');
const R = require('../identifier/prix-repli');
const { valider } = require('../openapi/valider');
const doc = require('../openapi/openapi.v2.json');

const REEL = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'prix-repli-reels.json'), 'utf8')).cas;
const cfg = lireConfig({});
const HOTE = 'https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/';
// la ligne de catalogue d'un cas réel : sa fiche et son guide tels que la base les porte
const ligne = (nom, o = {}) => {
    const c = REEL[nom];
    return { idProduct: c.idProduct, nomCardmarket: c.produit.nomCardmarket, set: { slug: c.produit.set.slug, nom: c.produit.set.nom, code: c.produit.set.code }, numero: c.produit.numero, total: c.produit.total, langue: 'EN', variante: null,
        rarete: c.produit.rarete, prixGuide: { ...c.guide, guideDu: new Date(c.guide.guideDu) }, visuel: { url: `${HOTE}${c.idProduct}.webp`, w: 255, h: 356 }, ...o };
};
const produit = (nom, o) => construireProduit(ligne(nom, o), { langueInterface: 'fr', cfg });
const guideDe = nom => produit(nom).prixGuide;
const cle = o => JSON.stringify(Object.keys(o));

// ── 0. les données réelles sont bien celles du brief (le garde-fou de la fixture)
v('Tauros : guide réel 1,49 / 0,02 / 1,55 / 1,26 au 2026-10-12', [REEL.tauros.guide.trend, REEL.tauros.guide.low, REEL.tauros.guide.avg7, REEL.tauros.guide.avg30, REEL.tauros.guide.guideDu.slice(0, 10)], [1.49, 0.02, 1.55, 1.26, '2026-10-12']);
v('Arcanin : guide réel 10,18 / 1 / 14,59 / 13,15 au 2026-10-12', [REEL.arcanin.guide.trend, REEL.arcanin.guide.low, REEL.arcanin.guide.avg7, REEL.arcanin.guide.avg30, REEL.arcanin.guide.guideDu.slice(0, 10)], [10.18, 1, 14.59, 13.15, '2026-10-12']);
v('Tauros : la cause réelle du « prix illisible » (le serveur a dicté etatVise null : confiance de l\'état « basse »)', [REEL.tauros.etat.confiance, REEL.tauros.etat.retenu, REEL.tauros.lecture.codeLangue, REEL.tauros.journal.lectureRatee.cause], ['basse', null, 1, 'sans-prix']);

// ── 1. l'ANALYSE : Tauros, etatVise null => le repli « tendance » (cause etat-non-retenu), sans verdict, fiable false
{
    const corps = { success: true, scanId: 's1', question: null, carte: { idProduct: 273844, ambigu: false, niveauReserve: null, raisonReserve: null, concurrent: null, nbExAequo: null },
        etat: { estimeIA: REEL.tauros.etat.estime, confianceIA: REEL.tauros.etat.confiance, defautsVus: REEL.tauros.etat.defauts, declareVendeur: null, declareCardmarket: null, retenu: null },
        candidats: [{ idProduct: 273844, score: 9 }], classement: [{ idProduct: 273844, score: 9 }], reverse: { attendue: false, strategie: null }, codeLangue: REEL.tauros.lecture.codeLangue };
    const r = adapter({ statutHttp: 200, corps }, { produits: new Map([[273844, ligne('tauros')]]), langueInterface: 'fr', cfg, jumeaux: () => ({ conclu: true, ids: [] }) });
    const c = r.analyse.cartes[0];
    v('Tauros (adaptateur inchangé) : identifiée, prixLive.etatVise null — le client n\'a « rien à lire »', [c.statut, c.prixLive && c.prixLive.etatVise], ['identifiee', null]);
    v('  l\'adaptateur NE sert PAS le repli (il vit au bord de la route, après la tampon)', 'prixRepli' in c, false);
    const e = R.avecRepliAnalyse(c);
    vrai('  le repli est servi', e.prixRepli !== undefined);
    v('  mention fermée : tendance, cause etat-non-retenu, fiable false', [e.prixRepli.repli, e.prixRepli.cause, e.prixRepli.fiable], ['tendance', 'etat-non-retenu', false]);
    v('  les chiffres du guide réel, tels que le serveur les sert déjà (aucun nouveau calcul)', [e.prixRepli.guide.tendance, e.prixRepli.guide.de, e.prixRepli.guide.moyenne7, e.prixRepli.guide.moyenne30, e.prixRepli.guide.date], [1.49, 0.02, 1.55, 1.26, '2026-10-12']);
    v('  le guide du repli est celui de la fiche (même objet servi)', e.prixRepli.guide, c.carte.prixGuide);
    v('  aucune offre inventée, aucun verdict', [e.prixRepli.offre, 'verdict' in e.prixRepli, 'verdict' in e], [null, false, false]);
    v('  la carte d\'origine est intacte (immuable : même prixLive, même carte)', [e.prixLive, e.carte === c.carte, c.prixRepli], [c.prixLive, true, undefined]);
    v('  l\'ordre des clés : celles d\'avant, puis prixRepli', cle(e), cle({ ...c, prixRepli: 1 }));
    // l'analyse ENTIÈRE (ce que la route sert) : la carte de Tauros reçoit son repli, rien d'autre ne bouge ; sans repli à poser, la MÊME référence
    const ana = { ...r.analyse, regleVerdict: null };
    const ar = R.analyseAvecRepli(ana);
    v('analyse : la carte affirmée de Tauros porte le repli, le reste de l\'analyse est intact', [ar.cartes[0].prixRepli.cause, ar.statut, ar.regleVerdict, ar.lot, ar.raison], ['etat-non-retenu', 'identifiee', null, null, null]);
    const intacte = { ...ana, cartes: [{ ...c, prixLive: { idProduct: 273844, langues: [1], reverseHolo: false, etatVise: 'EX' } }] };
    v('analyse : rien à poser => la même référence (octet pour octet)', R.analyseAvecRepli(intacte) === intacte, true);
    v('analyse : un lot — chaque carte est jugée seule', R.analyseAvecRepli({ statut: 'lot', cartes: [intacte.cartes[0], c] }).cartes.map(x => Boolean(x.prixRepli)), [false, true]);
    v('analyse : null, sans cartes, ou panne rendus tels quels', [R.analyseAvecRepli(null), R.analyseAvecRepli({ statut: 'x' }).statut], [null, 'x']);
    // le câblage : la route sert l'analyse par analyseAvecRepli, la réponse à une question par avecRepliAnalyse, le scanner retire le repli (sansRepli) — le banc des routes (test-prix-repli-routes.js) le prouve de bout en bout pour la réponse et le retour-live
    const src = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    vrai('câblage : identifier/routes.js sert l\'analyse par analyseAvecRepli(resultat.analyse)', /\.\.\.analyseAvecRepli\(resultat\.analyse\)/.test(src('identifier/routes.js')));
    vrai('câblage : identifier/routes.js sert la réponse par avecRepliAnalyse(resolueBrute)', /avecRepliAnalyse\(resolueBrute\)/.test(src('identifier/routes.js')));
    vrai('câblage : scanner/routes.js retire le repli dans sansLive', /const sansLive = k => \{ const s = sansRepli\(k\)/.test(src('scanner/routes.js')));
    vrai('câblage : identifier/retour-live.js joint le repli à la réponse', /\.\.\.avecRepli\(repli\)/.test(src('identifier/retour-live.js')));
    // le scanner ne sert jamais le repli (il n'a aucune lecture live) : sansRepli le retire, et rend la MÊME référence quand il n'y en a pas
    const s = R.sansRepli(e);
    v('scanner : sansRepli retire la clé, le reste est la carte d\'avant', [JSON.stringify(s) === JSON.stringify(c), 'prixRepli' in s], [true, false]);
    v('scanner : sans repli, la même référence (octet pour octet)', [R.sansRepli(c) === c, R.sansRepli(null), R.sansRepli('x')], [true, null, 'x']);
}

// ── 2. l'ANALYSE : la langue non lue (prixLive null) => cause langue-non-lue ; un prix à lire dans l'état => AUCUN repli, octet pour octet
{
    const base = { index: 0, statut: 'identifiee', carte: produit('tauros'), candidats: [], question: null, raison: null, etat: { estime: 'EX', confiance: 'haute', defauts: [], declare: null, retenu: 'EX' }, zone: null };
    const nul = R.avecRepliAnalyse({ ...base, prixLive: null });
    v('prixLive null (langue non lue) : repli tendance, cause langue-non-lue', [nul.prixRepli.repli, nul.prixRepli.cause, nul.prixRepli.fiable], ['tendance', 'langue-non-lue', false]);
    const lisible = { ...base, prixLive: { idProduct: 273844, langues: [1], reverseHolo: false, etatVise: 'EX' } };
    v('un prix à lire dans l\'état (etatVise EX) : la MÊME carte, aucune clé de plus (octet pour octet)', [R.avecRepliAnalyse(lisible) === lisible, JSON.stringify(R.avecRepliAnalyse(lisible)) === JSON.stringify(lisible)], [true, true]);
    for (const [nom, c] of [['a-trancher', { ...base, statut: 'a-trancher', carte: null, prixLive: null }], ['introuvable', { ...base, statut: 'introuvable', carte: null, etat: null, prixLive: null }], ['null', null], ['pas un objet', 'x']])
        v(`${nom} : jamais de repli (seule une carte identifiée en porte)`, R.avecRepliAnalyse(c), c);
    // sans AUCUNE donnée de prix (prixGuide null) : le repli est absent — alors seulement « illisible » est vrai
    const sansGuide = produit('tauros', { prixGuide: { trend: 0, low: 0, avg7: null, avg30: undefined, guideDu: new Date('2026-10-12') } });
    v('fiche sans aucune donnée de prix (guide à zéro) : prixGuide null', sansGuide.prixGuide, null);
    const sg = { ...base, carte: sansGuide, prixLive: { idProduct: 273844, langues: [1], reverseHolo: false, etatVise: null } };
    v('  etatVise null mais aucune donnée de prix : AUCUN repli (la même carte)', R.avecRepliAnalyse(sg) === sg, true);
    const sansDate = produit('tauros', { prixGuide: { trend: 1.49, low: 0.02, avg7: 1.55, avg30: 1.26 } });
    v('guide sans date : prixGuide null, donc aucun repli', [sansDate.prixGuide, R.avecRepliAnalyse({ ...base, carte: sansDate, prixLive: null }).prixRepli], [null, undefined]);
}

// ── 3. le RETOUR-LIVE : Arcanin (prixLive 7,67 d'origine « tendance », ni état ni offre) => le repli « tendance », cause tendance-seule
{
    const g = guideDe('arcanin');
    const r = R.repliRetourLive({ prixGuide: g, retenu: 'NM', originePrix: 'tendance', prixLive: 7.67, prixLiveEtat: null, lectureRatee: null });
    v('Arcanin : tendance seule => repli tendance, cause tendance-seule, fiable false', [r.repli, r.cause, r.fiable], ['tendance', 'tendance-seule', false]);
    v('  le guide du jour (10,18 / 1 / 14,59 / 13,15) et la mention fermée ; aucune offre', [r.guide.tendance, r.guide.de, r.guide.moyenne7, r.guide.moyenne30, r.offre], [10.18, 1, 14.59, 13.15, null]);
    v('  le guide d\'Arcanin écarte la tendance des moyennes de plus de 30 % : il n\'est pas fiable, et le repli le dit', [r.guide.fiable, r.guide.reserves], [false, ['ecart-tendance']]);
    v('  aucun verdict, aucun champ de prix inventé (clés)', cle(r), cle({ repli: 1, cause: 1, fiable: 1, guide: 1, offre: 1 }));
    // lecture ratée (Tauros) : quelle que soit sa cause ou sa définitivité
    const t = guideDe('tauros');
    for (const definitive of [true, false]) {
        const x = R.repliRetourLive({ prixGuide: t, retenu: null, originePrix: null, prixLive: null, prixLiveEtat: null, lectureRatee: { cause: 'sans-prix', definitive } });
        v(`Tauros : lecture ratée (définitive ${definitive}) => repli tendance, cause lecture-ratee`, [x.repli, x.cause, x.fiable, x.guide.tendance, x.guide.moyenne30], ['tendance', 'lecture-ratee', false, 1.49, 1.26]);
    }
    // sans aucune donnée de prix : absent
    v('lecture ratée, fiche sans donnée de prix : aucun repli', R.repliRetourLive({ prixGuide: null, retenu: 'EX', originePrix: null, prixLive: null, prixLiveEtat: null, lectureRatee: { cause: 'grille-vide', definitive: false } }), null);
    v('tendance seule, fiche sans guide : aucun repli (le client a déjà lu la tendance)', R.repliRetourLive({ prixGuide: null, retenu: 'EX', originePrix: 'tendance', prixLive: 7.67, prixLiveEtat: null, lectureRatee: null }), null);
}

// ── 4. le RETOUR-LIVE : l'offre dans l'état le plus proche (envoyée par l'extension) — seulement un état PIRE que l'état retenu
{
    const g = guideDe('tauros');
    const de = (retenu, etat, o = {}) => R.repliRetourLive({ prixGuide: g, retenu, originePrix: 'grille', prixLive: 0.9, prixLiveEtat: etat, lectureRatee: null, ...o });
    const x = de('EX', 'GD');
    v('retenu EX, offre lue en GD (pire) => repli etat-proche, cause offre-autre-etat', [x.repli, x.cause, x.fiable, x.offre], ['etat-proche', 'offre-autre-etat', false, { etat: 'GD', prix: 0.9 }]);
    v('  le guide accompagne l\'offre (aucune donnée perdue)', x.guide, g);
    v('  etat-proche sans guide : l\'offre suffit à faire une donnée de prix', de('EX', 'PL', { prixGuide: null }).guide, null);
    for (const [nom, retenu, etat] of [['NM lu pour EX (mieux)', 'EX', 'NM'], ['EX lu pour EX (dans l\'état)', 'EX', 'EX'], ['MT lu pour NM', 'NM', 'MT']])
        v(`${nom} : c'est un prix dans l'état, AUCUN repli`, de(retenu, etat), null);
    v('état retenu inconnu (null) : on ne peut pas dire « plus proche », aucun repli', de(null, 'GD'), null);
    v('état lu hors liste : aucun repli', de('EX', 'MINT'), null);
    v('état lu absent : aucun repli', de('EX', null), null);
    v('origine plancher-toutes-langues : un prix, pas un repli', de('EX', 'GD', { originePrix: 'plancher-toutes-langues' }), null);
    v('prix non positif / non fini : aucun repli', [de('EX', 'GD', { prixLive: 0 }), de('EX', 'GD', { prixLive: NaN }), de('EX', 'GD', { prixLive: '0,9' })], [null, null, null]);
    v('états en minuscules (comme le journal les range avant normalisation) : normalisés', de('ex', 'gd') && de('ex', 'gd').offre, { etat: 'GD', prix: 0.9 });
}

// ── 5. ce que le serveur sert VALIDE contre le schéma (le champ est fermé : une clé de plus, une valeur hors liste sont refusées)
{
    const ref = n => ({ $ref: `#/components/schemas/${n}` });
    const S = doc.components.schemas;
    vrai('le schéma PrixRepli existe', Boolean(S.PrixRepli));
    if (S.PrixRepli) {
        const g = guideDe('tauros');
        const ok = R.repliRetourLive({ prixGuide: g, retenu: null, originePrix: null, prixLive: null, prixLiveEtat: null, lectureRatee: { cause: 'sans-prix', definitive: true } });
        const ofre = R.repliRetourLive({ prixGuide: g, retenu: 'EX', originePrix: 'grille', prixLive: 0.9, prixLiveEtat: 'GD', lectureRatee: null });
        v('un repli « tendance » valide', valider(JSON.parse(JSON.stringify(ok)), ref('PrixRepli'), doc).ok, true);
        v('un repli « etat-proche » valide', valider(JSON.parse(JSON.stringify(ofre)), ref('PrixRepli'), doc).ok, true);
        const refuse = (nom, abimer) => { const c = JSON.parse(JSON.stringify(ok)); abimer(c); v(`schéma : refusé — ${nom}`, valider(c, ref('PrixRepli'), doc).ok, false); };
        refuse('fiable true', c => { c.fiable = true; });
        refuse('une mention hors liste', c => { c.repli = 'moyenne'; });
        refuse('une cause hors liste', c => { c.cause = 'au-pif'; });
        refuse('un verdict', c => { c.verdict = 'bonne-affaire'; });
        refuse('un champ en trop', c => { c.prix = 1; });
        refuse('un guide sans date', c => { delete c.guide.date; });
        refuse('une clé requise retirée (offre)', c => { delete c.offre; });
        refuse('une offre à état hors liste', c => { c.offre = { etat: 'MINT', prix: 1 }; });
        refuse('une offre à prix nul', c => { c.offre = { etat: 'GD', prix: 0 }; });
        for (const k of ['CarteIdentifiee', 'ReponseRetourLive']) vrai(`${k} déclare prixRepli (facultatif, jamais requis)`, Boolean(S[k].properties.prixRepli) && !S[k].required.includes('prixRepli'));
        // TOUR 1 (M-3) : le schéma DIT les couples que le module produit — et refuse les autres
        refuse('tendance avec un guide nul', c => { c.guide = null; });
        refuse('tendance avec une offre', c => { c.offre = { etat: 'GD', prix: 0.9 }; });
        refuse('tendance avec la cause offre-autre-etat', c => { c.cause = 'offre-autre-etat'; });
        const proche = () => JSON.parse(JSON.stringify(ofre));
        const refuseP = (nom, abimer) => { const c = proche(); abimer(c); v(`schéma : refusé — ${nom}`, valider(c, ref('PrixRepli'), doc).ok, false); };
        refuseP('etat-proche avec une offre nulle', c => { c.offre = null; });
        refuseP('etat-proche avec la cause lecture-ratee', c => { c.cause = 'lecture-ratee'; });
        refuseP('etat-proche avec la cause langue-non-lue', c => { c.cause = 'langue-non-lue'; });
        refuseP('etat-proche qui se dit fiable', c => { c.fiable = true; });
        // toutes les sorties possibles du module valident (chaque cause, avec et sans guide pour l'offre)
        const sorties = [
            ...['langue-non-lue', 'etat-non-retenu'].map(cause => R.depuisGuide(g, cause)),
            R.repliRetourLive({ prixGuide: g, retenu: null, originePrix: null, prixLive: null, lectureRatee: { cause: 'defi', definitive: false } }),
            R.repliRetourLive({ prixGuide: g, retenu: 'NM', originePrix: 'tendance', prixLive: 7.67, lectureRatee: null }),
            R.repliRetourLive({ prixGuide: g, retenu: 'EX', originePrix: 'grille', prixLive: 0.9, prixLiveEtat: 'PO', lectureRatee: null }),
            R.repliRetourLive({ prixGuide: null, retenu: 'EX', originePrix: 'grille', prixLive: 0.9, prixLiveEtat: 'GD', lectureRatee: null })
        ];
        v('le module produit 6 formes, toutes valides contre le schéma à deux formes', [sorties.length, sorties.every(x => x && valider(JSON.parse(JSON.stringify(x)), ref('PrixRepli'), doc).ok)], [6, true]);
    }
}

// ── 6. TOUR 1 (M-1) : l'idProduct CONFIRMÉ par l'analyse, jamais un candidat ni le gagnant du journal
v('idConfirme : une carte identifiée', R.idConfirme({ statut: 'identifiee', idProduct: 273844 }), 273844);
v('idConfirme : une question répondue par un candidat (reponse.idProduct)', R.idConfirme({ statut: 'a-trancher', idProduct: null, reponse: { choix: 'a', idProduct: 273844 } }), 273844);
for (const [nom, e] of [['question en attente', { statut: 'a-trancher', idProduct: null }], ['question abandonnée (ne-sait-pas)', { statut: 'a-trancher', idProduct: null, reponse: { choix: 'ne-sait-pas', idProduct: null } }],
    ['question « aucune »', { statut: 'a-trancher', reponse: { choix: 'aucune', idProduct: null } }], ['introuvable', { statut: 'introuvable', idProduct: null }],
    ['identifiée SANS idProduct entier', { statut: 'identifiee', idProduct: '273844' }], ['réponse sur une carte introuvable', { statut: 'introuvable', reponse: { idProduct: 1 } }],
    ['réponse à idProduct en texte', { statut: 'a-trancher', reponse: { idProduct: '273844' } }], ['null', null], ['pas un objet', 'x']])
    v(`idConfirme : ${nom} => null (aucun produit confirmé, aucun repli)`, R.idConfirme(e), null);

// ── 7. TOUR 1 (M-5) : les réserves du guide voyagent avec le repli (une fiche marquée ne se présente jamais sans elles)
{
    const marque = construireProduit(ligne('tauros', { prixMelangeTampon: true }), { langueInterface: 'fr', cfg });
    const rep = R.avecRepliAnalyse({ index: 0, statut: 'identifiee', carte: marque, candidats: [], question: null, raison: null, etat: null, prixLive: { idProduct: 273844, langues: [1], reverseHolo: false, etatVise: null }, zone: null }).prixRepli;
    v('fiche marquée (prix mélangé) : le repli porte guide.reserves, avec les deux mentions fermées', [rep.guide.fiable, rep.guide.reserves], [false, ['prix-indicatif-tampons-melanges', 'peut-etre-gonfle-par-tampons']]);
    const arc = R.repliRetourLive({ prixGuide: guideDe('arcanin'), retenu: 'NM', originePrix: 'tendance', prixLive: 7.67, lectureRatee: null });
    v('Arcanin : le repli porte guide.reserves (ecart-tendance)', arc.guide.reserves, ['ecart-tendance']);
}

// ── 8. REPLI-QUOTA : LA règle « ce scan affiche un prix », en un seul endroit — (a) la page a rendu un prix, ou (b) un prixRepli non nul est servi
{
    const repliTauros = R.repliRetourLive({ prixGuide: guideDe('tauros'), retenu: null, lectureRatee: { cause: 'sans-prix', definitive: true } });
    v('8a. un repli réel (Tauros, lecture ratée) : le scan AFFICHE un prix', R.afficheUnPrix({ repli: repliTauros }), true);
    v('8b. la page a rendu un prix : le scan affiche un prix', R.afficheUnPrix({ prixRendu: true }), true);
    v('8c. ni prix rendu ni repli : n\'affiche rien (le remboursement d\'avant reste dû)', [R.afficheUnPrix({}), R.afficheUnPrix(), R.afficheUnPrix({ prixRendu: false, repli: null })], [false, false, false]);
    // la fiche sans aucune donnée de prix n'a pas de repli => n'affiche rien (A15 : une carte identifiée sans prixGuide)
    const sansGuide = R.repliRetourLive({ prixGuide: null, retenu: 'EX', lectureRatee: { cause: 'sans-prix', definitive: true } });
    v('8d. A15 : la fiche sans prixGuide n\'a aucun repli, donc n\'affiche aucun prix', [sansGuide, R.afficheUnPrix({ repli: sansGuide })], [null, false]);
    v('8e. l\'analyse d\'une carte sans prixGuide ne reçoit jamais de repli (la même référence rendue)', (() => { const c = { index: 0, statut: 'identifiee', carte: { ...produit('tauros'), prixGuide: null }, prixLive: null }; return R.avecRepliAnalyse(c) === c; })(), true);
    // écrit par ce qu'elle AUTORISE : seul un booléen vrai ou un objet compte
    v('8f. toute autre valeur n\'affiche rien : 1, « oui », [], undefined, 0, {prixRendu: 1}', [R.afficheUnPrix({ prixRendu: 1 }), R.afficheUnPrix({ prixRendu: 'oui' }), R.afficheUnPrix({ repli: [] }), R.afficheUnPrix({ repli: undefined }), R.afficheUnPrix({ repli: 0 }), R.afficheUnPrix({ repli: 'repli' })], [false, false, false, false, false, false]);
    // la raison de non-remboursement est dans la liste fermée de sources.js, donc la facturation l'accepte
    const F = require('../argent/facturation');
    v('8g. « prix-repli » est dans la liste fermée (sources.js) et la facturation l\'accepte', [require('../../sources').RAISONS_NON_REMBOURSE.includes('prix-repli'), F.raisonPublique('prix-repli'), F.facturation({ debite: 1, rembourse: false, motif: 'sans-prix', raisonNonRembourse: 'prix-repli' }).raisonNonRembourse], [true, 'prix-repli', 'prix-repli']);
    v('    la fausse publiée de la réponse non remboursée valide contre ReponseRetourLive', valider(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'openapi', 'fausses', 'retour-live-repli-non-rembourse.json'), 'utf8')), { $ref: '#/components/schemas/ReponseRetourLive' }, doc).ok, true);
}
bilan();
