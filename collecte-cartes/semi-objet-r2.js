// ============================================================
// UN LOGO SEMI-OFFICIEL PAR RÉEMPLOI D'UN OBJET R2 DÉJÀ LÉGAL — Match Battle (lot LOGOS-ECR, 2026-10-13)
// ============================================================
// Décision 3 du testeur : les logos communs d'une opération sont SEMI-OFFICIELS. « Match Battle logo.png » (Bulbagarden, `bulbapedia:setlogo`) est DÉJÀ dans notre R2
// (`bulbapedia/logos/matchbattlelogopng.png`, refusé « générique » le 2026-09-28 sur McDonald's Collection 2022 et McDonald's Match Battle 2023 : c'est leur `logoRefus`).
// Aucune requête, aucun objet R2 écrit ni retiré : l'entrée `logoSemiOfficiel.en` POINTE vers l'objet existant (vignette absente : `null`, que l'export accepte).
// POURQUOI UN OUTIL À PART et non une entrée de collecter-logos-officiels.js : ce collecteur TÉLÉCHARGE (client, cadence, robots, fichier dans R2) et son retrait (`retirerLot`) SUPPRIME
// les objets R2 de son lot ; un objet partagé avec le `logoRefus` ne doit jamais l'être. Le lot est donc distinct, et le retrait d'ici ne touche à aucun objet. collecter-logos-officiels.js n'est pas modifié.
// UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : deux sets nommés, de tirage intl, qui portent le logoRefus de CET objet (cleR2 + sha1) ; des octets de R2 au sha256 attendu (lus par l'appelant) ;
// aucun `logoSemiOfficiel.en` déjà là (filtre `$exists: false`). Tout le reste refuse.
const LOT = 'logos-semi-officiels-objet-r2-2026-10';
const MENTION = '© Pokémon / The Pokémon Company';
// Le fichier REGARDÉ le 2026-10-13 (340×115, PNG) : « MATCH BATTLE » en lettres noires autour d'une Poké Ball sur un éclat jaune — le logo de l'opération McDonald's Match Battle, sans nom de set.
const OBJET = {
    cleR2: 'bulbapedia/logos/matchbattlelogopng.png', fichier: 'Match Battle logo.png', source: 'bulbapedia:setlogo',
    sha1: 'da4e941e5fdcff642bed1c478e7ea59d42fe16fb', sha256: '09e2af9c09a5cf62b468cfbe4d8ca915d1dc8c05c50e14042f32fe7f2b8121f9', octets: 30521, w: 340, h: 115, format: 'png',
    cible: 'en', langue: 'en',
    represente: 'Logo « MATCH BATTLE » de l\'opération McDonald\'s Match Battle (Pokémon TCG), commun aux McDonald\'s Collection 2022 et McDonald\'s Match Battle 2023 : il représente l\'opération, pas un set en particulier.'
};
const SETS = { 'McDonalds-Collection-2022': {}, 'McDonalds-Match-Battle-2023': {} };

const refus = raison => ({ action: 'refus', raison });

/** Le plan : { action: 'poser'|'deja'|'refus', … }. `mesure` : { sha256, … } des octets de R2 (null si illisibles). */
function planifier({ id, set, mesure, le = new Date() }) {
    if (!SETS[id]) return refus(`« ${id} » n'est pas dans la liste fermée (${Object.keys(SETS).join(', ')})`);
    if (!set) return refus(`set ${id} absent`);
    if ((set.tirage ?? set.region) !== 'intl') return refus(`${id} : tirage ${set.tirage ?? set.region ?? '∅'}, pas intl`);
    const ex = set.logoSemiOfficiel?.en;
    if (ex) return ex.lot === LOT && ex.sha256 === OBJET.sha256 ? { action: 'deja', id } : refus(`${id} porte déjà un logoSemiOfficiel.en (${ex.lot ?? '∅'}) : rien n'est remplacé`);
    const r = set.logoRefus;
    if (!r || r.cleR2 !== OBJET.cleR2 || r.sha1 !== OBJET.sha1) return refus(`${id} ne porte pas le logoRefus de l'objet ${OBJET.cleR2} (sha1 ${OBJET.sha1.slice(0, 10)}) : je ne le réemploie pas`);
    if (!mesure?.sha256) return refus('octets de R2 illisibles : sha256 inconnu (je ne sais pas)');
    if (mesure.sha256 !== OBJET.sha256) return refus(`sha256 des octets de R2 (${mesure.sha256.slice(0, 10)}) ≠ attendu (${OBJET.sha256.slice(0, 10)})`);
    const entree = {
        niveau: 'semi-officiel', represente: OBJET.represente, cleR2: OBJET.cleR2, vignette: null, w: OBJET.w, h: OBJET.h, octets: OBJET.octets, sha256: OBJET.sha256, format: OBJET.format,
        langue: OBJET.langue, source: OBJET.source, urlSource: null, lot: LOT, mention: MENTION, le,
        preuve: { verifie: 'reemploi-objet-r2', fichierBulbagarden: OBJET.fichier, logoRefusLe: r.le ?? null, sha1: OBJET.sha1, decision: 'testeur 2026-10-13 (décision 3 : logos communs d\'une opération = semi-officiels)' }
    };
    return { action: 'poser', id, filtre: { _id: id, 'logoSemiOfficiel.en': { $exists: false } }, set: { 'logoSemiOfficiel.en': entree } };
}

/** Le retrait : seulement l'entrée de CE lot ; AUCUN objet R2 n'est touché. */
function planifierRetrait({ id, set }) {
    if (!SETS[id]) return refus(`« ${id} » n'est pas dans la liste fermée`);
    const e = set?.logoSemiOfficiel?.en;
    if (!e || e.lot !== LOT) return refus(`${id} ne porte pas de logoSemiOfficiel.en du lot ${LOT} : rien à retirer`);
    return { action: 'retirer', id, filtre: { _id: id, 'logoSemiOfficiel.en.lot': LOT, 'logoSemiOfficiel.en.sha256': e.sha256 }, unset: { 'logoSemiOfficiel.en': '' } };
}

/** L'écriture d'UN plan (une `updateOne` gardée par le filtre) ; au retrait, le conteneur `logoSemiOfficiel` vide est retiré aussi. Rend { action, ecrits }. */
async function appliquer({ S, plan }) {
    if (plan.action === 'deja') return { action: 'deja', ecrits: 0 };
    if (plan.action === 'refus') return { action: 'refus', ecrits: 0, raison: plan.raison };
    const u = await S.updateOne(plan.filtre, plan.action === 'retirer' ? { $unset: plan.unset } : { $set: plan.set });
    if (u.modifiedCount === 1 && plan.action === 'retirer') await S.updateOne({ _id: plan.id, logoSemiOfficiel: {} }, { $unset: { logoSemiOfficiel: '' } });
    return { action: u.modifiedCount === 1 ? plan.action : 'conflit', ecrits: u.modifiedCount === 1 ? 1 : 0 };
}

function analyserArguments(argv) {
    const erreurs = [];
    const ecrire = argv.includes('--ecrire'), retirer = argv.includes('--retirer'), viaEcriture = argv.includes('--lecture-via-ecriture');
    for (const x of argv) if (!/^(--ecrire|--retirer|--lecture-via-ecriture|--attendu=.*)$/.test(x)) erreurs.push(`argument inconnu : ${x} — autorisés : --retirer, --ecrire, --attendu=<n>, --lecture-via-ecriture`);
    const att = argv.find(x => x.startsWith('--attendu='));
    let attendu = null;
    if (att !== undefined) {
        if (!/^--attendu=\d+$/.test(att)) erreurs.push(`${att} : un entier positif ou nul est exigé`);
        else attendu = Number(att.slice(10));
        if (!ecrire) erreurs.push('--attendu n\'a de sens qu\'avec --ecrire');
    } else if (ecrire) erreurs.push('--ecrire exige --attendu=<n> (le nombre de sets à écrire, annoncé par la simulation)');
    return { erreurs, ecrire, retirer, attendu, viaEcriture };
}

module.exports = { LOT, MENTION, OBJET, SETS, planifier, planifierRetrait, appliquer, analyserArguments };
