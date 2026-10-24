'use strict';
// Les fausses réponses PUBLIÉES et les exemples de CONTRAT-API-V2.md valident contre le schéma — et le schéma SAIT REFUSER.
const fs = require('fs'), path = require('path');
const H = require('./_harnais');
const { valider } = require('../openapi/valider');
const { CODES } = require('../erreurs');

const RACINE = path.join(__dirname, '..', '..');
const DOSSIER = path.join(__dirname, '..', 'openapi', 'fausses');
const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'openapi', 'openapi.v2.json'), 'utf8'));
const S = doc.components.schemas;
const ref = n => ({ $ref: `#/components/schemas/${n}` });
const lire = f => JSON.parse(fs.readFileSync(path.join(DOSSIER, f), 'utf8'));

// ── 1. l'index et le dossier se correspondent ──
const index = lire('_index.json');
const fichiers = fs.readdirSync(DOSSIER).filter(f => f.endsWith('.json') && f !== '_index.json').sort();
H.v('chaque fausse est dans _index.json et réciproquement', { horsIndex: fichiers.filter(f => !index[f]), sansFichier: Object.keys(index).filter(f => !fichiers.includes(f)) }, { horsIndex: [], sansFichier: [] });
console.log(`   ${fichiers.length} fausses réponses publiées`);
H.vrai('au moins 40 fausses (une par état)', fichiers.length >= 40);
{ // BANC-EXTENSION : le contrat nomme `grilleLive` (la forme de la requête du prix lu) dans la section du retour de l'extension
    const t = fs.readFileSync(path.join(RACINE, 'CONTRAT-API-V2.md'), 'utf8'), debut = t.indexOf('### 1.4 Le retour du prix lu'), fin = t.indexOf('\n### ', debut + 10);
    H.vrai('CONTRAT-API-V2.md §1.4 décrit `grilleLive` (nom, états, valeur strictement positive)', debut > 0 && /`grilleLive`/.test(t.slice(debut, fin)) && /strictement positi/i.test(t.slice(debut, fin)));
}

// ── 2. chacune valide contre SON schéma ET contre le schéma que le chemin documente pour ce statut ──
function schemaDuChemin(route, statut) {
    const [methode, chemin] = route.split(' ');
    const r = (((doc.paths[chemin] || {})[methode.toLowerCase()] || {}).responses || {})[String(statut)];
    return r && r.content && r.content['application/json'] ? r.content['application/json'].schema : undefined;
}
let nbValides = 0;
for (const f of fichiers) {
    const meta = index[f], corps = lire(f);
    const r1 = valider(corps, ref(meta.schema), doc);
    const sCh = schemaDuChemin(meta.route, meta.statut);
    const r2 = sCh ? valider(corps, sCh, doc) : { ok: false, erreurs: [{ chemin: '$', message: `le chemin ${meta.route} ne documente pas le statut ${meta.statut}` }] };
    const ok = r1.ok && r2.ok;
    if (ok) nbValides++;
    H.vrai(`${f} valide contre ${meta.schema} et contre ${meta.route} → ${meta.statut}${ok ? '' : ' : ' + JSON.stringify([...r1.erreurs, ...r2.erreurs].slice(0, 3))}`, ok);
}
H.v(`dénominateur : ${nbValides} valides sur ${fichiers.length}`, nbValides, fichiers.length);

// ── 3. valeurs FICTIVES : aucune ne passe pour un vrai produit, un vrai scan ou une vraie image ──
const idsReels = [], urlsHorsFictif = [], scansNonFictifs = [];
(function parcourir(x, nom) {
    if (Array.isArray(x)) return x.forEach(y => parcourir(y, nom));
    if (x && typeof x === 'object') return Object.entries(x).forEach(([k, v]) => parcourir(v, k));
    if (nom === 'idProduct' && !(x >= 9000000)) idsReels.push(x);
    if (nom === 'url' && typeof x === 'string' && x.includes('r2.dev') && !x.includes('/fictif/')) urlsHorsFictif.push(x);
    if (nom === 'scanId' && !String(x).startsWith('fausse-')) scansNonFictifs.push(x);
})(fichiers.map(lire), null);
H.v('tout idProduct est >= 9 000 000', idsReels, []);
H.v('toute image est sous /fictif/', urlsHorsFictif, []);
H.v('tout scanId commence par « fausse- »', scansNonFictifs, []);

// ── 4. couverture : une fausse par état demandé, et toutes les valeurs des listes fermées y figurent ──
const REQUISES = ['identifiee', 'a-trancher-1', 'a-trancher-2', 'a-trancher-3', 'lot', 'panne-ia', 'panne-indisponible', 'panne-serveur', 'quota-compte', 'quota-installation', 'verification',
    'cle-reutilisee-identifier', 'cle-reutilisee-reponse', 'cle-reutilisee-retour-live', 'debit', 'cle-en-cours-reponse', 'cle-en-cours-retour-live',
    'question-repondue', 'question-abandonnee-aucune', 'question-abandonnee-ne-sait-pas', 'solde-installation-non-liee', 'solde-installation-liee', 'solde-compte-non-verifie', 'solde-abonnement'];
H.v('états demandés présents', REQUISES.filter(n => !fichiers.includes(`${n}.json`)), []);
const motsRaisons = ['photo-illisible', 'pas-une-carte', 'hors-catalogue', 'plusieurs-cartes-non-separees', 'panne-lecture', 'impression-indeterminee'];
H.v('une fausse introuvable par valeur de la liste fermée des raisons', motsRaisons.filter(r => !fichiers.includes(`introuvable-${r}.json`)), []);
const tout = fichiers.map(f => JSON.stringify(lire(f))).join('\n');
const motifs = S.Facturation.properties.motif.enum;
H.v('chaque motif de facturation apparaît dans une fausse', motifs.filter(m => !tout.includes(`"motif":"${m}"`) && !tout.includes(`"motif": "${m}"`)), []);
H.v('chaque raison apparaît dans une fausse', motsRaisons.filter(r => !tout.includes(`"raison":"${r}"`)), []);
H.vrai('une fausse porte un solde abonnement non nul', fichiers.some(f => lire(f).solde && lire(f).solde.abonnement));

// ── 5. LE SCHÉMA SAIT REFUSER (état fabriqué : on abîme une fausse valide, le validateur doit dire NON) ──
const base = lire('identifiee.json');
const clone = o => JSON.parse(JSON.stringify(o));
const refuse = (nom, abimer, schema = 'ReponseAnalyse', base0 = base) => { const c = clone(base0); abimer(c); const r = valider(c, ref(schema), doc); H.vrai(`refusée : ${nom}${r.ok ? '' : ' → ' + r.erreurs[0].chemin}`, !r.ok); return r; };
H.v('contrôle : la fausse saine est acceptée', valider(base, ref('ReponseAnalyse'), doc).ok, true);
let r = refuse('un score ajouté à la réponse', c => { c.score = 0.97; });
H.v('  le chemin du score', r.erreurs.map(e => e.chemin), ['$.score']);
r = refuse('une confiance chiffrée (première maquette du scanner)', c => { c.analyse.cartes[0].etat.confiance = 0.97; });
H.vrai('  le chemin de la confiance (nommé par la branche la plus proche du oneOf)', r.erreurs[0].message.includes('$.analyse.cartes[0].etat.confiance'));
refuse('un champ en trop dans le Produit', c => { c.analyse.cartes[0].carte.classement = 1; });
refuse('un champ hérité qui fuit (niveauReserve)', c => { c.analyse.cartes[0].niveauReserve = 'haut'; });
refuse('le motif retiré code-maitre', c => { c.facturation.motif = 'code-maitre'; });
refuse('un statut « sous réserve »', c => { c.analyse.cartes[0].statut = 'sous-reserve'; });
refuse('un statut d\'analyse inconnu', c => { c.analyse.statut = 'peut-etre'; });
refuse('une variante hors liste', c => { c.analyse.cartes[0].carte.variante = 'V2'; });
refuse('une raison hors liste (sur un introuvable)', c => { Object.assign(c.analyse.cartes[0], lire('introuvable-hors-catalogue.json').analyse.cartes[0], { raison: 'trop-flou' }); });
refuse('une identifiée sans carte', c => { c.analyse.cartes[0].carte = null; });
refuse('une identifiée avec des candidats', c => { c.analyse.cartes[0].candidats = [c.analyse.cartes[0].carte]; });
refuse('un état Cardmarket inconnu', c => { c.analyse.cartes[0].etat.estime = 'MINT'; });
refuse('une image Cardmarket', c => { c.analyse.cartes[0].carte.visuel.url = 'https://www.cardmarket.com/img/x.jpg'; });
refuse('une image en http', c => { c.analyse.cartes[0].carte.visuel.url = c.analyse.cartes[0].carte.visuel.url.replace('https', 'http'); });
refuse('une clé requise retirée (reserve)', c => { delete c.facturation.reserve; });
refuse('l\'ancienne forme de solde (soldeGratuit)', c => { c.solde.soldeGratuit = 17; });
refuse('un solde sans essai', c => { delete c.solde.essai; });
refuse('un contrat différent de 2', c => { c.contrat = 3; });
refuse('un prixGuide sans date', c => { delete c.analyse.cartes[0].carte.prixGuide.date; });
refuse('liens.cardmarket numérique', c => { c.analyse.cartes[0].carte.liens.cardmarket = 12; });
const tr = lire('a-trancher-3.json');
refuse('un a-trancher sans aucun candidat', c => { c.analyse.cartes[0].candidats.length = 0; }, 'ReponseAnalyse', tr);
{ // UN-CANDIDAT (D1) : un candidat unique est permis, avec UN choix ; la fausse publiée le montre
    const un = lire('a-trancher-1.json');
    H.v('a-trancher-1 : un candidat, une question `confirmation` à un choix', [un.analyse.cartes[0].candidats.length, un.analyse.cartes[0].question.code, un.analyse.cartes[0].question.choix.length], [1, 'confirmation', 1]);
    refuse('une confirmation sans choix', c => { c.analyse.cartes[0].question.choix.length = 0; }, 'ReponseAnalyse', un);
    refuse('un code de question hors liste', c => { c.analyse.cartes[0].question.code = 'peut-etre'; }, 'ReponseAnalyse', un);
}
refuse('un a-trancher à quatre candidats', c => { const x = c.analyse.cartes[0]; x.candidats.push(clone(x.candidats[0])); }, 'ReponseAnalyse', tr);
refuse('un a-trancher avec une carte', c => { c.analyse.cartes[0].carte = c.analyse.cartes[0].candidats[0]; }, 'ReponseAnalyse', tr);
refuse('un a-trancher sans question', c => { c.analyse.cartes[0].question = null; }, 'ReponseAnalyse', tr);
refuse('un code de question inconnu', c => { c.analyse.cartes[0].question.code = 'prix'; }, 'ReponseAnalyse', tr);
refuse('un identifiant de choix inconnu', c => { c.analyse.cartes[0].question.choix[0].id = 'z'; }, 'ReponseAnalyse', tr);
{ // F4-PRIX : les champs de prix fermés — la fausse publiée les montre, et le schéma REFUSE ce qui sort de la liste
    const pi = lire('identifiee-prix-incertains.json'), c0 = pi.analyse.cartes[0];
    H.v('F4 : la fausse porte un prix non fiable (ecart-tendance), un prix mélangé (deux mentions), deux impressions V1/V2 du même set et numéro, un badge par le nom, ecartTendanceMax',
        [c0.carte.prixGuide.fiable, c0.carte.prixGuide.reserves, c0.carte.impressions[2].prixGuide.reserves, c0.carte.impressions.slice(0, 2).map(i => [i.numero, i.total, i.set.nom, i.version]), c0.carte.set.badgeSource, pi.analyse.regleVerdict.ecartTendanceMax],
        [false, ['ecart-tendance'], ['prix-indicatif-tampons-melanges', 'peut-etre-gonfle-par-tampons'], [['15', '147', 'Victoires Fictives', 'V1'], ['15', '147', 'Victoires Fictives', 'V2']], 'nom', 0.3]);
    H.v('contrôle : la fausse saine est acceptée', valider(pi, ref('ReponseAnalyse'), doc).ok, true);
    refuse('une réserve hors liste (peut-etre-cher)', c => { c.analyse.cartes[0].carte.prixGuide.reserves.push('peut-etre-cher'); }, 'ReponseAnalyse', pi);
    refuse('un deBase hors liste (etat-retenu : le guide n\'a aucun prix par état)', c => { c.analyse.cartes[0].carte.prixGuide.deBase = 'etat-retenu'; }, 'ReponseAnalyse', pi);
    refuse('un deBase nul', c => { c.analyse.cartes[0].carte.prixGuide.deBase = null; }, 'ReponseAnalyse', pi);
    refuse('fiable en texte', c => { c.analyse.cartes[0].carte.prixGuide.fiable = 'non'; }, 'ReponseAnalyse', pi);
    refuse('une version qui n\'est pas V<n> (reverse)', c => { c.analyse.cartes[0].carte.impressions[0].version = 'reverse'; }, 'ReponseAnalyse', pi);
    refuse('une version en minuscule (v2)', c => { c.analyse.cartes[0].carte.version = 'v2'; }, 'ReponseAnalyse', pi);
    refuse('un badgeSource hors liste (sigle)', c => { c.analyse.cartes[0].carte.set.badgeSource = 'sigle'; }, 'ReponseAnalyse', pi);
    refuse('un ecartTendanceMax au-delà de 1', c => { c.analyse.regleVerdict.ecartTendanceMax = 30; }, 'ReponseAnalyse', pi);
    refuse('une moyenne7 négative', c => { c.analyse.cartes[0].carte.prixGuide.moyenne7 = -1; }, 'ReponseAnalyse', pi);
    refuse('un champ interne qui fuit dans le prix (prixMelangeTampon)', c => { c.analyse.cartes[0].carte.prixGuide.prixMelangeTampon = true; }, 'ReponseAnalyse', pi);
    refuse('un champ interne qui fuit sur le Produit (tamponsConnus)', c => { c.analyse.cartes[0].carte.tamponsConnus = ['staff']; }, 'ReponseAnalyse', pi);
}
{ // PRIX-LISIBLE : le repli honnête — les fausses publiées le montrent (analyse et retour-live), et le schéma REFUSE ce qui sort de la liste
    const pr = lire('identifiee-prix-repli.json'), c0 = pr.analyse.cartes[0], rl = lire('retour-live-prix-repli.json');
    H.v('PRIX-LISIBLE : l\'analyse porte etatVise null ET le repli tendance / etat-non-retenu / fiable false, sans offre', [c0.prixLive.etatVise, c0.prixRepli.repli, c0.prixRepli.cause, c0.prixRepli.fiable, c0.prixRepli.offre], [null, 'tendance', 'etat-non-retenu', false, null]);
    H.v('PRIX-LISIBLE : le retour-live porte le repli tendance / tendance-seule, et le guide non fiable (ecart-tendance)', [rl.prixRepli.repli, rl.prixRepli.cause, rl.prixRepli.fiable, rl.prixRepli.guide.reserves], ['tendance', 'tendance-seule', false, ['ecart-tendance']]);
    H.v('contrôle : les deux fausses saines sont acceptées', [valider(pr, ref('ReponseAnalyse'), doc).ok, valider(rl, ref('ReponseRetourLive'), doc).ok], [true, true]);
    refuse('un repli qui se dit fiable', c => { c.analyse.cartes[0].prixRepli.fiable = true; }, 'ReponseAnalyse', pr);
    refuse('une mention de repli hors liste', c => { c.analyse.cartes[0].prixRepli.repli = 'moyenne'; }, 'ReponseAnalyse', pr);
    refuse('un verdict dans le repli', c => { c.analyse.cartes[0].prixRepli.verdict = 'bonne-affaire'; }, 'ReponseAnalyse', pr);
    refuse('un repli nul (la clé est absente, jamais nulle)', c => { c.analyse.cartes[0].prixRepli = null; }, 'ReponseAnalyse', pr);
    refuse('un repli sur une carte à trancher', c => { Object.assign(c.analyse.cartes[0], lire('a-trancher-2.json').analyse.cartes[0], { prixRepli: pr.analyse.cartes[0].prixRepli }); }, 'ReponseAnalyse', pr);
    refuse('un retour-live avec une cause de repli hors liste', c => { c.prixRepli.cause = 'au-pif'; }, 'ReponseRetourLive', rl);
    refuse('un retour-live avec un repli sans guide ni offre (clés requises)', c => { delete c.prixRepli.guide; }, 'ReponseRetourLive', rl);
    // TOUR 1 (M-3) : les COUPLES repli / cause / guide / offre sont dits par le schéma (deux formes exclusives)
    refuse('repli tendance avec un guide NUL', c => { c.prixRepli.guide = null; }, 'ReponseRetourLive', rl);
    refuse('repli tendance avec une offre', c => { c.prixRepli.offre = { etat: 'GD', prix: 0.9 }; }, 'ReponseRetourLive', rl);
    refuse('repli tendance avec la cause de l\'autre forme (offre-autre-etat)', c => { c.prixRepli.cause = 'offre-autre-etat'; }, 'ReponseRetourLive', rl);
    refuse('repli etat-proche avec une offre NULLE', c => { c.prixRepli.repli = 'etat-proche'; c.prixRepli.cause = 'offre-autre-etat'; c.prixRepli.offre = null; }, 'ReponseRetourLive', rl);
    refuse('repli etat-proche avec la cause langue-non-lue', c => { c.prixRepli.repli = 'etat-proche'; c.prixRepli.cause = 'langue-non-lue'; c.prixRepli.offre = { etat: 'GD', prix: 0.9 }; }, 'ReponseRetourLive', rl);
    { const ok = clone(rl); ok.prixRepli = { repli: 'etat-proche', cause: 'offre-autre-etat', fiable: false, guide: null, offre: { etat: 'GD', prix: 0.9 } };
      H.v('contrôle : un etat-proche à offre non nulle (guide nul permis) est accepté', valider(ok, ref('ReponseRetourLive'), doc).ok, true); }
}
{ // LOT-SANS-PRIX : un lot dont aucune carte n'affiche de prix est rendu en entier ; la fausse le montre, et le schéma REFUSE ce qui sort des listes fermées
    const ls = lire('lot-sans-prix.json'), lt = lire('lot.json');
    H.v('LOT-SANS-PRIX : 3 cartes identifiées, aucune ne porte de prix (prixGuide null, pas de clé prixRepli, prixLive null : langue non lue), compte du lot cohérent',
        [ls.analyse.statut, ls.analyse.cartes.map(c => [c.statut, c.carte.prixGuide, 'prixRepli' in c, c.prixLive]), ls.analyse.lot], ['lot', [['identifiee', null, false, null], ['identifiee', null, false, null], ['identifiee', null, false, null]], { cartesVues: 3, identifiees: 3, aTrancher: 0, introuvables: 0, lectureLiveMax: 5 }]);
    H.v('LOT-SANS-PRIX : le lot est rendu en entier — { debite 0, rembourse true, motif sans-prix, raisonNonRembourse null, poche jour } et offre.restant remonté', [ls.facturation, ls.offre.restant], [{ debite: 0, reserve: 0, rembourse: true, motif: 'sans-prix', raisonNonRembourse: null, poche: 'jour' }, 10]);
    H.v('contrôle : le lot de 4 cartes AU GUIDE (lot.json) reste compté (motif lot, debite 1, rembourse false)', [lt.facturation.motif, lt.facturation.debite, lt.facturation.rembourse], ['lot', 1, false]);
    H.v('contrôle : la fausse saine est acceptée', valider(ls, ref('ReponseAnalyse'), doc).ok, true);
    refuse('un motif hors liste fermée (lot-sans-prix : le motif est sans-prix)', c => { c.facturation.motif = 'lot-sans-prix'; }, 'ReponseAnalyse', ls);
    refuse('une raison de non-remboursement hors liste (aucun-prix)', c => { c.facturation.raisonNonRembourse = 'aucun-prix'; }, 'ReponseAnalyse', ls);
    refuse('un rembourse en texte', c => { c.facturation.rembourse = 'oui'; }, 'ReponseAnalyse', ls);
}
{ // ETAT-FOURCHETTE : l'état n'est pas estimable => une FOURCHETTE, jamais un prix sûr — les fausses publiées le montrent (analyse : borne haute absente ; retour-live : grille lue en direct)
    const pr = lire('identifiee-prix-repli.json'), c0 = pr.analyse.cartes[0], rf = lire('retour-live-etat-fourchette.json');
    H.v('ETAT-FOURCHETTE : l\'analyse porte etat.retenu null, la fourchette (basse = « De », haute absente et dite absente), la mention en dernier, rien de fiable', [c0.etat.retenu, c0.prixRepli.fourchette, c0.prixRepli.guide.reserves, c0.prixRepli.guide.fiable, c0.prixRepli.fiable], [null, { basse: { prix: 0.02, source: 'guide-de' }, haute: null, absentes: ['haute'] }, ['etat-non-estimable'], false, false]);
    H.v('ETAT-FOURCHETTE : le retour-live porte la fourchette de la grille lue en direct, sans offre', [rf.prixRepli.cause, rf.prixRepli.fourchette, rf.prixRepli.offre, rf.prixRepli.guide.reserves], ['etat-non-retenu', { basse: { prix: 0.9, source: 'grille-directe' }, haute: { prix: 6, source: 'grille-directe' }, absentes: [] }, null, ['ecart-tendance', 'etat-non-estimable']]);
    H.v('ETAT-FOURCHETTE : l\'analyse sert aussi le prixGuide de la CARTE sous la mention (jamais un prix sûr sur un état nul), identique à celui du repli', [c0.carte.prixGuide.fiable, c0.carte.prixGuide.reserves, JSON.stringify(c0.carte.prixGuide) === JSON.stringify(c0.prixRepli.guide)], [false, ['etat-non-estimable'], true]);
    H.v('contrôle : la fausse du retour-live est acceptée', valider(rf, ref('ReponseRetourLive'), doc).ok, true);
    refuse('une fourchette dont la borne a une source hors liste (la tendance)', c => { c.prixRepli.fourchette.haute.source = 'tendance'; }, 'ReponseRetourLive', rf);
    refuse('une fourchette dont la borne est à zéro', c => { c.prixRepli.fourchette.basse.prix = 0; }, 'ReponseRetourLive', rf);
    refuse('une fourchette qui dit un verdict', c => { c.prixRepli.fourchette.verdict = 'correct'; }, 'ReponseRetourLive', rf);
    refuse('une fourchette sans la liste des bornes absentes', c => { delete c.prixRepli.fourchette.absentes; }, 'ReponseRetourLive', rf);
    refuse('une fourchette qui se dit fiable', c => { c.prixRepli.fiable = true; }, 'ReponseRetourLive', rf);
    refuse('une fourchette dans la forme etat-proche', c => { c.prixRepli.repli = 'etat-proche'; c.prixRepli.cause = 'offre-autre-etat'; c.prixRepli.offre = { etat: 'GD', prix: 0.9 }; }, 'ReponseRetourLive', rf);
    refuse('une fourchette sur une analyse dont la réserve n\'est pas de la liste', c => { c.analyse.cartes[0].prixRepli.guide.reserves = ['etat-inconnu']; }, 'ReponseAnalyse', pr);
    // tour de correction 2 (N1, N3) : la forme « fourchette » sans guide, et plancherInconnu
    const sg = lire('retour-live-fourchette-sans-guide.json');
    H.v('N3 : la fausse sans guide porte repli fourchette, guide et offre nuls, la mention dans reserves, plancherInconnu dit', [sg.prixRepli.repli, sg.prixRepli.guide, sg.prixRepli.offre, sg.prixRepli.reserves, sg.prixRepli.fourchette.plancherInconnu, sg.prixRepli.fourchette.absentes], ['fourchette', null, null, ['etat-non-estimable'], true, ['haute']]);
    H.v('contrôle : la fausse sans guide est acceptée', valider(sg, ref('ReponseRetourLive'), doc).ok, true);
    refuse('une fourchette sans guide qui se dit fiable', c => { c.prixRepli.fiable = true; }, 'ReponseRetourLive', sg);
    refuse('une fourchette sans guide, sans la mention', c => { c.prixRepli.reserves = []; }, 'ReponseRetourLive', sg);
    refuse('une fourchette sans guide avec un guide', c => { c.prixRepli.guide = { tendance: 1, de: 1, moyenne30: 1, date: '2026-10-12' }; }, 'ReponseRetourLive', sg);
    refuse('plancherInconnu à false', c => { c.prixRepli.fourchette.plancherInconnu = false; }, 'ReponseRetourLive', sg);
}
{ // BANC-EXTENSION : `marques` dans la fausse du produit Staff (ce que le serveur sert, toujours), et `grilleLive` dans la requête du retour de l'extension
    const ts = lire('identifiee-tampon-staff.json'), c0 = ts.analyse.cartes[0].carte;
    H.v('TAMPONS : la fausse du produit Staff porte `marques` (liste fermée) = [staff], avec sa variante tampon', [c0.marques, c0.variante], [['staff'], 'tampon']);
    H.v('contrôle : la fausse saine est acceptée', valider(ts, ref('ReponseAnalyse'), doc).ok, true);
    refuse('une marque hors liste fermée (le nom de l\'enseigne en clair)', c => { c.analyse.cartes[0].carte.marques = ['Staff']; }, 'ReponseAnalyse', ts);
    refuse('`marques` en texte (un tableau, jamais une chaîne)', c => { c.analyse.cartes[0].carte.marques = 'staff'; }, 'ReponseAnalyse', ts);
    const rq = { scanId: 'fausse-identifiee-0001', carte: 0, prixLive: 11.9, prixLiveEtat: 'EX', prixLiveCodeLangue: 1, originePrix: 'grille', grilleLive: { NM: 14.2, EX: 11.9, GD: 9.5 }, verdictAffiche: 'correct' };
    H.v('RequeteRetourLive : une requête avec `grilleLive` (un nombre par état) est acceptée', valider(rq, ref('RequeteRetourLive'), doc).ok, true);
    const refuseRq = (nom, abimer) => { const c = clone(rq); abimer(c); H.vrai(`requête retour-live refusée : ${nom}`, !valider(c, ref('RequeteRetourLive'), doc).ok); };
    refuseRq('une grille en tableau', c => { c.grilleLive = [14.2, 11.9]; });
    refuseRq('un prix de grille en texte', c => { c.grilleLive.NM = '14,2'; });
    refuseRq('une grille nulle', c => { c.grilleLive = null; });
}
{ // MODELE-VISUEL-API : la fausse de l'empreinte de l'extension, et ce que le schéma REFUSE
    const em = lire('identifiee-empreinte.json');
    H.v('MVA : la fausse porte `empreinte` et `regleVerdict.modeleEmpreinte`', [em.empreinte, em.analyse.regleVerdict.modeleEmpreinte.id, em.analyse.regleVerdict.modeleEmpreinte.url], [{ utilisee: true, code: null }, 'p8000-poids8s-1', null]);
    H.v('contrôle : la fausse saine est acceptée', valider(em, ref('ReponseAnalyse'), doc).ok, true);
    refuse('un code d\'empreinte hors liste', c => { c.empreinte = { utilisee: false, code: 'trop-lent' }; }, 'ReponseAnalyse', em);
    refuse('une empreinte sans `utilisee`', c => { delete c.empreinte.utilisee; }, 'ReponseAnalyse', em);
    refuse('un champ en trop dans l\'empreinte (score)', c => { c.empreinte.score = 0.9; }, 'ReponseAnalyse', em);
    refuse('un sha256 de modèle qui n\'est pas hexadécimal', c => { c.analyse.regleVerdict.modeleEmpreinte.sha256 = 'z'.repeat(64); }, 'ReponseAnalyse', em);
    refuse('un modeleEmpreinte sans url (null attendu, pas absent)', c => { delete c.analyse.regleVerdict.modeleEmpreinte.url; }, 'ReponseAnalyse', em);
    refuse('un octets de modèle à zéro', c => { c.analyse.regleVerdict.modeleEmpreinte.octets = 0; }, 'ReponseAnalyse', em);
    const rq = { contrat: 2, imageUrls: ['https://images1.vinted.net/t/01_00000_fictif/f800/1.jpeg'], empreintes: [{ photo: 0, vecteur: 'A'.repeat(683) + '=' }], modeleEmpreinte: { id: 'p8000-poids8s-1', sha256: 'a'.repeat(64) } };
    H.v('MVA : une requête saine avec empreintes est acceptée', valider(rq, ref('RequeteIdentifier'), doc).ok, true);
    const refuseRq = (nom, abimer) => { const c = clone(rq); abimer(c); H.vrai(`requête refusée : ${nom}`, !valider(c, ref('RequeteIdentifier'), doc).ok); };
    refuseRq('un vecteur de 683 caractères', c => { c.empreintes[0].vecteur = 'A'.repeat(682) + '='; });
    refuseRq('un vecteur en base64 URL', c => { c.empreintes[0].vecteur = 'A'.repeat(100) + '-' + 'A'.repeat(582) + '='; });
    refuseRq('neuf entrées', c => { c.empreintes = Array.from({ length: 9 }, () => c.empreintes[0] || { photo: 0, vecteur: 'A'.repeat(683) + '=' }); c.empreintes.forEach(e => { e.vecteur = 'A'.repeat(683) + '='; }); });
    refuseRq('un champ en trop dans une entrée', c => { c.empreintes[0].score = 0.9; });
    refuseRq('un index de photo à 20', c => { c.empreintes[0].photo = 20; });
    refuseRq('un modèle sans sha256', c => { delete c.modeleEmpreinte.sha256; });
    { const ok = clone(rq); ok.empreintes[0].carte = 'QUJD'; H.v('MVA : une carte base64 (forme seulement ; le JPEG est jugé par le serveur) est acceptée par le schéma', valider(ok, ref('RequeteIdentifier'), doc).ok, true); }
    refuseRq('une carte de plus de 273 068 caractères', c => { c.empreintes[0].carte = 'A'.repeat(273072); });
    refuseRq('une carte qui n\'est pas du base64', c => { c.empreintes[0].carte = 'pas du base64 !'; });
    refuseRq('une carte qui n\'est pas une chaîne', c => { c.empreintes[0].carte = 42; });
}
{ // CAPACITES-PING : la fausse publiée de /ping porte la liste fermée de CE serveur, et le schéma REFUSE ce qui en sort
    const pg = lire('ping.json'), { CAPACITES } = require('../capacites');
    H.v('CAPACITES-PING : la fausse porte versionMinExtension et la liste fermée complète, dans l\'ordre de la liste', [pg.versionMinExtension, pg.capacites], ['2.0.0', [...CAPACITES]]);
    H.v('contrôle : la fausse saine est acceptée', valider(pg, ref('ReponsePing'), doc).ok, true);
    const sans = clone(pg); delete sans.capacites; delete sans.versionMinExtension;
    H.v('contrôle : un /ping sans capacites ni versionMinExtension (v2 non annoncée, serveur d\'avant) est accepté — les deux sont facultatifs', valider(sans, ref('ReponsePing'), doc).ok, true);
    H.v('contrôle : une liste vide (rien n\'est servi) est acceptée', valider({ ...clone(pg), capacites: [] }, ref('ReponsePing'), doc).ok, true);
    refuse('un jeton hors liste (prix-demain)', c => { c.capacites.push('prix-demain'); }, 'ReponsePing', pg);
    refuse('un jeton en majuscules', c => { c.capacites[0] = 'MARQUES'; }, 'ReponsePing', pg);
    refuse('capacites qui n\'est pas un tableau (une chaîne)', c => { c.capacites = 'marques'; }, 'ReponsePing', pg);
    refuse('capacites nul', c => { c.capacites = null; }, 'ReponsePing', pg);
    refuse('un jeton qui n\'est pas une chaîne', c => { c.capacites[1] = 3; }, 'ReponsePing', pg);
    refuse('un champ en trop dans /ping', c => { c.score = 1; }, 'ReponsePing', pg);
}
const er = lire('quota-compte.json');
H.v('contrôle : une erreur saine est acceptée', valider(er, ref('ReponseErreur'), doc).ok, true);
refuse('un code d\'erreur inconnu', c => { c.erreur.code = 'INCONNU'; }, 'ReponseErreur', er);
refuse('l\'ancien code NON_VERIFIE (compteContrat.ts)', c => { c.erreur.code = 'NON_VERIFIE'; }, 'ReponseErreur', er);
refuse('success:true sur une erreur', c => { c.success = true; }, 'ReponseErreur', er);
refuse('une erreur sans facturation', c => { delete c.facturation; }, 'ReponseErreur', er);
for (const code of Object.keys(CODES)) {
    const c = clone(er); c.erreur.code = code;
    if (!valider(c, ref('ReponseErreur'), doc).ok) H.vrai(`le code ${code} de erreurs.js est accepté par ReponseErreur`, false);
}
H.vrai(`les ${Object.keys(CODES).length} codes de erreurs.js sont tous acceptés`, true);
// une réponse d'un statut documenté valide contre le schéma du chemin ; une réponse d'un statut NON documenté est vue
H.v('un statut non documenté est vu', schemaDuChemin('POST /api/identifier', 418), undefined);

// ── 6. CONTRAT-API-V2.md : chaque bloc JSON valide contre le schéma qu'il déclare (les exemples ne mentent pas) ──
const texte = fs.readFileSync(path.join(RACINE, 'CONTRAT-API-V2.md'), 'utf8');
const blocs = [...texte.matchAll(/```json([^\n]*)\n([\s\S]*?)```/g)].map(m => ({ info: m[1].trim(), corps: m[2] }));
console.log(`   ${blocs.length} blocs JSON dans CONTRAT-API-V2.md`);
H.vrai('le document porte au moins 15 exemples JSON', blocs.length >= 15);
blocs.forEach((b, i) => {
    const m = /^schema=([A-Za-z]+)$/.exec(b.info);
    if (!m) return H.vrai(`bloc ${i + 1} : « json schema=Nom » obligatoire (reçu « ${b.info} »)`, false);
    let valeur; try { valeur = JSON.parse(b.corps); } catch (e) { return H.vrai(`bloc ${i + 1} (${m[1]}) : JSON illisible — ${e.message}`, false); }
    if (!S[m[1]]) return H.vrai(`bloc ${i + 1} : schéma inconnu ${m[1]}`, false);
    const v = valider(valeur, ref(m[1]), doc);
    H.vrai(`bloc ${i + 1} valide contre ${m[1]}${v.ok ? '' : ' : ' + JSON.stringify(v.erreurs.slice(0, 3))}`, v.ok);
});
// un exemple qui mentirait serait vu : le même contrôle sur un bloc abîmé à la main
H.v('un bloc abîmé est refusé (le contrôle des exemples sait dire non)', valider({ success: true, solde: { total: 'beaucoup' } }, ref('ReponseSolde'), doc).ok, false);
// le texte nomme TOUTES les valeurs des listes fermées (il ne dérive pas du schéma)
const enc = v => '`' + v + '`';
const listes = {
    'codes d\'erreur': Object.keys(CODES), 'motifs de facturation': motifs, 'codes de question': S.Question.properties.code.enum,
    'raisons': S.CarteIntrouvable.properties.raison.enum, 'variantes': S.Produit.properties.variante.enum.filter(x => x !== null),
    'états Cardmarket': S.EtatCarte.properties.estime.enum.filter(x => x !== null), 'devises': S.RequeteIdentifier.properties.devise.enum,
    'verdicts': S.RequeteRetourLive.properties.verdictAffiche.enum, 'causes de lecture ratée': S.RequeteRetourLive.properties.lectureRatee.properties.cause.enum,
    'statuts': S.ReponseAnalyse.properties.analyse.properties.statut.enum,
    'réserves d\'un prix (F4-PRIX)': S.PrixGuide.properties.reserves.items.enum, 'base du « De » (F4-PRIX)': S.PrixGuide.properties.deBase.enum,
    'sources du badge du set (F4-PRIX)': S.SetProduit.properties.badgeSource.enum.filter(x => x !== null),
    'raisons de non-remboursement (REPLI-QUOTA)': S.Facturation.properties.raisonNonRembourse.enum.filter(x => x !== null),
    'mentions du repli du prix (PRIX-LISIBLE)': [S.PrixRepliTendance.properties.repli.const, S.PrixRepliEtatProche.properties.repli.const, S.PrixRepliFourchette.properties.repli.const],
    'causes du repli du prix (PRIX-LISIBLE)': [...S.PrixRepliTendance.properties.cause.enum, S.PrixRepliEtatProche.properties.cause.const],
    'codes de l\'empreinte de l\'extension (MODELE-VISUEL-API)': S.ReponseEmpreinte.properties.code.enum.filter(x => x !== null),
    'capacités annoncées par /ping (CAPACITES-PING)': S.ReponsePing.properties.capacites.items.enum,
    'sources des bornes de la fourchette (ETAT-FOURCHETTE)': S.BornePrix.properties.source.enum,
    'bornes absentes de la fourchette (ETAT-FOURCHETTE)': S.PrixFourchette.properties.absentes.items.enum
};
for (const [nom, vals] of Object.entries(listes)) H.v(`le document nomme tous les ${nom}`, vals.filter(v => !texte.includes(enc(v))), []);
for (const mot of ['code-maitre', 'administrateur', 'Idempotency-Key', 'X-Rat-Market', 'rm_session', 'ce que les clients doivent aligner', '90 jours', '24 mois'])
    H.vrai(`le document parle de « ${mot} »`, texte.toLowerCase().includes(mot.toLowerCase()));
H.bilan();
