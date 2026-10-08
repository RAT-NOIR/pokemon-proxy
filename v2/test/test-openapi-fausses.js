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
const REQUISES = ['identifiee', 'a-trancher-2', 'a-trancher-3', 'lot', 'panne-ia', 'panne-indisponible', 'panne-serveur', 'quota-compte', 'quota-installation', 'verification',
    'question-repondue', 'question-abandonnee-aucune', 'question-abandonnee-ne-sait-pas', 'solde-installation-non-liee', 'solde-installation-liee', 'solde-compte-non-verifie', 'solde-abonnement'];
H.v('états demandés présents', REQUISES.filter(n => !fichiers.includes(`${n}.json`)), []);
const motsRaisons = ['photo-illisible', 'pas-une-carte', 'hors-catalogue', 'plusieurs-cartes-non-separees', 'panne-lecture'];
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
refuse('un a-trancher à un seul candidat', c => { c.analyse.cartes[0].candidats.length = 1; }, 'ReponseAnalyse', tr);
refuse('un a-trancher à quatre candidats', c => { const x = c.analyse.cartes[0]; x.candidats.push(clone(x.candidats[0])); }, 'ReponseAnalyse', tr);
refuse('un a-trancher avec une carte', c => { c.analyse.cartes[0].carte = c.analyse.cartes[0].candidats[0]; }, 'ReponseAnalyse', tr);
refuse('un a-trancher sans question', c => { c.analyse.cartes[0].question = null; }, 'ReponseAnalyse', tr);
refuse('un code de question inconnu', c => { c.analyse.cartes[0].question.code = 'prix'; }, 'ReponseAnalyse', tr);
refuse('un identifiant de choix inconnu', c => { c.analyse.cartes[0].question.choix[0].id = 'z'; }, 'ReponseAnalyse', tr);
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
    'statuts': S.ReponseAnalyse.properties.analyse.properties.statut.enum
};
for (const [nom, vals] of Object.entries(listes)) H.v(`le document nomme tous les ${nom}`, vals.filter(v => !texte.includes(enc(v))), []);
for (const mot of ['code-maitre', 'administrateur', 'Idempotency-Key', 'X-Rat-Market', 'rm_session', 'ce que les clients doivent aligner', '90 jours', '24 mois'])
    H.vrai(`le document parle de « ${mot} »`, texte.toLowerCase().includes(mot.toLowerCase()));
H.bilan();
