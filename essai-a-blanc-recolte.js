// ESSAI D'ÉCRITURE À BLANC d'un collecteur de la RÉCOLTE sur les DONNÉES RÉELLES, sans rien écrire nulle part :
//   node essai-a-blanc-recolte.js --source=ppr [--dossier=<sorties>]
// Lit en LECTURE SEULE (MONGODB_CARTES_LECTURE_URI) les cartes, les documents `images` et les sets des unités du plan, les charge dans des MODÈLES EN MÉMOIRE (faux-modeles-cardtrader.js),
// puis rejoue la VRAIE fonction d'écriture (recolte-commun.js `ecrire`) sur le CACHE RÉEL : dépôt R2 simulé (compté), jointure, remplacement des basses définitions, garde, bilan.
// Rend : ce que l'écriture ferait (joints, remplacées, déposées, garde) et le --attendu. Aucune écriture en base, aucune écriture R2, aucune requête réseau.
require('dotenv').config();
const path = require('path');
const RC = require('./collecte-cartes/recolte-commun');
const CLI = require('./collecte-cartes/recolte-cli');
const { fauxModeles } = require('./faux-modeles-cardtrader');

const args = process.argv.slice(2);
const code = args.find(a => /^--source=(ppr|tcs)$/.test(a))?.slice(9);
const inconnus = args.filter(a => !/^--source=(ppr|tcs)$/.test(a) && !/^--dossier=.+$/.test(a));
if (!code || inconnus.length) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}--source=ppr|tcs est obligatoire`); process.exit(2); }
const SRC = code === 'ppr' ? require('./collecte-cartes/pokipair').SRC : require('./collecte-cartes/tcgcsv').SRC;
const DOSSIER = args.find(a => a.startsWith('--dossier='))?.slice(10) ?? 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S8\\RECOLTE';

(async () => {
    process.env.R2_BUCKET_IMAGES = process.env.R2_BUCKET_IMAGES || 'essai-a-blanc-sans-bucket';
    const F = CLI.fichiersDe(code, RC.verifierChemin(DOSSIER), undefined);
    const plan = RC.lireJson(F.plan, null);
    if (!plan?.unites) throw new Error(`${F.plan} absent`);
    const indexImages = RC.lireJson(F.images, {});
    const aFaire = plan.unites.filter(u => u.decision?.action === 'ajouter');
    const { ouvrirLecture } = require('./collecte-cartes/ouvrir-lecture');
    const lecture = await ouvrirLecture();
    if (!lecture) throw new Error('MONGODB_CARTES_LECTURE_URI absente : l\'essai à blanc ne lit que par la connexion de lecture seule');
    try {
        const db = lecture.cartes.db;
        const ids = [...new Set(aFaire.map(u => u.carteId))];
        const cartes = await db.collection('cartes').find({ _id: { $in: ids } }).toArray();
        const images = await db.collection('images').find({ carteId: { $in: ids } }).toArray();
        const slugs = [...new Set(aFaire.map(u => u.slugSet))];
        const sets = await db.collection('sets').find({ _id: { $in: slugs } }).project({ tirage: 1, region: 1, code: 1 }).toArray();
        console.log(`LU (lecture seule) : ${cartes.length} cartes, ${images.length} documents images, ${sets.length} sets ; ${aFaire.length} unités à ajouter`);
        const avant = new Map(cartes.map(c => [c._id, (c.images || []).length]));
        const { M, etat, journal } = fauxModeles({ cartes, images, sets });
        const deposes = [];
        const sortie = [];
        const l = console.log, e = console.error;
        console.log = (...a) => sortie.push(a.join(' ')); console.error = (...a) => sortie.push(`ERR ${a.join(' ')}`);
        let r;
        try {
            r = await RC.ecrire({ SRC, unites: aFaire, M, dossierCache: F.cache, indexImages, attendu: aFaire.length, deposer: async (b, c) => { deposes.push(c); }, vignetter: async () => ({ vg: { entrees: 0, fabriquees: 0, echecs: 0 } }) });
        } finally { console.log = l; console.error = e; }
        for (const s of sortie) console.log(`   | ${s}`);
        const apresCartes = cartes.map(c => etat.carte(c._id));
        const mmeNb = apresCartes.filter(c => c.images.length === avant.get(c._id)).length;
        const siennes = apresCartes.flatMap(c => c.images.filter(x => x.source === SRC.SOURCE && x.lot === SRC.LOT));
        const remplaces = etat.images().filter(d => d.etat === 'remplace' && d.remplacePar?.source === SRC.SOURCE).length;
        console.log(`ESSAI À BLANC : code ${r.code} · attendu ${r.attendu} · réel ${r.reel} · objets R2 « déposés » (simulés) ${deposes.length} (clés distinctes ${new Set(deposes).size}) · entrées du lot posées ${siennes.length} · documents « remplace » ${remplaces} · cartes au même nombre d'entrées qu'avant ${mmeNb}/${cartes.length} · orphelins ${r.orphelins.length}`);
        for (const x of r.resultats) console.log(`   ${x.code} : ${x.etat} · unités ${x.unites} · déposées ${x.deposees} · joints ${x.joints} · cédées ${x.cedees} · remplacées ${x.remplacees} · garde ${x.garde?.ok ? 'ok' : 'ÉCHEC'} · concordance ${x.concordance}`);
        console.log(`   écritures simulées : ${journal.filter(j => j[0] === 'carte').length} sur cartes, ${journal.filter(j => j[0] === 'image').length} sur images, ${journal.filter(j => j[0] === 'set').length} sur sets (EN MÉMOIRE — rien en base)`);
        process.exitCode = r.code === 0 ? 0 : 1;
    } finally { await lecture.fermer(); }
})().catch(e => { console.error('❌', e.message); process.exitCode = 1; });
void path;
