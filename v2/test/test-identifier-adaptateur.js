'use strict';
// Banc B1a.3 — l'adaptateur : sorties héritées -> trois issues du contrat 2. Une PANNE n'est jamais un « introuvable ».
const fs = require('fs'), path = require('path');
const { v, vrai, bilan } = require('./_harnais');
const { lireConfig } = require('../config');
const { adapter } = require('../identifier/adaptateur');
const { verifierBijection } = require('../identifier/questions');

const cfg = lireConfig({});
const HOTE = 'https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/';
const ligne = (id, o = {}) => ({ idProduct: id, nomCardmarket: 'Eevee', set: { slug: 's' + id, nom: 'Set ' + id }, numero: '12', total: '100', langue: 'EN', variante: null,
    rarete: 'Rare', prixGuide: { trend: 5, low: 4, avg30: 4.5, guideDu: new Date('2026-10-04') }, visuel: { url: `${HOTE}${id}.webp`, w: 255, h: 356 }, ...o });
const produits = new Map([700, 701, 702, 703, 704, 650].map(i => [i, ligne(i)]));
const ctx = (o = {}) => ({ produits, langueInterface: 'fr', cfg, jumeaux: () => ({ conclu: true, ids: [] }), ...o });     // JUMEAU-V2 : sans fournisseur qui conclut, l'adaptateur n'affirme rien (test-jumeaux.js)
const etatH = { estimeIA: 'EX', confianceIA: 'haute', defautsVus: ['coins blanchis'], declareVendeur: 'Bon état', declareCardmarket: 'GD', retenu: 'GD' };
const succes = (o = {}) => ({ success: true, scanId: 's1', question: null, carte: { idProduct: 700, ambigu: false, niveauReserve: null, raisonReserve: null, concurrent: null, nbExAequo: null },
    etat: etatH, candidats: [{ idProduct: 700, score: 9 }], classement: [{ idProduct: 700, score: 9 }], reverse: { attendue: false, strategie: null }, codeLangue: 2, ...o });
const amb = (ids, o = {}) => succes({ carte: { idProduct: ids[0], ambigu: true, niveauReserve: 'forte', raisonReserve: 'x', concurrent: null, nbExAequo: 2 },
    candidats: ids.map(i => ({ idProduct: i })), classement: ids.map(i => ({ idProduct: i, score: 1 })), ...o });
const refus = (motif, nature, o = {}) => ({ success: false, rembourse: true, raisonNonRembourse: null, motifRefus: motif, natureRefus: nature, phraseRefus: 'x', ...o });
// Corps de refus RÉEL de la chaîne héritée, recopié de index.js:4861-4876 (nom-contredit-*) : success, champsDeRefus (rembourse,
// raisonNonRembourse, motifRefus, natureRefus, phraseRefus), error, cardInfo. AUCUN `candidats`. (egalite-parfaite : index.js:5127 en a.)
const refusReel = motif => ({ success: false, rembourse: true, raisonNonRembourse: null, motifRefus: motif, natureRefus: 'refus-delibere',
    phraseRefus: 'Je ne peux pas trancher : plusieurs cartes portent exactement les mêmes indices. Voici ce que ça pourrait être.',
    error: 'Le produit retenu ne porte pas le nom lu sur la carte ("Eevee"), et aucun candidat ne le départage.', cardInfo: { name: 'Eevee', number: '12' } });
const A = (corps, statutHttp = 200, c = ctx()) => adapter({ statutHttp, corps }, c);

// cloisonnement de chaque ligne de la table
const lignes = [
    ['affirmée', A(succes()), 'affirmee', 'identifiee', null],
    ['ambigu à 2', A(amb([701, 700])), 'question', 'a-trancher', null],
    ['ambigu à 3', A(amb([701, 700, 702])), 'question', 'a-trancher', null],
    ['ambigu à 1 seul', A(amb([700])), 'introuvable', 'introuvable', 'photo-illisible'],
    ['ambigu à 4 (3 premiers)', A(amb([704, 703, 702, 701])), 'question', 'a-trancher', null],
    ['numero-illisible', A(refus('numero-illisible', 'refus-delibere')), 'introuvable', 'introuvable', 'photo-illisible'],
    ['carte-introuvable', A(refus('carte-introuvable', 'refus-delibere')), 'introuvable', 'introuvable', 'hors-catalogue'],
    ['aucun-candidat', A(refus('aucun-candidat', 'refus-delibere')), 'introuvable', 'introuvable', 'hors-catalogue'],
    ['aucun-prix', A(refus('aucun-prix', 'refus-delibere')), 'introuvable', 'introuvable', 'hors-catalogue'],
    ['egalite-parfaite >=2', A(refus('egalite-parfaite', 'refus-delibere', { candidats: [{ idProduct: 700 }, { idProduct: 701 }] })), 'question', 'a-trancher', null],
    // I1 : la chaîne RÉELLE n'émet pas `candidats` pour ces deux motifs ; B1b les fournit par le contexte (ctx.candidatsDeRefus)
    ['nom-contredit-egalite, candidats du ctx', A(refusReel('nom-contredit-egalite'), 200, ctx({ candidatsDeRefus: [{ idProduct: 702 }, { idProduct: 700 }, { idProduct: 701 }] })), 'question', 'a-trancher', null],
    // C1 : sans-repli = r.scores vide (index.js:4840), pas d'égalité : jamais une question, même avec des candidats (ils sont déjà contredits)
    ['nom-contredit-sans-repli, candidats du ctx IGNORÉS', A(refusReel('nom-contredit-sans-repli'), 200, ctx({ candidatsDeRefus: [{ idProduct: 700 }, { idProduct: 701 }] })), 'introuvable', 'introuvable', 'photo-illisible'],
    ['nom-contredit-sans-repli, candidats dans le corps IGNORÉS', A(refus('nom-contredit-sans-repli', 'refus-delibere', { candidats: [{ idProduct: 700 }, { idProduct: 701 }] })), 'introuvable', 'introuvable', 'photo-illisible'],
    // C4 : plus de 3 candidats fournis : jamais tronqués en silence -> pas de question
    ['nom-contredit-egalite, 4 candidats du ctx -> pas de question', A(refusReel('nom-contredit-egalite'), 200, ctx({ candidatsDeRefus: [{ idProduct: 700 }, { idProduct: 701 }, { idProduct: 702 }, { idProduct: 703 }] })), 'introuvable', 'introuvable', 'photo-illisible'],
    ['egalite-parfaite, 4 candidats du ctx -> pas de question', A(refusReel('egalite-parfaite'), 200, ctx({ candidatsDeRefus: [{ idProduct: 700 }, { idProduct: 701 }, { idProduct: 702 }, { idProduct: 703 }] })), 'introuvable', 'introuvable', 'photo-illisible'],
    // C3 : un candidat du corps ne fait pas une question ; le ctx complète seulement si l'UNION donne 2 ou 3 distincts
    ['corps 1 candidat + ctx 1 autre -> union 2 : question', A(refus('egalite-parfaite', 'refus-delibere', { candidats: [{ idProduct: 700 }] }), 200, ctx({ candidatsDeRefus: [{ idProduct: 701 }] })), 'question', 'a-trancher', null],
    ['corps 1 candidat + ctx le même -> union 1 : pas de question', A(refus('egalite-parfaite', 'refus-delibere', { candidats: [{ idProduct: 700 }] }), 200, ctx({ candidatsDeRefus: [{ idProduct: 700 }] })), 'introuvable', 'introuvable', 'hors-catalogue'],
    ['corps 1 + ctx 3 autres -> union 4 : pas de question', A(refus('nom-contredit-egalite', 'refus-delibere', { candidats: [{ idProduct: 700 }] }), 200, ctx({ candidatsDeRefus: [{ idProduct: 701 }, { idProduct: 702 }, { idProduct: 703 }] })), 'introuvable', 'introuvable', 'photo-illisible'],
    ['nom-contredit-egalite, candidats dans le corps (accepté)', A(refus('nom-contredit-egalite', 'refus-delibere', { candidats: [{ idProduct: 700 }, { idProduct: 701 }] })), 'question', 'a-trancher', null],
    ['nom-contredit-egalite RÉEL sans candidats (I1b)', A(refusReel('nom-contredit-egalite')), 'introuvable', 'introuvable', 'photo-illisible'],
    ['nom-contredit-sans-repli RÉEL sans candidats (I1b)', A(refusReel('nom-contredit-sans-repli')), 'introuvable', 'introuvable', 'photo-illisible'],
    ['nom-contredit-egalite, 1 candidat du ctx', A(refusReel('nom-contredit-egalite'), 200, ctx({ candidatsDeRefus: [{ idProduct: 700 }] })), 'introuvable', 'introuvable', 'photo-illisible'],
    ['egalite-parfaite, candidats du ctx si le corps n\'en a pas', A(refusReel('egalite-parfaite'), 200, ctx({ candidatsDeRefus: [{ idProduct: 700 }, { idProduct: 701 }] })), 'question', 'a-trancher', null],
    ['egalite-parfaite <2', A(refus('egalite-parfaite', 'refus-delibere', { candidats: [{ idProduct: 700 }] })), 'introuvable', 'introuvable', 'hors-catalogue'],
    ['egalite-parfaite sans candidats', A(refus('egalite-parfaite', 'refus-delibere')), 'introuvable', 'introuvable', 'hors-catalogue']
];
for (const [nom, r, issue, statut, raison] of lignes) {
    v(`${nom} : issue`, r.issue, issue);
    v(`${nom} : statut de la carte`, r.analyse.cartes[0].statut, statut);
    v(`${nom} : raison`, r.analyse.cartes[0].raison, raison);
    v(`${nom} : statut d'ensemble = statut de la carte`, r.analyse.statut, statut);
    vrai(`${nom} : pas d'erreur`, r.erreur === undefined);
}

// pannes : code d'erreur
const pannes = [
    ['ia-echec', A(refus('ia-echec', 'echec-technique')), 'IA'],
    ['tcgdex-injoignable', A(refus('tcgdex-injoignable', 'echec-technique')), 'INDISPONIBLE'],
    ['absence requalifiée carte-introuvable', A(refus('carte-introuvable', 'echec-technique')), 'INDISPONIBLE'],
    ['absence requalifiée aucun-candidat', A(refus('aucun-candidat', 'echec-technique')), 'INDISPONIBLE'],
    ['erreur-serveur', A(refus('erreur-serveur', 'echec-technique')), 'SERVEUR'],
    ['HTTP 500', A(succes(), 500), 'SERVEUR'],
    ['HTTP 503', A(refus('numero-illisible', 'refus-delibere'), 503), 'SERVEUR'],
    ['HTTP 404 (hors table)', A(succes(), 404), 'SERVEUR'],
    ['corps null', A(null), 'SERVEUR'],
    ['corps texte', A('<html>'), 'SERVEUR'],
    ['success ni vrai ni faux', A({ success: 'oui' }), 'SERVEUR'],
    ['success absent', A({}), 'SERVEUR'],
    ['motif inconnu', A(refus('motif-neuf', 'refus-delibere')), 'SERVEUR'],
    ['motif inconnu en technique', A(refus('motif-neuf', 'echec-technique')), 'SERVEUR'],
    ['nature inconnue', A(refus('numero-illisible', 'bizarre')), 'SERVEUR'],
    ['nature absente', A(refus('numero-illisible', undefined)), 'SERVEUR'],
    ['ia-echec déclaré « refus délibéré » (incohérent)', A(refus('ia-echec', 'refus-delibere')), 'SERVEUR'],
    ['numero-illisible déclaré technique (incohérent)', A(refus('numero-illisible', 'echec-technique')), 'SERVEUR'],
    ['identifiée sans idProduct', A(succes({ carte: { idProduct: null, ambigu: false } })), 'SERVEUR'],
    ['identifiée : ambigu absent', A(succes({ carte: { idProduct: 700 } })), 'SERVEUR'],
    ['identifiée : idProduct hors ctx.produits (on n\'invente pas)', A(succes({ carte: { idProduct: 999999, ambigu: false } })), 'SERVEUR'],
    ['ambigu : candidat hors ctx.produits', A(amb([700, 999999])), 'SERVEUR'],
    ['refus à 2 candidats dont un hors ctx.produits', A(refus('egalite-parfaite', 'refus-delibere', { candidats: [{ idProduct: 700 }, { idProduct: 999999 }] })), 'SERVEUR'],
    ['identifiée : carte.idProduct != candidats[0] (recoupement)', A(succes({ carte: { idProduct: 700, ambigu: false }, candidats: [{ idProduct: 701 }] })), 'SERVEUR'],
    ['candidat du ctx hors ctx.produits', A(refusReel('nom-contredit-egalite'), 200, ctx({ candidatsDeRefus: [{ idProduct: 700 }, { idProduct: 999999 }] })), 'SERVEUR'],
    ['ctx.produits absent', adapter({ statutHttp: 200, corps: succes() }, { langueInterface: 'fr', cfg }), 'SERVEUR']
];
for (const [nom, r, code] of pannes) {
    v(`panne ${nom} : issue`, r.issue, 'panne');
    v(`panne ${nom} : erreur.code`, r.erreur && r.erreur.code, code);
    v(`panne ${nom} : aucune carte affirmée ni introuvable`, r.analyse, null);
}

// (1) propriété : aucun introuvable n'a natureRefus technique
{
    const motifs = ['numero-illisible', 'carte-introuvable', 'aucun-candidat', 'aucun-prix', 'egalite-parfaite', 'nom-contredit-egalite', 'nom-contredit-sans-repli', 'ia-echec', 'tcgdex-injoignable', 'erreur-serveur', 'inconnu'];
    let n = 0, ko = 0;
    for (const m of motifs) for (const nat of ['refus-delibere', 'echec-technique', undefined, 'x']) for (const nc of [0, 1, 2]) {
        const c = refus(m, nat, { candidats: [700, 701].slice(0, nc).map(i => ({ idProduct: i })) });
        const r = A(c); n++;
        if (nat !== 'refus-delibere' && r.issue !== 'panne') ko++;
        if (r.issue === 'introuvable' && c.natureRefus === 'echec-technique') ko++;
    }
    v(`propriété : ${n} combinaisons, aucune panne prise pour un introuvable ni pour une issue`, ko, 0);
}

// (2) formes par issue
{
    const id = A(succes()).analyse.cartes[0];
    vrai('identifiée : carte non nulle, candidats [], question null', id.carte && id.carte.idProduct === 700 && id.candidats.length === 0 && id.question === null);
    const r = A(amb([702, 700, 701])); const t = r.analyse.cartes[0];
    vrai('a-trancher : carte null, 3 candidats, question', t.carte === null && t.candidats.length === 3 && t.question && r.question === t.question);
    vrai('a-trancher : chaque choix désigne exactement un candidat', verifierBijection(t.question, t.candidats));
    const i = A(refus('aucun-candidat', 'refus-delibere')).analyse.cartes[0];
    vrai('introuvable : carte, question null, candidats [], etat null', i.carte === null && i.question === null && i.candidats.length === 0 && i.etat === null);
    v('introuvable : prixLive null, zone null', [i.prixLive, i.zone], [null, null]);
    v('analyse d\'ensemble : raison de l\'introuvable', A(refus('aucun-candidat', 'refus-delibere')).analyse.raison, 'hors-catalogue');
    v('analyse : lot null', A(succes()).analyse.lot, null);
    v('analyse identifiée : raison null', A(succes()).analyse.raison, null);
    v('analyse : clés', Object.keys(A(succes()).analyse), ['statut', 'cartes', 'lot', 'raison']);
    v('carte : clés', Object.keys(id), ['index', 'statut', 'carte', 'candidats', 'question', 'raison', 'etat', 'prixLive', 'zone']);
    v('index 0', id.index, 0);
    v('issue identifiée : pas de question', A(succes()).question, undefined);
}
// plus de 3 : les 3 premiers du classement
{
    const t = A(amb([704, 703, 702, 701])).analyse.cartes[0];
    v('4 candidats -> les 3 premiers du classement (ids 704,703,702)', t.candidats.map(c => c.idProduct).sort(), [702, 703, 704]);
}
// (8) ordre = choixPour (idProduct croissant), pas classement
{
    const t = A(amb([702, 700, 701])).analyse.cartes[0];
    v('ordre des candidats = idProduct croissant', t.candidats.map(c => c.idProduct), [700, 701, 702]);
    v('ordre des choix = idProduct croissant', t.question.choix.map(c => c.idProduct), [700, 701, 702]);
}
// doublons dans les candidats hérités
{
    const t = A(amb([700, 700, 701]));
    v('doublon d\'idProduct dédoublonné', t.analyse.cartes[0].candidats.length, 2);
    v('un seul candidat distinct -> introuvable photo-illisible', A(amb([700, 700])).analyse.cartes[0].raison, 'photo-illisible');
}
// (3) état
{
    const e = A(succes()).analyse.cartes[0].etat;
    v('etat complet', e, { estime: 'EX', confiance: 'haute', defauts: ['coins blanchis'], declare: 'Bon état', retenu: 'GD' });
    const bad = A(succes({ etat: { ...etatH, estimeIA: 'XX', retenu: 'Mint', confianceIA: 0.97 } })).analyse.cartes[0].etat;
    v('état hors MT NM EX GD LP PL PO -> null', [bad.estime, bad.retenu], [null, null]);
    v('confiance chiffrée -> null', bad.confiance, null);
    for (const c of ['haute', 'moyenne', 'basse']) v(`confiance ${c}`, A(succes({ etat: { ...etatH, confianceIA: c } })).analyse.cartes[0].etat.confiance, c);
    v('confiance inconnue -> null', A(succes({ etat: { ...etatH, confianceIA: 'tres-haute' } })).analyse.cartes[0].etat.confiance, null);
    const longs = A(succes({ etat: { ...etatH, defautsVus: Array.from({ length: 15 }, (_, i) => 'd' + i).concat([{ x: 1 }, 'y'.repeat(300)]) } })).analyse.cartes[0].etat.defauts;
    v('défauts : 10 au plus', longs.length, 10);
    const tronques = A(succes({ etat: { ...etatH, defautsVus: ['y'.repeat(300), 5, null] } })).analyse.cartes[0].etat.defauts;
    v('défauts : texte seulement, <= 200 car.', tronques.map(x => x.length), [200]);
    v('etat absent d\'une identifiée -> tout null', A(succes({ etat: undefined })).analyse.cartes[0].etat, { estime: null, confiance: null, defauts: [], declare: null, retenu: null });
    vrai('a-trancher porte un etat', A(amb([700, 701])).analyse.cartes[0].etat.estime === 'EX');
}
// (4) prixLive
{
    v('prixLive identifiée', A(succes()).analyse.cartes[0].prixLive, { idProduct: 700, langues: [2], reverseHolo: false, etatVise: 'GD' });
    v('chinois -> [6, 11]', A(succes({ codeLangue: 6 })).analyse.cartes[0].prixLive.langues, [6, 11]);
    v('filtre-url -> reverseHolo', A(succes({ reverse: { strategie: 'filtre-url' } })).analyse.cartes[0].prixLive.reverseHolo, true);
    v('produit-distinct -> reverseHolo false', A(succes({ reverse: { strategie: 'produit-distinct' } })).analyse.cartes[0].prixLive.reverseHolo, false);
    v('reverse absent -> false', A(succes({ reverse: undefined })).analyse.cartes[0].prixLive.reverseHolo, false);
    v('codeLangue sur carte (brief) accepté', A(succes({ codeLangue: undefined, carte: { idProduct: 700, ambigu: false, codeLangue: 7 } })).analyse.cartes[0].prixLive.langues, [7]);
    v('codeLangue illisible -> prixLive null (rien d\'affirmé)', A(succes({ codeLangue: 'fr' })).analyse.cartes[0].prixLive, null);
    v('a-trancher : prixLive null', A(amb([700, 701])).analyse.cartes[0].prixLive, null);
}
// (5) zone null partout
{
    const tous = [A(succes()), A(amb([700, 701])), A(refus('aucun-candidat', 'refus-delibere'))];
    v('zone null partout', tous.map(r => r.analyse.cartes[0].zone), [null, null, null]);
}
// (6) aucun champ hérité ne fuit
{
    const interdits = ['ambigu', 'niveauReserve', 'raisonReserve', 'concurrent', 'nbExAequo', 'classement', 'score', 'concurrentIdProduct', 'sourceIdentification', 'candidatsRendus'];
    const fuites = (o, chemin, acc) => {
        if (Array.isArray(o)) o.forEach((x, i) => fuites(x, chemin + '[' + i + ']', acc));
        else if (o && typeof o === 'object') for (const k of Object.keys(o)) {
            if (interdits.includes(k)) acc.push(chemin + '.' + k);
            if (k === 'confiance' && !chemin.endsWith('.etat')) acc.push(chemin + '.confiance');
            if (k === 'confiance' && o[k] !== null && typeof o[k] !== 'string') acc.push(chemin + '.confiance(chiffrée)');
            fuites(o[k], chemin + '.' + k, acc);
        }
        return acc;
    };
    const sorties = { id: A(succes()), tr: A(amb([700, 701, 702])), refus: A(refus('aucun-candidat', 'refus-delibere')), panne: A(refus('ia-echec', 'echec-technique')) };
    for (const [n, r] of Object.entries(sorties)) v(`aucune fuite héritée (${n})`, fuites(r, 'r', []), []);
    // le détecteur sait dire oui
    v('le détecteur voit une fuite fabriquée', fuites({ a: { ambigu: true, b: [{ score: 1 }] } }, 'r', []).length, 2);
}
// (7) produit inconnu déjà couvert en pannes. Produit de la carte : forme du contrat
{
    const p = A(succes(), 200, ctx({ langueInterface: 'fr' })).analyse.cartes[0].carte;
    v('carte = Produit du contrat (nom, guide daté)', [p.idProduct, p.prixGuide.date], [700, '2026-10-04']);
}
// (10) vecteurs de l'extension : mêmes ensembles de clés
{
    const dossier = 'C:/Users/Yung/Desktop/extension v2/src/fond/fausses';
    const lire = f => JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8'));
    let present = true; try { lire('identifiee.json'); } catch { present = false; }
    if (!present) { console.log(`❌ vecteurs de l'extension absents (${dossier}) : le banc ne peut pas conclure`); process.exitCode = 1; }
    else {
        const cles = o => Object.keys(o).sort();
        // écarts DOCUMENTÉS (CONTRAT-2 fait foi) : moyenne30 et impressions absents des fausses réponses de l'extension
        const ECART_PRODUIT = ['impressions'];
        const compare = (nom, mien, leur, ecarts = []) => {
            const m = cles(mien).filter(k => !ecarts.includes(k)), l = cles(leur).filter(k => !ecarts.includes(k));
            v(`vecteur ${nom} : mêmes clés`, m, l);
        };
        const comparerCarte = (nom, mienne, fausse) => {
            compare(`${nom} carte`, mienne, fausse);
            for (const k of ['etat', 'prixLive']) if (fausse[k] && mienne[k]) { compare(`${nom} ${k}`, mienne[k], fausse[k]); }
            if (fausse.carte && mienne.carte) {
                compare(`${nom} Produit`, mienne.carte, fausse.carte, ECART_PRODUIT);
                compare(`${nom} Produit.set`, mienne.carte.set, fausse.carte.set);
                compare(`${nom} Produit.liens`, mienne.carte.liens, fausse.carte.liens);
            }
            if (fausse.candidats.length) {
                v(`vecteur ${nom} : nombre de candidats`, mienne.candidats.length, fausse.candidats.length);
                compare(`${nom} candidat`, mienne.candidats[0], fausse.candidats[0], ECART_PRODUIT);
                compare(`${nom} question`, mienne.question, fausse.question);
                compare(`${nom} choix`, mienne.question.choix[0], fausse.question.choix[0]);
            }
        };
        const idf = lire('identifiee.json').analyse.cartes[0];
        comparerCarte('identifiee', A(succes()).analyse.cartes[0], idf);
        v('vecteur identifiee : type de prixGuide.tendance', typeof A(succes()).analyse.cartes[0].carte.prixGuide.tendance, typeof idf.carte.prixGuide.tendance);
        v('vecteur identifiee : types de etat', [typeof A(succes()).analyse.cartes[0].etat.defauts, typeof A(succes()).analyse.cartes[0].etat.confiance], [typeof idf.etat.defauts, typeof idf.etat.confiance]);
        comparerCarte('a-trancher-2', A(amb([700, 701])).analyse.cartes[0], lire('a-trancher-2.json').analyse.cartes[0]);
        comparerCarte('a-trancher-3', A(amb([700, 701, 702])).analyse.cartes[0], lire('a-trancher-3.json').analyse.cartes[0]);
        const intr = lire('introuvable.json').analyse.cartes[0];
        // ÉCART NOTÉ : la fausse réponse « introuvable » porte un objet etat ; CONTRAT-2 §3.1 dit null. Le contrat fait foi.
        compare('introuvable carte', A(refus('numero-illisible', 'refus-delibere')).analyse.cartes[0], intr);
        v('vecteur introuvable : clés de analyse', cles(A(refus('numero-illisible', 'refus-delibere')).analyse), cles(lire('introuvable.json').analyse).filter(k => k !== 'regleVerdict'));
        v('écart connu : etat d\'un introuvable (contrat = null, fausse réponse = objet)', [A(refus('numero-illisible', 'refus-delibere')).analyse.cartes[0].etat, typeof intr.etat], [null, 'object']);
    }
}
bilan();
