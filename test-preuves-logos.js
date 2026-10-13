// Banc des preuves de provenance des logos (collecte-cartes/preuves-logos.js) : fonctions pures + une fausse collection. Aucune base réelle, aucune requête, aucun R2.
//   node test-preuves-logos.js
const P = require('./collecte-cartes/preuves-logos');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

const SHA256 = 'a'.repeat(64), SHA1 = 'b'.repeat(40);
const preuveA = () => ({ set: 'Set-A', champ: 'logo', fichier: 'Un logo.png', sourceAttendue: 'bulbagarden:demande-site', sha1: SHA1, sha256: SHA256, type: 'a', archive: { url: 'https://web.archive.org/web/20260101000000id_/https://archives.bulbagarden.net/media/upload/x/xy/Un_logo.png', horodatage: '20260101000000', sha256: SHA256 } });
const preuveB = () => ({ set: 'Set-B', champ: 'logo', fichier: 'Autre.png', sourceAttendue: 'bulbagarden:demande-site', sha1: SHA1, sha256: SHA256, type: 'b', emballage: { photos: ['https://billsarchive.com/assets/articles/x/1.webp'], inliers: 171, contreExemple: 11, regarde: true } });
const set = (p, plus = {}) => ({ _id: p.set, [p.champ]: { source: p.sourceAttendue, fichier: p.fichier, sha1: p.sha1, niveau: 'inconnu', cleR2: 'logos/bulbagarden/x.png', w: 1, h: 1, ...plus } });
const LE = new Date('2026-10-14T00:00:00Z');
const plan = (p, s, sha = SHA256) => P.planifier({ preuve: p, set: s, sha256Octets: sha, le: LE });

// le cas nominal (a)
const pa = preuveA(); const p0 = plan(pa, set(pa));
verifier('cas nominal (a) : poser', p0.action, 'poser');
verifier('le $set : niveau officiel et la preuve, rien d\'autre', Object.keys(p0.set).sort(), ['logo.niveau', 'logo.niveauPreuve']);
verifier('niveau = officiel ; avant = inconnu ; lot ; type a', [p0.set['logo.niveau'], p0.set['logo.niveauPreuve'].avant, p0.set['logo.niveauPreuve'].lot, p0.set['logo.niveauPreuve'].type], ['officiel', 'inconnu', P.LOT, 'a']);
verifier('la source écrite dit Bulbagarden ET l\'horodatage de la copie archive.org', /Bulbagarden/.test(p0.set['logo.niveauPreuve'].source) && /20260101000000/.test(p0.set['logo.niveauPreuve'].source), true);
verifier('le filtre n\'écrit que sur un niveau « inconnu », le même sha1, la même source, sans preuve déjà posée', [p0.filtre['logo.niveau'], p0.filtre['logo.sha1'], p0.filtre['logo.source'], p0.filtre['logo.niveauPreuve']], ['inconnu', SHA1, 'bulbagarden:demande-site', { $exists: false }]);
verifier('ni `source` ni `preuve` existantes ne sont dans le $set (aucun écrasement)', Object.keys(p0.set).some(k => /^logo\.(source|preuve)$/.test(k)), false);
// le cas nominal (b)
const pb = preuveB(); const q0 = plan(pb, set(pb));
verifier('cas nominal (b) : poser, type b, adresse des photos dans la preuve', [q0.action, q0.set['logo.niveauPreuve'].type, q0.set['logo.niveauPreuve'].emballage.photos[0]], ['poser', 'b', 'https://billsarchive.com/assets/articles/x/1.webp']);
// refus : ce qu'on n'autorise pas
verifier('sha256 des octets différent : refus', plan(pa, set(pa), 'c'.repeat(64)).action, 'refus');
verifier('octets illisibles (null) : refus, je ne sais pas', plan(pa, set(pa), null).action, 'refus');
verifier('sha1 de l\'entrée différent de celui de la preuve : refus', plan(pa, set(pa, { sha1: 'd'.repeat(40) })).action, 'refus');
verifier('niveau déjà officiel sans notre preuve : refus (je ne modifie que inconnu)', plan(pa, set(pa, { niveau: 'officiel' })).action, 'refus');
verifier('niveau absent : refus (la valeur actuelle doit être inconnu)', plan(pa, set(pa, { niveau: undefined })).action, 'refus');
verifier('niveau generique : refus', plan(pa, set(pa, { niveau: 'generique' })).action, 'refus');
verifier('source de l\'entrée autre : refus', plan(pa, set(pa, { source: 'manuel' })).action, 'refus');
verifier('nom de fichier de l\'entrée autre : refus', plan(pa, set(pa, { fichier: 'Autre.png' })).action, 'refus');
verifier('set absent : refus', plan(pa, null).action, 'refus');
verifier('champ absent : refus', plan(pa, { _id: 'Set-A' }).action, 'refus');
verifier('preuve a dont la copie archive.org n\'a pas le même sha256 : refus', plan({ ...pa, archive: { ...pa.archive, sha256: 'e'.repeat(64) } }, set(pa)).action, 'refus');
verifier('preuve a sans archive : refus', plan({ ...pa, archive: undefined }, set(pa)).action, 'refus');
verifier('preuve b non regardée : refus', plan({ ...pb, emballage: { ...pb.emballage, regarde: false } }, set(pb)).action, 'refus');
verifier('preuve b sous 15 inliers : refus', plan({ ...pb, emballage: { ...pb.emballage, inliers: 14 } }, set(pb)).action, 'refus');
verifier('preuve b sans le triple du meilleur négatif : refus', plan({ ...pb, emballage: { ...pb.emballage, inliers: 30, contreExemple: 11 } }, set(pb)).action, 'refus');
verifier('type inconnu : refus', plan({ ...pa, type: 'c' }, set(pa)).action, 'refus');
verifier('chemin hors de la liste fermée des champs (logoOfficiel.fr) : refus', plan({ ...pa, champ: 'logoOfficiel.fr' }, { _id: 'Set-A', logoOfficiel: { fr: { ...set(pa).logo } } }).action, 'refus');
verifier('niveauPreuve d\'un AUTRE lot déjà présent (niveau inconnu) : refus, rien n\'est remplacé', plan(pa, set(pa, { niveauPreuve: { lot: 'autre-lot' } })).action, 'refus');
verifier('champ hors liste (logoFr) sur un set qui le porte, entrée par ailleurs conforme : refus', plan({ ...pa, champ: 'logoFr' }, { _id: 'Set-A', logoFr: { ...set(pa).logo } }).action, 'refus');
verifier('entrée SANS `fichier` : refus (la garde du fichier ne passe pas par absence)', plan(pa, set(pa, { fichier: undefined })).action, 'refus');
// déjà fait
const posé = set(pa, { niveau: 'officiel', niveauPreuve: { lot: P.LOT, type: 'a' } });
verifier('déjà posé par ce lot : « deja »', plan(pa, posé).action, 'deja');
// le retrait
const r0 = P.planifierRetrait({ preuve: pa, set: posé });
verifier('retrait : filtre sur le lot ET le sha1 ET le niveau officiel ; remet inconnu, retire la preuve', [r0.action, r0.filtre['logo.niveauPreuve.lot'], r0.filtre['logo.sha1'], r0.filtre['logo.niveau'], r0.set['logo.niveau'], Object.keys(r0.unset)], ['retirer', P.LOT, SHA1, 'officiel', 'inconnu', ['logo.niveauPreuve']]);
verifier('retrait refusé sur un set qui ne porte pas notre preuve', P.planifierRetrait({ preuve: pa, set: set(pa) }).action, 'refus');
verifier('retrait refusé si le niveauPreuve est d\'un AUTRE lot (même sha1, même niveau)', P.planifierRetrait({ preuve: pa, set: set(pa, { niveau: 'officiel', niveauPreuve: { lot: 'autre-lot' } }) }).action, 'refus');
verifier('retrait refusé si le sha1 a changé', P.planifierRetrait({ preuve: pa, set: set(pa, { niveau: 'officiel', sha1: 'f'.repeat(40), niveauPreuve: { lot: P.LOT } }) }).action, 'refus');

// la liste fermée écrite dans le code
verifier('la liste fermée : chaque preuve a un set, un fichier, 64 hex de sha256, 40 hex de sha1, un type a ou b', P.PREUVES.every(p => p.set && p.fichier && /^[0-9a-f]{64}$/.test(p.sha256) && /^[0-9a-f]{40}$/.test(p.sha1) && ['a', 'b'].includes(p.type) && p.champ === 'logo'), true);
verifier('la liste fermée : 21 preuves (20 a, 1 b) — 13 de LOGOS-ECR + 8 de LOGOS-BG', [P.PREUVES.length, P.PREUVES.filter(p => p.type === 'a').length, P.PREUVES.filter(p => p.type === 'b').length], [21, 20, 1]);
const LOGOS_BG = ['VSTAR-Universe', 'Ruler-of-the-Black-Flame', 'Stellar-Miracle', 'EX-Battle-Boost', 'Scarlet-ex', 'Violet-ex', 'Mega-Symphonia', 'Mega-Brave'];
verifier('LOGOS-BG : les 8 preuves jp sont dans la liste, type a, champ logo, source demande-site', LOGOS_BG.every(id => { const p = P.PREUVES.find(x => x.set === id); return p && p.type === 'a' && p.champ === 'logo' && p.sourceAttendue === 'bulbagarden:demande-site'; }), true);
verifier('LOGOS-BG : pour CHAQUE preuve a de la liste, une copie archive.org d\'un autre sha256 dit NON', P.PREUVES.filter(p => p.type === 'a').every(p => plan({ ...p, archive: { ...p.archive, sha256: '0'.repeat(64) } }, set(p, { sha1: p.sha1 })).action === 'refus'), true);
verifier('LOGOS-BG : pour CHAQUE preuve a de la liste, des octets R2 d\'un autre sha256 disent NON', P.PREUVES.filter(p => p.type === 'a').every(p => plan(p, set(p, { sha1: p.sha1 }), '1'.repeat(64)).action === 'refus'), true);
verifier('la liste fermée : aucun set en double', new Set(P.PREUVES.map(p => p.set)).size, P.PREUVES.length);
verifier('la liste fermée : toute preuve a porte une copie archive.org au MÊME sha256, toute preuve b est regardée', P.PREUVES.every(p => p.type === 'a' ? p.archive?.sha256 === p.sha256 && /^\d{14}$/.test(p.archive.horodatage) : p.emballage?.regarde === true), true);

// l'application sur une fausse collection : un seul document, jamais d'écrasement
function fausse(docs) {
    const get = (d, k) => k.split('.').reduce((o, x) => (o == null ? undefined : o[x]), d);
    const ok1 = (d, f) => Object.entries(f).every(([k, v]) => k === '_id' ? d._id === v : (v && v.$exists === false) ? get(d, k) === undefined : JSON.stringify(get(d, k)) === JSON.stringify(v));
    const poser = (d, k, v) => { const ks = k.split('.'); let o = d; for (const x of ks.slice(0, -1)) o = (o[x] ??= {}); o[ks.at(-1)] = v; };
    return { docs, async updateOne(f, u) { const d = docs.find(x => ok1(x, f)); if (!d) return { modifiedCount: 0 }; for (const [k, v] of Object.entries(u.$set || {})) poser(d, k, v); for (const k of Object.keys(u.$unset || {})) { const ks = k.split('.'); let o = d; for (const x of ks.slice(0, -1)) o = o[x]; delete o[ks.at(-1)]; } return { modifiedCount: 1 }; } };
}
(async () => {
    const S = fausse([set(pa)]);
    const r = await P.appliquer({ S, plan: plan(pa, S.docs[0]) });
    verifier('appliquer : 1 écrit, niveau officiel, source et preuve texte d\'origine intactes', [r.ecrits, S.docs[0].logo.niveau, S.docs[0].logo.source, S.docs[0].logo.niveauPreuve.lot], [1, 'officiel', 'bulbagarden:demande-site', P.LOT]);
    const r2 = await P.appliquer({ S, plan: plan(pa, S.docs[0]) });
    verifier('appliquer une seconde fois : deja, rien d\'écrit', [r2.action, r2.ecrits], ['deja', 0]);
    const S2 = fausse([set(pa)]); const p2 = plan(pa, S2.docs[0]); S2.docs[0].logo.niveau = 'officiel';
    const r3 = await P.appliquer({ S: S2, plan: p2 });
    verifier('un niveau changé entre la lecture et l\'écriture : conflit, rien d\'écrasé', [r3.action, r3.ecrits, S2.docs[0].logo.niveauPreuve], ['conflit', 0, undefined]);
    const rr = await P.appliquer({ S, plan: P.planifierRetrait({ preuve: pa, set: S.docs[0] }) });
    verifier('retrait appliqué : niveau remis à inconnu, preuve retirée, source intacte', [rr.ecrits, S.docs[0].logo.niveau, S.docs[0].logo.niveauPreuve, S.docs[0].logo.source], [1, 'inconnu', undefined, 'bulbagarden:demande-site']);
    // arguments
    verifier('arguments : --ecrire sans --attendu refusé', P.analyserArguments(['--ecrire']).erreurs.length > 0, true);
    verifier('arguments : --attendu sans --ecrire refusé', P.analyserArguments(['--attendu=3']).erreurs.length > 0, true);
    verifier('arguments : inconnu refusé', P.analyserArguments(['--tout']).erreurs.length > 0, true);
    verifier('arguments : simulation, écriture annoncée, retrait', [P.analyserArguments([]).erreurs, P.analyserArguments(['--ecrire', '--attendu=13']).erreurs, P.analyserArguments(['--retirer', '--ecrire', '--attendu=13']).retirer], [[], [], true]);
    console.log(`\n${ok} réussis, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
