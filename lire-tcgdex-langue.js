// ============================================================
// LIRE DANS LE CACHE `tcgdex_sets` LA LISTE ET LES SETS D'UNE AUTRE LANGUE QUE L'ANGLAIS (2026-09-29)
// ============================================================
//   node lire-tcgdex-langue.js --langue=id --sets=SV7s,SV8s,SV9s
//
// Décision du testeur (2026-09-28) : « sets IDTH : indonésien ». Le plan (`collecteur-images-tcgdex.js --plan --langue=id`) et la mise
// en file (`enfiler-tcgdex.js --langue=id`) ne lisent que le CACHE : cet outil le remplit, et rien d'autre — des MÉTADONNÉES (la liste
// des sets, la fiche de chaque set avec ses cartes), jamais une image (LE WORKER RENDER EST LE SEUL COLLECTEUR).
// BUDGET, calculé AVANT (§38) : 1 requête pour la liste + 1 par set, à la cadence du client (2 s), sous le verrou global
// `tcgdex/__collecteur__` — sans lui tenu, le client refuse (garde fermée). Un set déjà en cache ne se redemande pas (reprise).
// Écriture : ajouts dans `tcgdex_sets` (base `cartes`), un document par set lu.
require('dotenv').config();
// ➕ 2026-10-03 : th et ja ; sans --sets, la LISTE seule (1 requête) — de quoi mesurer ce qu'une langue apporterait avant d'y toucher.
const AUTORISES = [/^--langue=(id|th|ja)$/, /^--sets=[\w.-]+(,[\w.-]+)*$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
const LANGUE = process.argv.find(a => a.startsWith('--langue='))?.slice(9);
const SETS = process.argv.find(a => a.startsWith('--sets='))?.slice(7).split(',') ?? [];
if (inconnus.length || !LANGUE) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --langue=id|th|ja [--sets=A,B]`); process.exit(2); }

(async () => {
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { modeles } = require('./collecte-cartes/schemas');
    const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
    const { fabriquerClient, VERROU_GLOBAL, VERROU_GLOBAL_MS } = require('./collecte-cartes/tcgdex');
    const { listeLangue, cartesLangue } = require('./collecte-cartes/tcgdex-cache');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const M = modeles(cx);
    const verrou = fabriquerVerrou({ Modele: M.EtatImages, id: VERROU_GLOBAL, dureeMs: VERROU_GLOBAL_MS, surInsertion: { phase: 'lecture-langue' }, nom: 'verrou global tcgdex (lecture d\'une langue)' });
    const tenu = await verrou.prendre();
    if (tenu) { console.error(`❌ verrou global tcgdex tenu par pid ${tenu.pid} sur ${tenu.hote} (battement il y a ${tenu.ageS} s) — pas de requête à côté`); await fermer(); process.exit(1); }
    try {
        const client = fabriquerClient({ verrou });
        const liste = await listeLangue(cx.db, client, LANGUE);
        console.log(`liste « ${LANGUE} » : ${liste.length} sets (cache ${LANGUE}/__liste__)`);
        for (const id of SETS) {
            if (!liste.some(s => s.id === id)) { console.log(`   ⛔ ${id} : absent de la liste « ${LANGUE} » — rien demandé`); continue; }
            const r = await cartesLangue(cx.db, client, LANGUE, id);
            const avecImage = r.cartes.filter(c => c.image).length;
            console.log(`   ${id} : ${r.cartes.length} cartes, ${avecImage} avec image (${r.cache ? 'déjà en cache' : 'lu'})`);
        }
        console.log(`requêtes faites : ${client.compteRequetes()}`);
    } finally { await verrou.rendre(); await fermer(); }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
