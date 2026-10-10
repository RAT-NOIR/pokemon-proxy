// L'HISTORIQUE DE VALEUR DES SETS — démarrer sur le DERNIER guide en base (testeur, 2026-10-08), puis mesurer.
//   node historiser-dernier-guide.js                  SIMULATION (lecture seule) : combien de lignes, poids par jour et à 365 jours, poids du fichier R2
//   node historiser-dernier-guide.js --mesure         MESURE (lecture seule) : poids RÉEL de la collection et des fichiers R2 (à relancer après 7 jours)
//   node lot-additif.js --quoi="historique de valeur des sets : dernier guide" --collections=sets --compte=histo_valeur_sets -- node historiser-dernier-guide.js --ecrire --confirmer-production
// L'écriture est ADDITIVE (une collection neuve de la base `cartes` + un fichier du bucket PRIVÉ R2_BUCKET_BRUT) et idempotente ; elle passe par
// lot-additif.js. La définition (set, tendance, phare) vit dans collecte-cartes/historique-valeur.js.
require('dotenv').config();
const AUTORISES = [/^--ecrire$/, /^--confirmer-production$/, /^--mesure$/];
const args = process.argv.slice(2);
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const ecrire = args.includes('--ecrire'), mesure = args.includes('--mesure');
if (inconnus.length || (ecrire && mesure) || (ecrire && !args.includes('--confirmer-production'))) {
    console.error(`usage : node historiser-dernier-guide.js [--mesure | --ecrire --confirmer-production]${inconnus.length ? ` — argument inconnu : ${inconnus.join(' ')}` : ''}`);
    process.exit(2);
}
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const H = require('./collecte-cartes/historique-valeur');
const r2 = require('./collecte-cartes/r2');
const { calculateObjectSize } = require('bson');
const mo = n => `${(n / 1e6).toFixed(2)} Mo`;

(async () => {
    const { cartes, prod, fermer } = await ouvrirConnexions({ production: true });
    const bucket = process.env.R2_BUCKET_BRUT;
    try {
        await r2.verifierBucket(bucket);
        if (mesure) {
            const col = cartes.db.collection(H.COLLECTION);
            const n = await col.countDocuments({});
            if (!n) { console.log(`aucune ligne dans ${H.COLLECTION} : rien à mesurer (l'historique n'a pas démarré)`); return; }
            const jours = await col.distinct('jour');
            const st = await cartes.db.command({ collStats: H.COLLECTION });
            const cles = await r2.listerPrefixe(bucket, 'historique-prix/');
            let octets = 0; for (const c of cles) octets += (await r2.lireBinaire(bucket, c)).length;
            console.log(`\n════ POIDS RÉEL (dénominateur : ${n} lignes, ${jours.length} jours distincts : ${jours.sort()[0]} → ${jours.sort().at(-1)}) ════`);
            console.log(`   ${H.COLLECTION} : données ${mo(st.size)} · stockage ${mo(st.storageSize)} · index ${mo(st.totalIndexSize)} · total ${mo(st.storageSize + st.totalIndexSize)}`);
            console.log(`   par jour : ${mo((st.storageSize + st.totalIndexSize) / jours.length)} → à 365 jours ≈ ${mo((st.storageSize + st.totalIndexSize) / jours.length * 365)}`);
            console.log(`   R2 historique-prix/ : ${cles.length} fichiers, ${mo(octets)} (${mo(octets / Math.max(1, cles.length))} par jour → ≈ ${mo(octets / Math.max(1, cles.length) * 365)} à 365 jours)`);
            const hors = jours.length !== cles.length ? `🔴 ${jours.length} jours en base contre ${cles.length} fichiers R2` : '✅ autant de jours en base que de fichiers R2';
            console.log(`   ${hors}`);
            const s = await cartes.db.command({ dbStats: 1 });
            console.log(`   base cartes : données ${mo(s.dataSize)} · stockage ${mo(s.storageSize)} · index ${mo(s.indexSize)} (la grappe se lit avec mesurer-taille-bases.js)`);
            return;
        }
        const r = await H.historiserGuide({ prod: prod.db, cartes: cartes.db, r2, bucket, ecrire });
        const L = r.aEcrire || [];
        console.log(`\n════ ${ecrire ? 'ÉCRIT' : 'SIMULATION (rien d\'écrit)'} — guide du ${r.jour} ════`);
        console.log(`   lignes : ${r.lignes} (sets publiés) · déjà en base pour ce jour : ${r.dejaLignes}`);
        if (!ecrire) {
            const poids = L.reduce((t, l) => t + calculateObjectSize(l), 0), index = r.lignes * 60;   // ~60 o par entrée de l'index _id (estimation, la mesure réelle tranche)
            console.log(`   poids BSON des lignes : ${mo(poids)} (moyenne ${Math.round(poids / r.lignes)} o) + index _id ≈ ${mo(index)} → ≈ ${mo(poids + index)} par jour, ≈ ${mo((poids + index) * 365)} à 365 jours`);
            const valorises = L.reduce((t, l) => t + l.produitsValorises, 0), tous = L.reduce((t, l) => t + l.produits, 0);
            console.log(`   produits valorisés : ${valorises} sur ${tous} · sets à valeur 0 : ${L.filter(l => !l.valeurCt).length} sur ${L.length} · valeur totale ${(L.reduce((t, l) => t + l.valeurCt, 0) / 100).toFixed(2)}`);
            const top = [...L].sort((a, b) => b.valeurCt - a.valeurCt).slice(0, 3).map(l => `${l._id.split('|')[0]} ${l.valeurCt / 100} (phare idProduct ${l.phare?.idProduct} à ${(l.phare?.prixCt ?? 0) / 100})`);
            console.log(`   3 sets les plus valorisés : ${top.join(' · ')}`);
        }
        console.log(`   fichier R2 ${r.fichier.cle} : ${r.fichier.tendances} tendances, ${(r.fichier.octets / 1024).toFixed(0)} Ko compressé ≈ ${mo(r.fichier.octets * 365)} à 365 jours · ${r.fichier.dejaPresent ? 'DÉJÀ présent' : 'à écrire'}`);
        console.log(`   statut : ${r.statut}`);
    } finally { await fermer(); }
})().catch(e => { console.error(`❌ ${String(e.message).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>')}`); process.exit(1); });
