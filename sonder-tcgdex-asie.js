// ============================================================
// TCGdex SERT-IL LES VISUELS ASIATIQUES ? — l'étape « 0 bis » de PLAN-POKECARDEX.md (condition du testeur : seulement les trous
// qu'AUCUNE autre source ne couvre), 2026-09-27
// ============================================================
//   node sonder-tcgdex-asie.js      (lecture seule : 1 liste de sets par langue, puis 1 set par langue ; rien n'est écrit ni téléchargé)
//   node sonder-tcgdex-asie.js --complet --langues=th,id   (TOUS les sets de ces langues : 1 + N requêtes par langue ; résultat JSON)
// Le client de production (collecte-cartes/tcgdex.js : cadence 2 s, un réessai, garde fermée sans verrou), sous le verrou global
// `tcgdex/__collecteur__`. Budget écrit d'avance : 3 langues × (1 liste + 2 sets) = 9 requêtes au plus. Une IMAGE déclarée par l'API
// (`image`) est ce qui compte ; le dépôt public la déclare par langue sans dire si le fichier existe (PLAN-POKECARDEX.md §2).
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { modeles } = require('./collecte-cartes/schemas');
const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
const { fabriquerClient, VERROU_GLOBAL, VERROU_GLOBAL_MS, API } = require('./collecte-cartes/tcgdex');
const AUTORISES = [/^--complet$/, /^--langues=[a-z,-]+$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const COMPLET = process.argv.includes('--complet');
const LANGUES = (process.argv.find(a => a.startsWith('--langues='))?.slice(10) || 'zh-cn,th,id').split(',').filter(Boolean);

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const M = modeles(cx);
    const vt = fabriquerVerrou({ Modele: M.EtatImages, id: VERROU_GLOBAL, dureeMs: VERROU_GLOBAL_MS, surInsertion: { phase: 'sonde-asie' }, nom: 'verrou global tcgdex (sonde asie)' });
    for (let essai = 0; ; essai++) {
        const t = await vt.prendre();
        if (!t) break;
        if (essai > 600) { console.error('❌ verrou tcgdex non obtenu en 20 min — rien lu'); await fermer(); process.exit(1); }
        await new Promise(r => setTimeout(r, 2000));
    }
    const client = fabriquerClient({ verrou: vt });
    const bilan = {};
    try {
        for (const lg of LANGUES) {
            const sets = await client.getJSON(`${API}/${lg}/sets`);
            if (!Array.isArray(sets)) { bilan[lg] = { sets: null, note: `réponse ${sets === null ? '404' : typeof sets}` }; continue; }
            // sonde : deux sets (le plus récent et un du milieu) ; --complet : tous
            const choisis = COMPLET ? sets : [sets[sets.length - 1], sets[Math.floor(sets.length / 2)]].filter(Boolean);
            const detail = [];
            for (const s of choisis) {
                const d = await client.getJSON(`${API}/${lg}/sets/${encodeURIComponent(s.id)}`);
                const cartes = d?.cards || [];
                detail.push({ id: s.id, nom: s.name, serie: d?.serie?.id ?? null, total: d?.cardCount?.total ?? null, cartes: cartes.length, avecImage: cartes.filter(c => c.image).length, exemple: cartes.find(c => c.image)?.image ?? null });
            }
            bilan[lg] = { sets: sets.length, avecLogo: sets.filter(s => s.logo).length, detail };
        }
    } finally { await vt.rendre(); }
    console.log(`requêtes TCGdex : ${client.compteRequetes()}`);
    for (const [lg, b] of Object.entries(bilan)) {
        const cartes = (b.detail || []).reduce((s, d) => s + d.cartes, 0), images = (b.detail || []).reduce((s, d) => s + d.avecImage, 0);
        console.log(`\n══ ${lg} : ${b.sets ?? '—'} sets${b.note ? ` (${b.note})` : ''}${b.avecLogo != null ? ` · ${b.avecLogo} avec logo` : ''} · lus ${(b.detail || []).length} : ${cartes} cartes, ${images} déclarent une image · sets avec au moins une image : ${(b.detail || []).filter(d => d.avecImage).length}`);
        for (const d of (b.detail || []).filter(d => !COMPLET || d.avecImage)) console.log(`   ${d.id} « ${d.nom} » : ${d.cartes} cartes, ${d.avecImage} déclarent une image${d.exemple ? ` (ex. ${d.exemple})` : ''}`);
    }
    if (COMPLET) require('fs').writeFileSync(require('path').join(__dirname, `tcgdex-asie-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify({ le: new Date().toISOString(), requetes: client.compteRequetes(), bilan }, null, 1));
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
