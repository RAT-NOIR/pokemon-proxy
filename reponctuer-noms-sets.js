// ============================================================
// LA PONCTUATION DES NOMS DE SETS — `sets.nomAffichage`, depuis une source DÉJÀ EN BASE
// ============================================================
//   node reponctuer-noms-sets.js            (mesure seule, c'est le défaut)
//   node reponctuer-noms-sets.js --ecrire
//
// 🔴 CE SCRIPT EXISTE PARCE QUE LE §26 ÉTAIT FAUX, ET SA SONDE EST LA PLUS EMBARRASSANTE DES SEPT :
// LA SOURCE N'ÉTAIT PAS AILLEURS, ELLE ÉTAIT DÉJÀ DANS NOTRE BASE. Le §26 disait « la ponctuation
// est perdue et ne se devine pas ». Les deux moitiés de la phrase sont exactes — « Gold-Silver-to-a-
// New-World » ne porte pas de virgule, et on n'a pas le droit d'en inventer une. Mais on n'avait pas
// à la DEVINER : `bulba.expansion` porte le nom ponctué, il est en base depuis la collecte, et
// personne ne lui a posé la question. **Écrire « ça ne se devine pas » sans vérifier qu'on n'avait
// pas à deviner est la même faute que de conclure d'un zéro qu'on n'a pas ouvert.**
//
// ✅ ET LA CLÉ EST SÛRE PAR CONSTRUCTION, CE QUI EST RARE. Elle n'accepte qu'une expansion dont le
// nom NU — sans accents, sans ponctuation, sans espaces — est IDENTIQUE au nôtre. Deux noms de même
// forme nue sont le même set : la clé ne peut donc ni changer de set, ni créer une collision
// d'affichage (§26), puisqu'elle ne modifie aucun nom nu. Le contrôle des collisions le CONFIRME
// plutôt qu'il ne le découvre — et c'est la bonne façon de le lire.
// 🔑 Une reponctuation n'est pas un appariement : rien n'est apparié, une écriture est corrigée.
//
// ⚠️ LA GARDE DU JUMEAU RESTE ENTIÈRE. Sur un set japonais, `nomEn` désigne l'homologue occidental
// (§26) — mais ici on ne lit pas `nomEn` : on lit l'expansion que la page déclare, et on exige
// l'égalité de la forme nue avec le nom qu'on affiche DÉJÀ. Un nom de jumeau a une forme nue
// différente (« Base Set » contre « Expansion Pack »), donc il est écarté par la clé elle-même.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');

const nu = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const aDeLaPonctuation = s => /[,&+:.'’!?()…-]/.test(String(s || ''));

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const sets = await cx.db.collection('sets')
        .find({ nomAffichage: { $nin: [null, ''] } }, { projection: { code: 1, region: 1, nomAffichage: 1, nomAffichageSource: 1, bulba: 1 } })
        .toArray();
    console.log(`\n════ DÉNOMINATEUR : ${sets.length} sets portent un nomAffichage ════`);

    let memeNom = 0, sansBulba = 0, nuDifferent = 0;
    const gagnes = [];
    for (const s of sets) {
        const exps = [].concat(s.bulba?.expansion || []).filter(Boolean);
        if (!exps.length) { sansBulba++; continue; }
        const jumelle = exps.find(e => nu(e) === nu(s.nomAffichage));
        if (!jumelle) { nuDifferent++; continue; }
        memeNom++;
        if (jumelle !== s.nomAffichage && aDeLaPonctuation(jumelle)) gagnes.push({ s, propose: jumelle });
    }
    console.log(`   même forme nue chez Bulbapedia (même set, garanti) : ${memeNom}`);
    console.log(`   sans bulba.expansion : ${sansBulba} · forme nue différente, on ne touche pas : ${nuDifferent}`);
    console.log(`\n   🔑 ${gagnes.length} SETS GAGNENT UNE PONCTUATION :`);
    for (const g of gagnes)
        console.log(`      ${String(g.s.code).padEnd(9)} ${String(g.s.region || '?').padEnd(10)} « ${g.s.nomAffichage} »  →  « ${g.propose} »`);

    // ⚖️ LE CONTRÔLE DU §26 : deux sets ne peuvent pas porter le même nom à l'écran.
    const apres = new Map(sets.map(s => [s.code, s.nomAffichage]));
    for (const g of gagnes) apres.set(g.s.code, g.propose);
    const parNu = new Map();
    for (const [c, n] of apres) (parNu.get(nu(n)) || parNu.set(nu(n), []).get(nu(n))).push(c);
    const collisions = [...parNu.entries()].filter(([, l]) => l.length > 1);
    console.log(`\n   ⚖️ un nom d'affichage par set, après reponctuation : ${collisions.length} collision(s) ${collisions.length ? '🔴' : '✅'}`);
    for (const [k, l] of collisions.slice(0, 10)) console.log(`      « ${k} » → ${l.join(' · ')}`);
    console.log(`   ⚠️ la reponctuation ne change AUCUNE forme nue, donc elle ne PEUT PAS créer de collision : ce contrôle confirme, il ne découvre pas.`);
    if (collisions.length) { console.error(`\n🔴 ARRÊT : une collision signifie que la clé ne fait pas ce qu'elle dit. Rien n'est écrit.`); await fermer(); process.exit(1); }

    if (!ecrire) { console.log(`\n   (mesure seule — relancer avec --ecrire)`); await fermer(); return; }
    let ecrits = 0;
    for (const g of gagnes) {
        await cx.db.collection('sets').updateOne({ _id: g.s._id }, {
            $set: {
                nomAffichage: g.propose,
                // ⚠️ ON GARDE CE QU'ON REMPLACE. Un nom d'affichage est ce que l'utilisateur voit ; si
                // la reponctuation se révélait fausse sur un set, il faut pouvoir dire ce qu'il y avait
                // avant sans relire un commit.
                nomAffichageAvant: g.s.nomAffichage,
                nomAffichageSourceAvant: g.s.nomAffichageSource ?? null,
                nomAffichageSource: 'bulbapedia:expansion (reponctuation)',
                nomAffichagePreuve: `« ${g.s.nomAffichage} » et « ${g.propose} » ont la MÊME forme nue (« ${nu(g.propose)} ») : même set, garanti. La ponctuation vient de bulba.expansion, déjà en base, 0 requête. Aucune forme nue n'est modifiée, donc aucune collision d'affichage possible (§26).`,
                nomAffichageLe: new Date()
            }
        });
        ecrits++;
    }
    const relu = await cx.db.collection('sets').countDocuments({ nomAffichageSource: 'bulbapedia:expansion (reponctuation)' });
    console.log(`\n   ✅ ÉCRITS : ${ecrits} · relu en base : ${relu} sets portent la reponctuation`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
