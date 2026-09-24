// ============================================================
// NOMMER LES SETS QUI N'ONT PAS DE `nomAffichage` — la condition de publication du site
// ============================================================
//   node rapatrier-noms-sets.js            (dry-run : le tableau set · nom proposé · source · preuve de région, rien d'écrit)
//   node rapatrier-noms-sets.js --ecrire   (écrit — APRÈS la sauvegarde `backup-collections.js --base=cartes`, et relit)
//
// La page /fr/sets affichait les noms en KANA, illisibles. Le bon nom d'une expansion japonaise est celui que CARDMARKET
// lui donne — en anglais, et il désigne CETTE expansion — : `numeros_cartes.slugSet`, sur le cluster de production que le
// site ne lit pas. On le rapatrie (2026-09-19). La règle vit dans collecte-cartes/nom-affichage.js.
//
// 🔴 2026-09-24 : L'OUTIL NE NOMME PLUS QUE LES SETS SANS NOM. Lancé une fois le 19/09 sur les 439 sets de l'époque, il
// n'a jamais été relancé : les 151 sets créés depuis n'avaient pas de nom (590 − 439 = 151), donc pas de page. Le relancer
// tel qu'il était aurait RÉÉCRIT les 439 noms posés — dont les 28 reponctués (§36) et les départages de collision. Un nom
// posé ne se retouche pas ici ; les collisions se vérifient contre TOUS les noms, posés et proposés.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');
const { proposerNoms } = require('./collecte-cartes/nom-affichage');

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, prod, fermer } = await ouvrirConnexions();
    const S = cx.db.collection('sets');
    const parSlug = new Map();
    for (const L of [...TABLE, ...TABLE_AUTO, ...TABLE_SANS_PAGE]) if (L.slugSet && !parSlug.has(L.slugSet)) parSlug.set(L.slugSet, L);
    const tous = await lireMongo(S, {}, { nom: 'sets' });
    // le slugSet Cardmarket majoritaire de chaque expansion — une agrégation, sur les lignes qui en portent un (§6)
    const g = await prod.db.collection('numeros_cartes').aggregate([
        { $match: { slugSet: { $nin: [null, ''] } } }, { $group: { _id: { exp: '$idExpansion', slug: '$slugSet' }, n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray();
    const slugMajoritaire = new Map(); for (const x of g) if (!slugMajoritaire.has(x._id.exp)) slugMajoritaire.set(x._id.exp, x._id.slug);

    const sansNom = tous.filter(s => typeof s.nomAffichage !== 'string');
    const { proposes, refuses } = proposerNoms(tous, parSlug, slugMajoritaire);
    // l'homologue : un set PUBLIÉ sur la même page Bulbapedia — son nom s'imprime à côté, pour qu'une copie se voie
    const publiesParPage = new Map();
    for (const s of tous) if (typeof s.nomAffichage === 'string' && s.bulba?.pageid != null) (publiesParPage.get(s.bulba.pageid) || publiesParPage.set(s.bulba.pageid, []).get(s.bulba.pageid)).push(s);
    const famille = c => { const id = c.s._id; const t = /Additionals$/.test(id) ? 'Additionals' : /McDonald/i.test(id) ? 'McDonald\'s' : /Trainer-Kit/i.test(id) ? 'Trainer Kit' : (c.s.type || 'non typé'); return `${c.region} · ${t}`; };

    console.log(`\n════ DÉNOMINATEUR : ${tous.length} sets · sans nomAffichage : ${sansNom.length} · proposés : ${proposes.length} · restent sans nom : ${refuses.length} ════`);
    if (proposes.length + refuses.length !== sansNom.length) throw new Error(`proposés + refusés = ${proposes.length + refuses.length} ≠ ${sansNom.length} sets sans nom : un set est perdu ou compté deux fois`);
    console.log('\nset | nom proposé | source | preuve de région | homologue publié sur la même page');
    for (const c of [...proposes].sort((a, b) => famille(a).localeCompare(famille(b)) || a.s._id.localeCompare(b.s._id))) {
        const h = (publiesParPage.get(c.s.bulba?.pageid) || []).map(x => `${x._id} « ${x.nomAffichage} »`).join(', ');
        console.log(`${c.s._id} | ${c.a.nom} | ${c.a.source}${c.collision ? ` — ${c.collision}` : ''} | ${c.preuve} | ${h || '—'}`);
    }
    for (const c of refuses) console.log(`🔴 SANS NOM : ${c.s._id} — ${c.raison}`);
    const parFamille = {}; for (const c of proposes) parFamille[famille(c)] = (parFamille[famille(c)] || 0) + 1;
    const parSource = {}; for (const c of proposes) parSource[c.a.source] = (parSource[c.a.source] || 0) + 1;
    console.log(`\n   par famille : ${Object.entries(parFamille).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    console.log(`   par source  : ${JSON.stringify(parSource)}`);
    const tombeSurCode = proposes.filter(c => c.a.source === 'code');
    if (tombeSurCode.length) console.log(`   ❌ ${tombeSurCode.length} retombent sur leur CODE : ${tombeSurCode.map(c => c.s._id).join(', ')}`);
    if (!ecrire) { console.log('\n   (dry-run — rien d\'écrit. --ecrire après la sauvegarde de la base cartes)'); await fermer(); return; }

    const avant = await S.countDocuments({ nomAffichage: { $type: 'string' } });
    for (const c of proposes) await S.updateOne({ _id: c.s._id, nomAffichage: { $exists: false } }, { $set: {
        nomAffichage: c.a.nom, nomAffichageSource: c.a.source, nomAffichagePreuve: c.preuve, nomCardmarket: c.nomCardmarket, nomsLe: new Date() } });
    for (const c of refuses) await S.updateOne({ _id: c.s._id }, { $set: { nomAffichageRefus: { raison: c.raison, le: new Date(), instrument: 'rapatrier-noms-sets.js' } } });
    const apres = await S.countDocuments({ nomAffichage: { $type: 'string' } });
    const noms = await S.aggregate([{ $match: { nomAffichage: { $type: 'string' } } }, { $group: { _id: '$nomAffichage', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray();
    console.log(`\n   RELU : sets nommés ${avant} → ${apres} (attendu ${avant + proposes.length}) · noms en double : ${noms.length} ${apres === avant + proposes.length && !noms.length ? '✅' : '🔴 NE CONCORDE PAS'}`);
    await fermer();
    if (apres !== avant + proposes.length || noms.length) process.exit(1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
