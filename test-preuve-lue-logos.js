// Banc du mode « source unique + preuve lue » (collecte-cartes/preuve-lue-logos.js, poser-niveau-logos.js --preuve-lue=<table>) : états FABRIQUÉS, aucune base.
//   node test-preuve-lue-logos.js
// Décision du testeur (2026-11-01) : le nom du set est lu sur le logo et concorde nom pour nom avec la fiche ; sinon le logo reste vide.
const R = require('./collecte-cartes/preuve-lue-logos');
const P = require('./poser-niveau-logos');
const { LOGOS_GENERIQUES, LOGOS_COPIES, LOGOS_DU_COUPLE } = require('./collecte-cartes/langue-logo');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const GEN = [...LOGOS_GENERIQUES.keys()][0], COPIE = [...LOGOS_COPIES.keys()][0], COUPLE = [...LOGOS_DU_COUPLE.keys()][0];

const L = { set: 'Sun-Moon-Promos', fichier: 'Logo JP/SMP.png', cleR2: 'logos/manuel/Logo-JP/SMP.png', sha256: 'aa'.repeat(32), sha1: 'bb'.repeat(20),
    sourceBase: 'manuel', texteLu: 'ポケットモンスター サン / ポケットモンスター ムーン Promos', nomFiche: 'Sun Moon Promos', le: '2026-11-01', regardee: true };
const entree = (o = {}) => ({ source: 'manuel', fichier: L.fichier, cleR2: L.cleR2, sha256: L.sha256, niveau: 'inconnu', ...o });
const set = (o = {}, e = entree()) => ({ _id: L.set, logo: e, ...o });
const plan = (sets, lignes = [L]) => R.aPoserPreuveLue(sets, R.lignesDePreuves(lignes));

// la table : une garde écrite par ce qu'elle AUTORISE
const lire = lignes => { try { return R.lignesDePreuves(lignes).size; } catch (e) { return `refus: ${e.message.slice(0, 40)}`; } };
verifier('table : une ligne complète est lue', lire([L]), 1);
verifier('table : texte lu vide, fiche vide, non regardée, date mal formée, ni clé ni empreinte, fichier en double, set vide, table vide → REFUS', [
    lire([{ ...L, texteLu: '' }]), lire([{ ...L, nomFiche: '' }]), lire([{ ...L, regardee: false }]), lire([{ ...L, le: '01/11' }]),
    lire([{ ...L, cleR2: undefined, sha256: undefined, sha1: undefined }]), lire([L, L]), lire([{ ...L, set: '' }]), lire([]), lire(undefined)]
    .map(x => typeof x === 'string' && x.startsWith('refus')), [true, true, true, true, true, true, true, true, true]);

// le plan : un seul chemin mène à l'écriture
const p1 = plan([set()]);
verifier('niveau inconnu + fichier identique : à poser', p1.plan.map(x => [x._id, x.chemin, x.fichier]), [[L.set, 'logo', L.fichier]]);
verifier('logoFr : le champ qui porte le fichier est trouvé', plan([{ _id: L.set, logoFr: entree() }]).plan.map(x => x.chemin), ['logoFr']);
verifier('niveau déjà posé (officiel, semi-officiel, compose, generique) : rien, raison dite', ['officiel', 'semi-officiel', 'compose', 'generique'].map(n => { const r = plan([set({}, entree({ niveau: n }))]); return [r.plan.length, r.refus.length, /niveau/.test(r.refus[0]?.raison ?? '')]; }), [[0, 1, true], [0, 1, true], [0, 1, true], [0, 1, true]]);
verifier('aucun niveau écrit (champ sans niveau) : rien (c\'est le mode additif)', (r => [r.plan.length, r.refus.length])(plan([set({}, entree({ niveau: undefined }))])), [0, 1]);
verifier('fichier différent : rien', (r => [r.plan.length, /fichier/.test(r.refus[0]?.raison)])(plan([set({}, entree({ fichier: 'Logo JP/AUTRE.png' }))])), [0, true]);
verifier('même fichier mais clé R2 différente : rien', (r => [r.plan.length, /différent de celui lu/.test(r.refus[0]?.raison)])(plan([set({}, entree({ cleR2: 'logos/manuel/autre.png' }))])), [0, true]);
verifier('même fichier mais empreinte différente : rien', (r => [r.plan.length, /différent de celui lu/.test(r.refus[0]?.raison)])(plan([set({}, entree({ sha256: 'cc'.repeat(32) }))])), [0, true]);
verifier('même fichier, entrée sans aucune clé ni empreinte à comparer : rien (je ne sais pas = bloque)', (r => [r.plan.length, r.refus.length])(plan([set({}, entree({ cleR2: undefined, sha256: undefined }))])), [0, 1]);
verifier('même fichier, clé identique, empreinte absente : à poser (une preuve d\'identité suffit, aucune contredite)', plan([set({}, entree({ sha256: undefined }))]).plan.length, 1);
verifier('set absent de la base : listé avec sa raison', (r => [r.plan.length, /absent/.test(r.refus[0]?.raison)])(plan([{ _id: 'Autre', logo: entree() }])), [0, true]);
verifier('la ligne nomme un autre set que celui qui porte le fichier : rien', (r => [r.plan.length, r.refus.length])(plan([{ _id: 'Autre', logo: entree() }, { _id: L.set }])), [0, 1]);
verifier('set générique (logoGenerique: true), empreinte générique, copie de Pokécardex, logo du couple : rien', [
    plan([set({ logoGenerique: true })]).plan.length, plan([set({}, entree({ sha1: GEN }))], [{ ...L, sha1: GEN }]).plan.length,
    plan([set({}, entree({ sha1: COPIE }))], [{ ...L, sha1: COPIE }]).plan.length, plan([set({}, entree({ fichier: COUPLE }))], [{ ...L, fichier: COUPLE }]).plan.length], [0, 0, 0, 0]);
verifier('source en base différente de celle vue à la lecture : rien', plan([set({}, entree({ source: 'tcgdex:en' }))]).plan.length, 0);
verifier('chaque ligne est comptée une fois : plan + refus = lignes de la table', (r => r.plan.length + r.refus.length)(plan([set()], [L, { ...L, set: 'B', fichier: 'Logo JP/B.png', cleR2: 'k' }])), 2);
verifier('le plan ne touche pas la source : aucune clé `source` dans ce qui s\'écrit', Object.keys(R.champsAEcrire(p1.plan[0], '2026-11-01T10:00:00.000Z')).some(k => /source$/.test(k)), false);
const w = R.champsAEcrire(p1.plan[0], '2026-11-01T10:00:00.000Z');
verifier('ce qui s\'écrit : niveau officiel, niveauAvant inconnu, niveauLe, niveauPreuve', [w['logo.niveau'], w['logo.niveauAvant'], w['logo.niveauLe'], Object.keys(w).length], ['officiel', 'inconnu', '2026-11-01T10:00:00.000Z', 4]);
verifier('niveauPreuve : texte lu, nom de la fiche, date de lecture, source unique', [/source unique, preuve lue/.test(w['logo.niveauPreuve']), w['logo.niveauPreuve'].includes(`« ${L.texteLu} »`), w['logo.niveauPreuve'].includes('« Sun Moon Promos »'), /lu le 2026-11-01/.test(w['logo.niveauPreuve']), /seconde source/.test(w['logo.niveauPreuve'])], [true, true, true, true, false]);

// arguments
const a = P.analyserArguments;
verifier('arguments : --preuve-lue=<table> accepté en simulation et avec --ecrire --attendu', [a(['--preuve-lue=x.json']).erreurs, a(['--preuve-lue=x.json']).preuveLue, a(['--preuve-lue=x.json', '--ecrire', '--attendu=167']).erreurs], [[], 'x.json', []]);
verifier('arguments : --preuve-lue sans chemin, ou avec --reclasser : refus ; --ecrire sans --attendu : refus', [a(['--preuve-lue=']).erreurs.length > 0, a(['--preuve-lue=x.json', '--reclasser']).erreurs.length > 0, a(['--preuve-lue=x.json', '--ecrire']).erreurs.length > 0], [true, true, true]);
verifier('plan = attendu : écriture permise ; plan ≠ attendu : refus AVANT écriture', [P.verifierPlan(167, 167), typeof P.verifierPlan(166, 167)], [null, 'string']);

// bout en bout sur une FAUSSE collection `sets` (aucune base) : simulation, refus d'attendu, écriture, relecture
(async () => {
    const faux = docs => ({ docs, ecritures: 0,
        find() { return { toArray: async () => JSON.parse(JSON.stringify(docs)) }; },
        async updateOne(f, u) {
            const d = docs.find(x => x._id === f._id); if (!d) return { modifiedCount: 0 };
            const get = p => p.split('.').reduce((o, k) => o?.[k], d);
            for (const [k, v] of Object.entries(f)) { if (k === '_id') continue; const x = get(k); if (v && v.$exists === false ? x !== undefined : x !== v) return { modifiedCount: 0 }; }
            for (const [k, v] of Object.entries(u.$set)) { const ks = k.split('.'); const last = ks.pop(); ks.reduce((o, q) => o[q], d)[last] = v; }
            this.ecritures++; return { modifiedCount: 1 };
        } });
    const muet = () => {}, table = R.lignesDePreuves([L]);
    const lancer = async (S, o) => P.appliquerPreuveLue({ S, sets: await S.find().toArray(), proj: {}, table, journal: muet, erreur: muet, ...o });
    const base = () => [set(), { _id: 'Autre', logo: entree({ fichier: 'x.png' }) }];
    let S = faux(base()); let r = await lancer(S, { ecrire: false });
    verifier('simulation : 1 à écrire, rien écrit', [r.plan.length, S.ecritures, r.code], [1, 0, 0]);
    S = faux(base()); r = await lancer(S, { ecrire: true, attendu: 2 });
    verifier('--attendu ≠ plan : refus (code 2), AUCUNE écriture', [r.code, S.ecritures], [2, 0]);
    S = faux(base()); r = await lancer(S, { ecrire: true, attendu: 1 });
    const d = S.docs[0].logo;
    verifier('--attendu = plan : écrit, relu, concordant (code 0)', [r.code, r.ecrits, d.niveau, d.niveauAvant, d.source, /preuve lue/.test(d.niveauPreuve)], [0, 1, 'officiel', 'inconnu', 'manuel', true]);
    verifier('les autres sets ne bougent pas', S.docs[1].logo.niveau, 'inconnu');
    S = faux([set({}, entree({ niveau: 'compose' }))]); r = await lancer(S, { ecrire: true, attendu: 0 });
    verifier('niveau déjà posé : 0 écrit même avec attendu 0, niveau intact', [r.ecrits, S.ecritures, S.docs[0].logo.niveau], [0, 0, 'compose']);
    // la table réelle du dépôt est lisible et complète : 167 lues concordantes, moins les 19 sous-noms chinois d'un caractère retirés par le coordinateur (01/11)
const reelle = R.lignesDePreuvesDuFichier();
verifier('table réelle : 148 lignes lues', reelle.size, 148);
console.log(`\n${ok} passés, ${ko} en échec`);
if (ko) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
