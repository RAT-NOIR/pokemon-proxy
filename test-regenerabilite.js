// Banc pur de regenerabilite.js — AUCUNE base ouverte. Le libelle « regenerable » se merite : il faut une preuve ecrite.
const fs = require('fs');
const path = require('path');
const R = require('./regenerabilite');

let ok = 0, ko = 0;
function verifier(nom, obtenu, attendu) {
    const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
    if (bon) ok++; else ko++;
    console.log(`${bon ? '✅' : '❌'} ${nom}${bon ? '' : ` — obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`}`);
}

// 1. les trois cas de l'enonce
verifier('collection inventee zz_neuve => inconnue (le defaut n\'est JAMAIS « regenerable »)', R.libelleRegeneration('zz_neuve'), 'inconnue');
verifier('histo_valeur_sets => non-regenerable', R.libelleRegeneration('histo_valeur_sets'), 'non-regenerable');
verifier('references_image => regenerable', R.libelleRegeneration('references_image'), 'regenerable');
verifier('entree absurde (undefined, vide, objet) => inconnue', [undefined, '', {}, null].map(R.libelleRegeneration), ['inconnue', 'inconnue', 'inconnue', 'inconnue']);
verifier('un nom Object.prototype (constructor, toString) ne passe pas pour classe', ['constructor', 'toString', '__proto__'].map(R.libelleRegeneration), ['inconnue', 'inconnue', 'inconnue']);

// 2. les collections REELLES des deux bases (relevees le 2026-10-10, backup-collections.js sans --collections)
const REEL = {
    test: { cardprices: 'regenerable', catalogue_export_meta: 'inconnue', catalogue_produits: 'regenerable', codes_set: 'non-regenerable', credits: 'non-regenerable',
        evenements_stripe: 'non-regenerable', guide_prix: 'non-regenerable', guide_prix_meta: 'inconnue', journal_scans: 'non-regenerable', numeros_cartes: 'non-regenerable',
        questions: 'non-regenerable', quotas: 'non-regenerable', quotas_semaine: 'non-regenerable', references_image: 'regenerable', remboursements: 'non-regenerable',
        remboursements_questions: 'non-regenerable' },
    cartes: { cartes: 'non-regenerable', cartes_produits: 'non-regenerable', collecte_etat: 'inconnue', collecte_images_etat: 'inconnue', file_images: 'regenerable',
        histo_valeur_sets: 'non-regenerable', images: 'non-regenerable', restes: 'inconnue', sets: 'non-regenerable', tcgdex_sets: 'inconnue', tpc_fiches: 'inconnue' }
};
for (const [base, table] of Object.entries(REEL)) {
    const noms = Object.keys(table);
    verifier(`base ${base} : ${noms.length} collections classees comme releve`, Object.fromEntries(noms.map(n => [n, R.libelleRegeneration(n)])), table);
}

// 3. les listes sont fermees et disjointes ; chaque REGENERABLE porte sa raison
const { REGENERABLES, NON_REGENERABLES } = R;
verifier('REGENERABLES et NON_REGENERABLES sont disjointes', Object.keys(REGENERABLES).filter(n => NON_REGENERABLES.includes(n)), []);
verifier('chaque regenerable porte une raison non vide (la commande qui la refait)', Object.entries(REGENERABLES).filter(([, r]) => typeof r !== 'string' || r.trim().length < 10).map(([n]) => n), []);

// 4. le script s'en sert pour les DEUX impressions, et ne contient plus le libelle par defaut
const src = fs.readFileSync(path.join(__dirname, 'backup-collections.js'), 'utf8');
verifier('backup-collections.js importe regenerabilite', /require\('\.\/regenerabilite'\)/.test(src), true);
verifier('backup-collections.js appelle libelleRegeneration aux deux impressions', (src.match(/libelleRegeneration\(/g) || []).length >= 2, true);
verifier('backup-collections.js ne code plus « (régénérable) » en dur', /\(régénérable\)/.test(src), false);

console.log(`\n${ok} passes, ${ko} en echec (sur ${ok + ko})`);
process.exit(ko ? 1 : 0);
