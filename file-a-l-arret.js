// ============================================================
// LA FILE D'IMAGES EST-ELLE À L'ARRÊT ? — à lancer AVANT toute mesure sur `cartes`
// ============================================================
//   node file-a-l-arret.js
//
// 🔴 POURQUOI CET OUTIL EXISTE (2026-09-12). Trois lectures du même compte, à quelques minutes
// d'intervalle, ont rendu 44, 52 puis 24 orphelines — sur 1 857, 1 865 puis 1 946 entrées. La file
// écrivait pendant que je lisais. Un prompt entier a été construit sur « 41 jointures ratées » qui
// n'ont jamais existé. **Un compte pris pendant qu'un processus écrit ne mesure rien.**
//
// Il rend 0 si la file est à l'arrêt, 1 sinon, et il imprime ce qu'il a regardé — jamais un simple
// « oui ». Trois signaux, parce qu'un seul mentirait : l'état de la file, le verrou global, et la
// fraîcheur de la dernière écriture.

require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');

const FRAIS_MS = 3 * 60 * 1000;   // le battement du verrou global : trois minutes

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions();
    const db = cx.db;
    // ⚠️ ON ÉNUMÈRE L'ÉTAT ACTIF, PAS LES ÉTATS TERMINAUX. Écrit d'abord en `$nin: [attente, fini,
    // refuse]`, ce contrôle a crié sur 26 unités `fait` — un état terminal que la liste ignorait.
    // Un contrôle qui crie sur un cas normal est contourné le jour où il a raison (CLAUDE.md §21).
    // `en-cours` est le SEUL état qu'un collecteur vivant écrit (collecteur-images.js:449).
    const enCours = await db.collection('file_images').find({ etat: 'en-cours' }).toArray();
    const etats = await db.collection('file_images').aggregate([{ $group: { _id: '$etat', n: { $sum: 1 } } }]).toArray();
    // ⚠️ TOUS LES VERROUS, PAS CELUI D'UNE SOURCE. Écrit quand seul artofpkm collectait, ce contrôle ne
    // regardait que `artofpkm/__collecteur__` : le collecteur Bulbapedia (2026-09-13) aurait écrit sans
    // qu'il le voie. Global ou de set, artofpkm ou bulbapedia : un battement frais = quelqu'un travaille.
    const verrous = await db.collection('collecte_images_etat').find({ verrou: { $exists: true } }).project({ verrou: 1 }).toArray();
    const ageDe = v => v?.depuis ? Date.now() - new Date(v.depuis).getTime() : null;
    const frais = verrous.filter(v => ageDe(v.verrou) != null && ageDe(v.verrou) < FRAIS_MS);
    // ⚠️ UN VERROU GLOBAL FRAIS N'EST PAS UNE ÉCRITURE. Depuis d9d4767, le worker en `--boucle` tient le
    // verrou global EN PERMANENCE, y compris quand il dort sur une file vide : le compter criait « la file
    // écrit » sur le cas normal (2026-09-13, pod …-8v8lv, file vide). C'est le verrou de SET qui dit
    // qu'un set est en travail ; le global dit seulement qu'un collecteur est vivant.
    const fraisSet = frais.filter(v => !/\/__collecteur__$/.test(v._id));
    const derniere = await db.collection('images').find({}).sort({ telechargeLe: -1 }).limit(1).project({ telechargeLe: 1 }).toArray();
    const age = derniere[0]?.telechargeLe ? Date.now() - new Date(derniere[0].telechargeLe).getTime() : null;

    const total = await db.collection('images').countDocuments({});
    const attente = await db.collection('file_images').countDocuments({ etat: 'attente' });
    console.log(`file_images    : ${enCours.length} unité(s) « en-cours » ${enCours.length ? '— ' + enCours.map(x => x._id).join(' ') : ''} · ${attente} en attente · tous états : ${etats.map(e => `${e._id}×${e.n}`).join(' ')}`);
    console.log(`verrous        : ${verrous.length} présent(s), ${frais.length} frais dont ${fraisSet.length} de SET${verrous.length ? ' — ' + verrous.map(v => `${v._id} pid ${v.verrou.pid} sur ${v.verrou.hote}, battement il y a ${Math.round(ageDe(v.verrou) / 1000)} s`).join(' · ') : ''}`);
    console.log(`dernière image : ${age == null ? 'aucune' : `il y a ${Math.round(age / 1000)} s`} · ${total} images en base, toutes sources`);

    const bouge = enCours.length > 0 || fraisSet.length > 0 || (age != null && age < FRAIS_MS);
    console.log(bouge
        ? `\n🔴 LA FILE ÉCRIT. Toute mesure sur \`cartes\`, \`cartes_produits\` ou \`images\` prise maintenant est un INSTANTANÉ, pas un dénominateur. Attendre, ou dire dans le rapport que la file tournait.`
        : `\n✅ FILE À L'ARRÊT (rien en cours, aucun verrou de set frais, aucune écriture depuis plus de ${FRAIS_MS / 60000} min${frais.length ? ' ; un collecteur vivant dort sur son verrou global' : ''}). La mesure vaut, et le rapport doit le DIRE.`);
    await fermer();
    process.exit(bouge ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
