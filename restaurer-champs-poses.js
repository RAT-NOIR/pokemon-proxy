// ============================================================
// RESTAURER LES ILLUSTRATEURS D'IMPRESSION EFFACÉS PAR UNE RÉÉCRITURE DU PARSEUR — depuis une sauvegarde (2026-09-24)
// ============================================================
//   node restaurer-champs-poses.js --depuis=backup-2026-09-24-lot-004010            (mesure, rien d'écrit)
//   node restaurer-champs-poses.js --depuis=backup-2026-09-24-lot-004010 --ecrire
//
// Les recollectes de xASC et HSP du 2026-09-24 ont posé `impressions` d'un `$set` et effacé les champs que
// construire-illustrateurs.js avait posés DANS ce tableau (collecte-cartes/impressions-posees.js : le défaut, et sa parade).
// Cet outil les rend depuis la sauvegarde complète de `cartes` prise AVANT : il n'écrit QUE là où le champ est ABSENT
// aujourd'hui, et seulement si la sauvegarde porte la même impression (même clé). Il ne remplace aucune valeur.
// L'écriture est positionnelle ET conditionnée : le filtre relit la clé de l'impression à cet index, et l'absence du champ.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { CHAMPS_POSES_APRES, cleImpression } = require('./collecte-cartes/impressions-posees');

const AUTORISES = [/^--depuis=backup-[\w-]+$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
const depuis = process.argv.find(a => a.startsWith('--depuis='))?.slice(9);
if (inconnus.length || !depuis) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --depuis=backup-… [--ecrire]`); process.exit(2); }

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const fichier = path.join(__dirname, depuis, 'cartes.json');
    const sauvegarde = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    if (!sauvegarde.length) throw new Error(`${fichier} : sauvegarde VIDE — elle ne peut rien restaurer`);
    const parId = new Map(sauvegarde.map(c => [c._id, c]));
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const C = cx.db.collection('cartes');
    let cartes = 0, impressions = 0, absentes = 0, sansReference = 0;
    const ops = [];
    for await (const c of C.find({}, { projection: { impressions: 1 } })) {
        cartes++;
        const ref = new Map((parId.get(c._id)?.impressions || []).map(i => [cleImpression(i), i]));
        (c.impressions || []).forEach((i, idx) => {
            impressions++;
            const manquants = CHAMPS_POSES_APRES.filter(k => !(k in i));
            if (!manquants.length) return;
            absentes++;
            const r = ref.get(cleImpression(i));
            const aRendre = r ? manquants.filter(k => k in r) : [];
            if (!aRendre.length) { sansReference++; return; }
            const filtre = { _id: c._id, [`impressions.${idx}.tirage`]: i.tirage, [`impressions.${idx}.expansion`]: i.expansion, [`impressions.${idx}.numero`]: i.numero ?? null };
            for (const k of aRendre) filtre[`impressions.${idx}.${k}`] = { $exists: false };
            ops.push({ updateOne: { filter: filtre, update: { $set: Object.fromEntries(aRendre.map(k => [`impressions.${idx}.${k}`, r[k]])) } }, nom: r.illustrateur });
        });
    }
    const cartesTouchees = new Set(ops.map(o => o.updateOne.filter._id)).size;
    console.log(`\n════ RÉFÉRENCE ${depuis} : ${sauvegarde.length} cartes · base : ${cartes} cartes, ${impressions} impressions ════`);
    console.log(`   impressions sans ${CHAMPS_POSES_APRES.join('/')} : ${absentes} · à restaurer depuis la référence : ${ops.length} (${ops.filter(o => o.nom).length} nommées) sur ${cartesTouchees} cartes · sans référence (cartes ou impressions neuves) : ${sansReference}`);
    if (!ecrire) { console.log('\n   (mesure seule — --ecrire restaure)'); await fermer(); return; }
    let ecrites = 0;
    for (let i = 0; i < ops.length; i += 500) ecrites += (await C.bulkWrite(ops.slice(i, i + 500).map(({ updateOne }) => ({ updateOne })), { ordered: false })).modifiedCount;
    let restantes = 0;
    for await (const c of C.find({}, { projection: { impressions: 1 } })) for (const i of c.impressions || []) if (CHAMPS_POSES_APRES.some(k => !(k in i))) restantes++;
    console.log(`   RELU : ${ecrites}/${ops.length} impressions restaurées · sans illustrateur aujourd'hui : ${absentes} → ${restantes} (attendu ${absentes - ops.length}) ${restantes === absentes - ops.length ? '✅' : '🔴'}`);
    await fermer();
    if (restantes !== absentes - ops.length) process.exit(1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
