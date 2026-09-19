// ============================================================
// LES LIGNES « SANS PAGE » — les expansions que NOS PAGES déclarent et que la table ignore
// ============================================================
//   node collecte-cartes/generer-table-sans-page.js [--ecrire]
//
// 🔑 L'ÉNUMÉRATION SE RETOURNE. Toute notre collecte part de la Setlist d'une PAGE DE SET : on demande à
// un set quelles cartes il contient. Des dizaines d'expansions Cardmarket n'ont pas de page — decks,
// coffrets, starter sets — et ont donc été classées « irréductibles ». Elles ne le sont pas : les cartes,
// elles, DÉCLARENT leur expansion (`jpexpansion=`) sur des pages qu'on a déjà lues. On demande donc aux
// cartes à quel set elles appartiennent. 118 noms d'expansion sont dans ce cas (2026-09-19), zéro requête.
//
// 🔴 LA CLÉ EST L'ÉGALITÉ DU NOM, ET LA COUVERTURE N'EST QU'UN CONTRÔLE (§31). La première version
// appariait par la COUVERTURE DES NUMÉROS et rendait « Base-Set → White Flare 100 % » : sur des plages
// denses de petits entiers, toute expansion couvre toute autre, et le total flatteur (6 568 produits) en
// était le symptôme. Ici, deux expansions sont appariées quand leurs NOMS sont égaux (accents, « & » et
// ponctuation normalisés) ; la couverture s'imprime à côté et décide seulement si la ligne est VÉRIFIÉE.
//
// ⚠️ ET LE SEUIL PORTE CE QU'IL PROTÈGE (§23). Sous 0,9 de couverture, les numéros Cardmarket ne sont pas
// ceux des impressions déclarées : la jointure par numéro ne prendra presque rien et tomberait sur le
// repli par NOM — celui qui a rattaché un produit de Base Set à sept cartes « Bulbasaur ». La ligne est
// donc écrite mais NON vérifiée : le collecteur la refuse en disant pourquoi, au lieu de joindre au hasard.
const fs = require('fs');
const path = require('path');

const FICHIER = path.join(__dirname, 'table-sets-sans-page.json');
const SEUIL = 0.9;
const cle = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, 'and').replace(/\+/g, 'and').replace(/[^a-z0-9]/g, '');

async function principal() {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
    const { ouvrirConnexions } = require('./garde');
    const { cleNumero } = require('./jointure');
    const { TABLE, TABLE_AUTO } = require('./table-sets');
    const univers = require('./univers-expansions.json');
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });

    // 🔴 L'OUTIL NE DOIT PAS SE RELIRE. `TABLE` contient désormais les lignes qu'il a lui-même écrites :
    // les compter comme « déjà prises » viderait le fichier au lancement suivant, sans une erreur — un
    // générateur qui s'efface lui-même. Ses propres lignes sont donc exclues de ce qu'il considère connu.
    const lignes = [...TABLE, ...TABLE_AUTO].filter(l => !l.bulba?.sansPage);
    const connus = new Set(lignes.flatMap(l => [].concat(l.bulba?.expansion || [])).map(cle));
    const codesPris = new Set(lignes.map(l => l.code));
    // ⚠️ UNE LIGNE NON VÉRIFIÉE NE PREND PAS SON SLUG. Cinq expansions ont une ligne automatique qui
    // ÉCHOUE — « Terastal Starter Sets (TCG) » est une page COLLECTIVE dont aucune section ne porte le nom
    // du deck, exactement le motif de BLK/WHT. Les compter comme pourvues les laisserait sans collecte
    // pour toujours. Seules les lignes qui peuvent réellement collecter (celles de `TABLE`) prennent un
    // slug ; `ligne(code)` préfère de toute façon `TABLE` à une candidate automatique.
    const slugsPris = new Set(TABLE.filter(l => !l.bulba?.sansPage).map(l => l.slugSet));

    // ce que NOS pages déclarent et que la table ignore
    const parNom = new Map();
    for await (const c of cx.db.collection('cartes').find({}, { projection: { impressions: 1 } })) {
        for (const i of c.impressions || []) {
            if (!i.expansion) continue;
            const k = cle(i.expansion);
            if (connus.has(k)) continue;
            const e = parNom.get(k) || (parNom.set(k, { nom: i.expansion, nums: new Set(), tirages: new Set(), cartes: new Set(), sansNumero: 0 }), parNom.get(k));
            if (i.numero) e.nums.add(cleNumero(i.numero)); else e.sansNumero++;
            e.tirages.add(i.tirage); e.cartes.add(c._id);
        }
    }
    const cibles = univers.filter(u => u.produits && u.slugSet && !slugsPris.has(u.slugSet) && !/chinois|asiatique/.test(u.famille || ''));
    console.log(`DÉNOMINATEUR : ${parNom.size} noms d'expansion déclarés par nos pages et absents de la table · ${cibles.length} expansions Cardmarket sans ligne (${cibles.reduce((s, u) => s + u.produits, 0)} produits)\n`);

    const paires = [];
    for (const u of cibles) {
        const e = parNom.get(cle(String(u.slugSet).replace(/-/g, ' ')));
        if (!e) continue;
        const nums = (await prod.db.collection('numeros_cartes').find({ idExpansion: u.exp }, { projection: { numero: 1 } }).toArray())
            .map(p => p.numero).filter(n => n != null && String(n).trim() !== '').map(cleNumero);
        const couverts = nums.filter(n => e.nums.has(n)).length;
        // la couverture INVERSE : une vraie identité rend deux fois le même chiffre (§31)
        const inverse = e.nums.size ? [...e.nums].filter(n => nums.includes(n)).length / e.nums.size : 0;
        paires.push({ u, e, nums: nums.length, couverts, taux: nums.length ? couverts / nums.length : 0, inverse });
    }
    paires.sort((a, b) => b.u.produits - a.u.produits);

    // 🔑 IMPRIMER AVANT D'ÉCRIRE, TOUJOURS (§31) : une clé d'appariement se relit ligne à ligne.
    console.log(`PAIRES PAR ÉGALITÉ DU NOM — la couverture est un CONTRÔLE, pas la clé :`);
    for (const p of paires)
        console.log(`   ${p.taux >= SEUIL ? '✅' : '⚠️ '} ${String(p.u.produits).padStart(4)} p · ${String(p.u.codeSet || '—').padEnd(7)} ${String(p.u.slugSet).slice(0, 42).padEnd(42)} = « ${p.e.nom} » · ${p.e.cartes.size} cartes, ${[...p.e.tirages].join(',')} · contrôle ${p.couverts}/${p.nums} = ${(p.taux * 100).toFixed(0)} % (inverse ${(p.inverse * 100).toFixed(0)} %)`);

    const sortie = paires.map(p => {
        const tirage = p.e.tirages.has('jp') && !p.e.tirages.has('intl') ? 'jp' : (p.e.tirages.has('intl') && !p.e.tirages.has('jp') ? 'intl' : 'jp');
        const l = {
            code: p.u.codeSet, exp: p.u.exp, prod: p.u.produits, nom: p.u.nom || String(p.u.slugSet).replace(/-/g, ' '),
            slugSet: p.u.slugSet, region: tirage === 'intl' ? 'occidental' : 'japonais',
            bulba: { titre: null, sansPage: true, tirage, expansion: p.e.nom },
            attendu: p.u.produits,
            controle: { cartesDeclarantes: p.e.cartes.size, numerosCardmarket: p.nums, couverts: p.couverts, taux: Number(p.taux.toFixed(3)), inverse: Number(p.inverse.toFixed(3)), le: new Date().toISOString().slice(0, 10) }
        };
        // ⚠️ `0 / 0` N'EST PAS `0 %` (§8). Quand aucun produit de l'expansion ne porte de numéro, le
        // contrôle n'a pas échoué : il n'a pas été ÉVALUÉ. La ligne reste refusée — mais le motif dit
        // laquelle des deux choses s'est produite, sinon personne ne saura quoi chercher.
        if (!p.nums) l.refus = `aucun produit de cette expansion ne porte de numéro : le contrôle par les numéros n'est PAS ÉVALUÉ (ce n'est pas 0 %). ${p.e.cartes.size} cartes déclarent « ${p.e.nom} » pour ${p.u.produits} produits.`;
        else if (p.taux >= SEUIL) l.verifie = {
            le: new Date().toISOString().slice(0, 10), page: null, entrees: { [p.e.nom]: p.e.cartes.size },
            note: `sans page : ${p.e.cartes.size} cartes de la base déclarent « ${p.e.nom} » ; ${p.couverts} des ${p.nums} numéros Cardmarket sont des numéros de ces impressions (${(p.taux * 100).toFixed(0)} %). Contrôle mesuré en base, 0 requête.`
        };
        else l.refus = `couverture ${p.couverts}/${p.nums} = ${(p.taux * 100).toFixed(0)} % < ${SEUIL * 100} % : les numéros Cardmarket ne sont pas ceux des impressions déclarées, la jointure tomberait sur le repli par nom.`;
        return l;
    });
    const doublons = sortie.filter(l => codesPris.has(l.code));
    if (doublons.length) console.log(`\n   ⚠️ ${doublons.length} code(s) déjà porté(s) par une ligne existante : ${doublons.map(l => l.code).join(' · ')}`);
    const ok = sortie.filter(l => l.verifie);
    console.log(`\n  TOTAL : ${sortie.length} expansions · ${sortie.reduce((s, l) => s + l.prod, 0)} produits`);
    console.log(`  dont VÉRIFIÉES (couverture ≥ ${SEUIL}) : ${ok.length} · ${ok.reduce((s, l) => s + l.prod, 0)} produits`);
    console.log(`  les autres sont écrites mais refusées par le collecteur, avec leur motif.`);

    if (process.argv.includes('--ecrire')) {
        fs.writeFileSync(FICHIER, JSON.stringify(sortie, null, 1));
        console.log(`\n  ÉCRIT : ${FICHIER}`);
    } else console.log(`\n  (mesure seule — relancer avec --ecrire)`);
    await fermer();
}

if (require.main === module) principal().catch(e => { console.error(e); process.exit(1); });
module.exports = { FICHIER };
