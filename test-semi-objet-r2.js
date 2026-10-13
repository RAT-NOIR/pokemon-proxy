// Banc du semi-officiel par réemploi d'un objet R2 déjà légal (collecte-cartes/semi-objet-r2.js) : fonctions pures + fausse collection. Aucune base réelle, aucune requête, aucun R2.
//   node test-semi-objet-r2.js
const M = require('./collecte-cartes/semi-objet-r2');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

const E = M.OBJET;
const mesure = { sha256: E.sha256, octets: E.octets, w: E.w, h: E.h, format: E.format };
const refus = { motif: 'logo GÉNÉRIQUE refusé', fichier: E.fichier, cleR2: E.cleR2, sha1: E.sha1, le: '2026-10-03T16:30:09.241Z', source: 'bulbapedia:setlogo' };
const set = (id = 'McDonalds-Collection-2022', plus = {}) => ({ _id: id, tirage: 'intl', region: 'intl', logoRefus: { ...refus }, logoCompose: 'x', ...plus });
const LE = new Date('2026-10-14T00:00:00Z');
const plan = (id, s, m = mesure) => M.planifier({ id, set: s, mesure: m, le: LE });

verifier('la liste fermée : exactement McDonald\'s 2022 et Match Battle 2023', Object.keys(M.SETS).sort(), ['McDonalds-Collection-2022', 'McDonalds-Match-Battle-2023']);
verifier('la phrase `represente` est une vraie phrase (≥ 20 car.) et nomme l\'opération', M.OBJET.represente.length >= 20 && /Match Battle/.test(M.OBJET.represente), true);
const p0 = plan('McDonalds-Collection-2022', set());
verifier('cas nominal : poser', p0.action, 'poser');
verifier('le $set : UN seul champ, logoSemiOfficiel.en', Object.keys(p0.set), ['logoSemiOfficiel.en']);
const e = p0.set['logoSemiOfficiel.en'];
verifier('l\'entrée : niveau semi-officiel, phrase, objet R2 réemployé (même cleR2), langue en, lot propre', [e.niveau, e.represente.length >= 20, e.cleR2, e.langue, e.lot], ['semi-officiel', true, E.cleR2, 'en', M.LOT]);
verifier('le lot n\'est PAS celui du lot semi de collecter-logos-officiels (son retrait supprime des objets R2 : jamais le nôtre)', M.LOT !== 'logos-semi-officiels-2026-10', true);
verifier('l\'entrée porte sha256, w, h, octets, mention ; pas de vignette inventée', [e.sha256, e.w, e.h, e.octets, /Pokémon/.test(e.mention), e.vignette], [E.sha256, E.w, E.h, E.octets, true, null]);
verifier('le filtre n\'écrit que si logoSemiOfficiel.en est ABSENT', [p0.filtre._id, p0.filtre['logoSemiOfficiel.en']], ['McDonalds-Collection-2022', { $exists: false }]);
// refus par ce qu'on n'autorise pas
verifier('set hors liste fermée : refus', plan('McDonalds-Collection-2012', set('McDonalds-Collection-2012')).action, 'refus');
verifier('set absent : refus', plan('McDonalds-Collection-2022', null).action, 'refus');
verifier('tirage non intl : refus', plan('McDonalds-Collection-2022', set('McDonalds-Collection-2022', { tirage: 'jp' })).action, 'refus');
verifier('le set ne porte pas le logoRefus de CET objet : refus', plan('McDonalds-Collection-2022', set('McDonalds-Collection-2022', { logoRefus: { ...refus, cleR2: 'autre.png' } })).action, 'refus');
verifier('le set n\'a aucun logoRefus : refus', plan('McDonalds-Collection-2022', set('McDonalds-Collection-2022', { logoRefus: undefined })).action, 'refus');
verifier('octets de R2 au sha256 différent : refus', plan('McDonalds-Collection-2022', set(), { ...mesure, sha256: '0'.repeat(64) }).action, 'refus');
verifier('octets illisibles : refus', plan('McDonalds-Collection-2022', set(), null).action, 'refus');
verifier('un logoSemiOfficiel.en déjà là d\'un AUTRE lot : refus, rien n\'est remplacé', plan('McDonalds-Collection-2022', set('McDonalds-Collection-2022', { logoSemiOfficiel: { en: { lot: 'autre', niveau: 'semi-officiel' } } })).action, 'refus');
verifier('déjà posé par ce lot : deja', plan('McDonalds-Collection-2022', set('McDonalds-Collection-2022', { logoSemiOfficiel: { en: { lot: M.LOT, sha256: E.sha256 } } })).action, 'deja');
// retrait : jamais d'objet R2
const pose = set('McDonalds-Collection-2022', { logoSemiOfficiel: { en: { lot: M.LOT, sha256: E.sha256, cleR2: E.cleR2 } } });
const r0 = M.planifierRetrait({ id: 'McDonalds-Collection-2022', set: pose });
verifier('retrait : filtre sur le lot et le sha256, $unset du champ seul', [r0.action, r0.filtre['logoSemiOfficiel.en.lot'], r0.filtre['logoSemiOfficiel.en.sha256'], Object.keys(r0.unset)], ['retirer', M.LOT, E.sha256, ['logoSemiOfficiel.en']]);
verifier('retrait : AUCUN objet R2 dans le plan (l\'objet sert aussi au logoRefus)', Object.keys(r0).some(k => /r2|cles|supprimer/i.test(k)), false);
verifier('retrait refusé si l\'entrée n\'est pas de ce lot', M.planifierRetrait({ id: 'McDonalds-Collection-2022', set: set('McDonalds-Collection-2022', { logoSemiOfficiel: { en: { lot: 'autre' } } }) }).action, 'refus');

function fausse(docs) {
    const get = (d, k) => k.split('.').reduce((o, x) => (o == null ? undefined : o[x]), d);
    const ok1 = (d, f) => Object.entries(f).every(([k, v]) => k === '_id' ? d._id === v : (v && v.$exists === false) ? get(d, k) === undefined : JSON.stringify(get(d, k)) === JSON.stringify(v));
    const poser = (d, k, v) => { const ks = k.split('.'); let o = d; for (const x of ks.slice(0, -1)) o = (o[x] ??= {}); o[ks.at(-1)] = v; };
    return { docs, async updateOne(f, u) { const d = docs.find(x => ok1(x, f)); if (!d) return { modifiedCount: 0 }; for (const [k, v] of Object.entries(u.$set || {})) poser(d, k, v); for (const k of Object.keys(u.$unset || {})) { const ks = k.split('.'); let o = d; for (const x of ks.slice(0, -1)) o = o[x]; delete o[ks.at(-1)]; } return { modifiedCount: 1 }; } };
}
(async () => {
    const S = fausse([set()]);
    const r = await M.appliquer({ S, plan: plan('McDonalds-Collection-2022', S.docs[0]) });
    verifier('appliquer : 1 écrit, logoRefus et logoCompose intacts', [r.ecrits, S.docs[0].logoSemiOfficiel.en.niveau, S.docs[0].logoRefus.sha1, S.docs[0].logoCompose], [1, 'semi-officiel', E.sha1, 'x']);
    const r2 = await M.appliquer({ S, plan: plan('McDonalds-Collection-2022', S.docs[0]) });
    verifier('appliquer une seconde fois : deja', [r2.action, r2.ecrits], ['deja', 0]);
    const S2 = fausse([set()]); const p2 = plan('McDonalds-Collection-2022', S2.docs[0]); S2.docs[0].logoSemiOfficiel = { en: { lot: 'autre' } };
    const r3 = await M.appliquer({ S: S2, plan: p2 });
    verifier('un champ apparu entre-temps : conflit, rien d\'écrasé', [r3.action, r3.ecrits, S2.docs[0].logoSemiOfficiel.en.lot], ['conflit', 0, 'autre']);
    const rr = await M.appliquer({ S, plan: M.planifierRetrait({ id: 'McDonalds-Collection-2022', set: S.docs[0] }) });
    verifier('retrait appliqué : champ et conteneur vides retirés, logoRefus intact', [rr.ecrits, S.docs[0].logoSemiOfficiel, S.docs[0].logoRefus.sha1], [1, undefined, E.sha1]);
    verifier('arguments : --ecrire sans --attendu refusé', M.analyserArguments(['--ecrire']).erreurs.length > 0, true);
    verifier('arguments : inconnu refusé', M.analyserArguments(['--tout']).erreurs.length > 0, true);
    verifier('arguments : écriture annoncée / retrait', [M.analyserArguments(['--ecrire', '--attendu=2']).erreurs, M.analyserArguments(['--retirer', '--ecrire', '--attendu=2']).retirer], [[], true]);
    console.log(`\n${ok} réussis, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
