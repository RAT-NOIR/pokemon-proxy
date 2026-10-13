// Banc de l'héritage du logo d'un Additionals (collecte-cartes/heritage-logo.js) : fonctions pures + une fausse collection. Aucune base réelle, aucune requête.
//   node test-heritage-logo.js
const H = require('./collecte-cartes/heritage-logo');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

const LOGO = { sha1: '3ab75b7f64b7aaaa', source: 'bulbapedia:setlogo', fichier: '30th Celebration Logo EN.png', niveau: 'officiel', cleR2: 'bulbapedia/logos/30thcelebrationlogoenpng.png', w: 2173, h: 1200, preuve: 'set occidental, fichier suffixé « EN »', le: '2026-09-26T10:00:00.000Z' };
const parent = () => ({ _id: '30th-Celebration', tirage: 'intl', region: 'intl', bulba: { titre: '30th Celebration (TCG)', pageid: 357032, revid: 1, expansion: '30th Celebration', cleR2: 'bulba/357032/1.wikitext' }, logo: { ...LOGO } });
const add = () => ({ _id: '30th-Celebration-Additionals', tirage: 'intl', region: 'intl', code: 'x30C', bulba: { titre: null, expansion: '30th Celebration Additionals', motifTitres: 'aucune page de set chez nous' } });
const LE = new Date('2026-10-14T00:00:00Z');
const plan = (a, p, id = '30th-Celebration-Additionals') => H.planifier({ id, additionals: a, parent: p, le: LE });

// liste fermée : seul x30C
verifier('un autre Additionals que x30C : refus (liste fermée)', plan(add(), parent(), 'Pitch-Black-Additionals').action, 'refus');
verifier('set absent : refus', plan(null, parent()).action, 'refus');
verifier('parent absent : refus', plan(add(), null).action, 'refus');
// le cas nominal
const p0 = plan(add(), parent());
verifier('cas nominal : action poser', p0.action, 'poser');
verifier('le $set : bulba.pageid, logo (copie du parent, même sha1), logoHeritage — et rien d\'autre', Object.keys(p0.set).sort(), ['bulba.pageid', 'logo', 'logoHeritage']);
verifier('bulba.pageid = celui du parent, ET LUI SEUL (bulba.expansion de l\'Additionals n\'est pas touché)', [p0.set['bulba.pageid'], Object.keys(p0.set).some(k => /bulba\.(expansion|titre|cleR2|revid)/.test(k))], [357032, false]);
verifier('le logo posé est celui du parent (sha1, cleR2, niveau officiel, source du parent)', [p0.set.logo.sha1, p0.set.logo.cleR2, p0.set.logo.niveau, p0.set.logo.source], [LOGO.sha1, LOGO.cleR2, 'officiel', 'bulbapedia:setlogo']);
verifier('le registre : de, pageid, décision, date', [p0.set.logoHeritage.de, p0.set.logoHeritage.pageid, /testeur 2026-10-13/.test(p0.set.logoHeritage.decision), p0.set.logoHeritage.le.toISOString()], ['30th-Celebration', 357032, true, LE.toISOString()]);
verifier('le filtre n\'écrit que sur des champs ABSENTS (pageid null, logo et registre inexistants)', [p0.filtre['bulba.pageid'], p0.filtre.logo, p0.filtre.logoHeritage, p0.filtre._id], [null, { $exists: false }, { $exists: false }, '30th-Celebration-Additionals']);
// refus par ce qu'on n'autorise pas
verifier('tirage différent : refus', plan(add(), { ...parent(), tirage: 'jp' }).action, 'refus');
verifier('le parent a un autre pageid que celui attendu : refus', plan(add(), { ...parent(), bulba: { ...parent().bulba, pageid: 1 } }).action, 'refus');
verifier('le parent n\'a pas de pageid : refus', plan(add(), { ...parent(), bulba: { titre: 'x' } }).action, 'refus');
verifier('le parent n\'a pas de logo : refus', plan(add(), { ...parent(), logo: undefined }).action, 'refus');
verifier('le logo du parent n\'est pas de niveau officiel (inconnu) : refus', plan(add(), { ...parent(), logo: { ...LOGO, niveau: 'inconnu' } }).action, 'refus');
verifier('le logo du parent sans niveau : refus (je ne sais pas)', plan(add(), { ...parent(), logo: { ...LOGO, niveau: undefined } }).action, 'refus');
verifier('l\'Additionals a un AUTRE pageid : refus, rien n\'est remplacé', plan({ ...add(), bulba: { ...add().bulba, pageid: 5 } }, parent()).action, 'refus');
verifier('l\'Additionals a déjà un logo différent : refus', plan({ ...add(), logo: { ...LOGO, sha1: 'autre' } }, parent()).action, 'refus');
// déjà fait
const fait = { ...add(), bulba: { ...add().bulba, pageid: 357032 }, logo: { ...LOGO }, logoHeritage: { de: '30th-Celebration' } };
verifier('déjà posé à l\'identique : « deja », rien à écrire', plan(fait, parent()).action, 'deja');
verifier('état partiel (pageid posé, pas de logo) : refus, pas de complétion devinée', plan({ ...add(), bulba: { ...add().bulba, pageid: 357032 } }, parent()).action, 'refus');

// l'application sur une fausse collection : filtre évalué, un seul document, jamais d'écrasement
function fausse(docs) {
    const get = (d, k) => k.split('.').reduce((o, x) => (o == null ? undefined : o[x]), d);
    const ok1 = (d, f) => Object.entries(f).every(([k, v]) => k === '_id' ? d._id === v : (v && v.$exists === false) ? get(d, k) === undefined : v === null ? get(d, k) == null : JSON.stringify(get(d, k)) === JSON.stringify(v));
    const posseur = (d, k, v) => { const ks = k.split('.'); let o = d; for (const x of ks.slice(0, -1)) o = (o[x] ??= {}); o[ks.at(-1)] = v; };
    return { docs, async updateOne(f, u) { const d = docs.find(x => ok1(x, f)); if (!d) return { modifiedCount: 0 }; if (u.$set) for (const [k, v] of Object.entries(u.$set)) posseur(d, k, v); if (u.$unset) for (const k of Object.keys(u.$unset)) { const ks = k.split('.'); let o = d; for (const x of ks.slice(0, -1)) o = o[x]; delete o[ks.at(-1)]; } return { modifiedCount: 1 }; } };
}
(async () => {
    const S = fausse([add(), parent()]);
    const r = await H.appliquer({ S, plan: plan(S.docs[0], S.docs[1]) });
    verifier('appliquer : 1 document écrit', r.ecrits, 1);
    verifier('appliquer : pageid, logo et registre posés, bulba.expansion intacte', [S.docs[0].bulba.pageid, S.docs[0].logo.sha1, S.docs[0].logoHeritage.de, S.docs[0].bulba.expansion], [357032, LOGO.sha1, '30th-Celebration', '30th Celebration Additionals']);
    const r2 = await H.appliquer({ S, plan: plan(S.docs[0], S.docs[1]) });
    verifier('appliquer une seconde fois : « deja », rien d\'écrit', [r2.ecrits, r2.action], [0, 'deja']);
    // la condition change entre la lecture et l'écriture : le filtre refuse, rien n'est écrasé
    const S2 = fausse([add(), parent()]); const p2 = plan(S2.docs[0], S2.docs[1]);
    S2.docs[0].logo = { ...LOGO, sha1: 'posé entre-temps' };
    const r3 = await H.appliquer({ S: S2, plan: p2 });
    verifier('un logo apparu entre-temps n\'est pas écrasé (filtre sur l\'absence)', [r3.ecrits, S2.docs[0].logo.sha1], [0, 'posé entre-temps']);
    // le retrait : réversible, seulement ce que l'héritage a posé
    const rp = H.planifierRetrait({ id: '30th-Celebration-Additionals', additionals: S.docs[0], parent: S.docs[1] });
    verifier('retrait : plan sur un set hérité, filtre sur le registre ET le sha1', [rp.action, rp.filtre['logoHeritage.de'], rp.filtre['logo.sha1']], ['retirer', '30th-Celebration', LOGO.sha1]);
    verifier('retrait refusé si le set ne porte pas le registre d\'héritage', H.planifierRetrait({ id: '30th-Celebration-Additionals', additionals: add(), parent: parent() }).action, 'refus');
    const rr = await H.appliquer({ S, plan: rp });
    verifier('retrait appliqué : pageid, logo, registre retirés ; bulba.expansion intacte', [S.docs[0].bulba.pageid, S.docs[0].logo, S.docs[0].logoHeritage, S.docs[0].bulba.expansion], [undefined, undefined, undefined, '30th Celebration Additionals']);
    // les arguments
    verifier('arguments : --ecrire sans --attendu refusé', H.analyserArguments(['--ecrire']).erreurs.length > 0, true);
    verifier('arguments : --attendu sans --ecrire refusé', H.analyserArguments(['--attendu=1']).erreurs.length > 0, true);
    verifier('arguments : inconnu refusé', H.analyserArguments(['--tout']).erreurs.length > 0, true);
    verifier('arguments : simulation, écriture annoncée, retrait', [H.analyserArguments([]).erreurs, H.analyserArguments(['--ecrire', '--attendu=1']).erreurs, H.analyserArguments(['--retirer', '--ecrire', '--attendu=1']).retirer], [[], [], true]);
    console.log(`\n${ok} réussis, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
