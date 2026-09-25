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
// 🔴 LE « & » ÉTAIT NORMALISÉ DANS LES DEUX SENS OPPOSÉS — mesuré le 2026-09-20. Cette clé le
// DÉVELOPPAIT (« Sword & Shield Family » → « swordandshieldfamily ») ; Cardmarket le SUPPRIME de ses
// slugs (« Sword-Shield-Family » → « swordshieldfamily »). Deux conventions contraires sur un seul
// caractère, et l'égalité échouait sans un mot — une clé ne se trompe pas, elle se TAIT (§30).
// Le signe disparaît donc des deux côtés. ⚠️ On reste sur de l'ÉGALITÉ de chaînes entières, jamais sur
// de l'inclusion (§31) : mesuré à **10 paires gagnées, 298 produits, 0 ambiguë**, et les 10 ont été
// lues une à une avant d'être admises.
const cle = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[&+]/g, ' ').replace(/[^a-z0-9]/g, '');

async function principal() {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
    const { ouvrirConnexions } = require('./garde');
    const { cleNumero } = require('./jointure');
    const { TABLE, TABLE_AUTO, EXPANSIONS_INTL } = require('./table-sets');
    const univers = require('./univers-expansions.json');
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });

    // 🔴 L'OUTIL NE DOIT PAS SE RELIRE. `TABLE` contient désormais les lignes qu'il a lui-même écrites :
    // les compter comme « déjà prises » viderait le fichier au lancement suivant, sans une erreur — un
    // générateur qui s'efface lui-même. Ses propres lignes sont donc exclues de ce qu'il considère connu.
    const lignes = [...TABLE, ...TABLE_AUTO].filter(l => !l.bulba?.sansPage);
    const codesPris = new Set(lignes.map(l => l.code));
    // ⚠️ UNE LIGNE NON VÉRIFIÉE NE PREND PAS SON SLUG. Cinq expansions ont une ligne automatique qui
    // ÉCHOUE — « Terastal Starter Sets (TCG) » est une page COLLECTIVE dont aucune section ne porte le nom
    // du deck, exactement le motif de BLK/WHT. Les compter comme pourvues les laisserait sans collecte
    // pour toujours. Seules les lignes qui peuvent réellement collecter (celles de `TABLE`) prennent un
    // slug ; `ligne(code)` préfère de toute façon `TABLE` à une candidate automatique.
    const collectantes = TABLE.filter(l => !l.bulba?.sansPage);
    const slugsPris = new Set(collectantes.map(l => l.slugSet));
    // 🔴 ET LA MÊME RÈGLE VAUT POUR LE NOM D'EXPANSION — CORRIGÉE D'UN CÔTÉ, LAISSÉE DE L'AUTRE (§21 bis,
    // cinquième fois). `connus` se construisait sur `[...TABLE, ...TABLE_AUTO]`, donc une candidate que
    // PERSONNE N'A VÉRIFIÉE — et qui ne collectera donc rien — masquait son nom d'expansion à ce
    // générateur. Mesuré le 2026-09-20 : 122 candidates sans la moindre trace de vérification, dont 75
    // dont l'expansion est DÉJÀ DÉCLARÉE par nos cartes (2 999 produits). Elles étaient invisibles aux
    // deux voies à la fois : la page n'a jamais été vérifiée, et le retournement ne les voyait pas. Une
    // ligne qui ne peut pas collecter ne prend ni son slug NI son nom.
    const connus = new Set(collectantes.flatMap(l => [].concat(l.bulba?.expansion || [])).map(cle));
    // 🔴 ET LE BONUS JUMEAU SERT DÉJÀ DEUX EXPANSIONS QUI N'ONT AUCUNE LIGNE À ELLES. `Base Set` est
    // collecté par le bonus `intl` de EXP (`EXPANSIONS_INTL`) : la première sortie du correctif ci-dessus
    // le proposait à 100 % de couverture — et il aurait gagné **4 produits sur 211**, les 207 autres
    // étant déjà fichés. Ce n'est pas un gisement, c'est un DOUBLE de la voie qui a produit les 1 993
    // lignes fausses du §32. Une expansion servie par une autre voie n'est pas une expansion sans ligne.
    for (const nom of Object.keys(EXPANSIONS_INTL)) connus.add(cle(nom));

    // ce que NOS pages déclarent et que la table ignore
    const parNom = new Map();
    for await (const c of cx.db.collection('cartes').find({}, { projection: { impressions: 1 } })) {
        for (const i of c.impressions || []) {
            if (!i.expansion) continue;
            const k = cle(i.expansion);
            if (connus.has(k)) continue;
            const e = parNom.get(k) || (parNom.set(k, { nom: i.expansion, nums: new Set(), parNumero: new Map(), tirages: new Set(), cartes: new Set(), sansNumero: 0 }), parNom.get(k));
            if (i.numero) {
                const n = cleNumero(i.numero);
                e.nums.add(n);
                (e.parNumero.get(n) || e.parNumero.set(n, new Set()).get(n)).add(c._id);
            } else e.sansNumero++;
            e.tirages.add(i.tirage); e.cartes.add(c._id);
        }
    }
    // ════ LES APPARIEMENTS QUE L'ÉGALITÉ NE PEUT PAS ATTEINDRE — nommés un par un, JAMAIS devinés ════
    // 🔴 Ce n'est PAS une clé plus souple : une clé souple apparie tout (§31). C'est une liste FERMÉE,
    // écrite à la main, où chaque entrée porte la raison pour laquelle l'égalité échoue — et chaque ligne
    // produite passe ENSUITE les mêmes contrôles que les autres (couverture dans les deux sens, numéros
    // ambigus). La liste ne décide de rien : elle propose, la mesure tranche.
    const A_LA_MAIN = {
        // Cardmarket préfixe « MEGA- » ce que Bulbapedia nomme sans préfixe. 774 produits, dont 473 sans
        // slugSet — l'expansion la plus grosse qui n'a aucune ligne.
        6381: { nom: 'Start Deck 100 Battle Collection', pourquoi: 'Cardmarket ajoute le préfixe « MEGA- » au nom du set' },
        // AUCUNE de ses 177 lignes ne porte de slugSet (§6). Le nom vient de `catalogue_produits` :
        // « Arcanine [Extreme Speed | Fire Blow] » aux n° H02 et H19 — la série H est celle d'Aquapolis.
        // ⚠️ La ligne n'aura donc pas de slugSet : elle se désigne par son `exp`, pas par un slug inventé.
        // ➕ 2026-09-25 : l'apprentissage du 24/09 a donné « Aquapolis » à ses 190 produits ; la ligne écrite porte ce slugSet
        // (posé à la main, `slugSetPose`) et le set a été renommé AQ → Aquapolis (renommer-set.js, feu vert du testeur).
        1537: { nom: 'Aquapolis', pourquoi: 'aucune ligne Cardmarket ne porte de slugSet ; les n° de la série H désignent Aquapolis' },
        // Cardmarket insère « Flame » : « Explosive-Flame-Walker » contre « Explosive Walker ».
        3219: { nom: 'Explosive Walker', pourquoi: 'Cardmarket insère « Flame » dans le nom du set' },
        // Cardmarket écrit « Pokédex » là où Bulbapedia écrit « National » seul.
        4196: { nom: 'National Beginning Set', pourquoi: 'Cardmarket insère « Pokedex » dans le nom du set' },
        // Le « + » du nom est écrit « Plus » par Cardmarket.
        6509: { nom: 'Beginning Set +', pourquoi: 'Cardmarket écrit « Plus » là où le nom porte « + »' },
        // Cardmarket nomme la série (« Scarlet & Violet »), Bulbapedia nomme le jeu (« Pokémon Card Game »).
        5621: { nom: 'Pokémon Card Game Battle Academy', pourquoi: 'Cardmarket nomme la série, Bulbapedia nomme le jeu' }
        // ════ ÉPROUVÉES ET REFUSÉES LE 2026-09-20, écrites pour qu'on ne les repropose pas ════
        // · `sA Sword-Shield-Starter-Decks` = « V Starter Sets » : couverture **100 % dans les DEUX sens**,
        //   et **23 des 24 numéros déclarés désignent plusieurs cartes**. Le motif « kit à plusieurs decks »
        //   du §34, et la seule chose qui l'a vu est le compte des multiplicités.
        // · les six decks « Classic » (CLV CLC CLB CLF CLL CLK) : 24 à 26 numéros ambigus sur 32, et UN nom
        //   pour SIX expansions Cardmarket. Un nom qui désigne six sets ne désigne rien.
        // · `IPNT`/`IPNC Intro-Pack-Neo-*` : un nom pour deux expansions, couverture 53 %.
        // · `UNP Unnumbered-Promos` : 205 produits, AUCUN numéroté et AUCUN numéro déclaré — le contrôle
        //   n'est pas à 0 %, il n'est PAS ÉVALUABLE (§8). Il faudra une autre clé que le numéro.
    };
    // ⚠️ L'EXCLUSION DU CHINOIS DIT « PAS ICI », ELLE NE DIT PLUS « NULLE PART ». Elle reste juste pour
    // CETTE voie : le retournement part du nom d'expansion que nos cartes déclarent, et les pages de
    // cartes ne mentionnent le chinois que 3 fois sur 607 (§28) — il n'y a rien à retourner. Mais elle
    // a été écrite quand « le chinois est irréductible » était une conclusion, et elle a survécu d'un
    // jour à la chute de cette conclusion. La route est `generer-table-atcg.js`, par le CODE de set (§39).
    const cibles = univers.filter(u => u.produits && (u.slugSet || A_LA_MAIN[u.exp]) && !slugsPris.has(u.slugSet) && !/chinois|asiatique/.test(u.famille || ''));
    console.log(`DÉNOMINATEUR : ${parNom.size} noms d'expansion déclarés par nos pages et absents de la table · ${cibles.length} expansions Cardmarket sans ligne (${cibles.reduce((s, u) => s + u.produits, 0)} produits)\n`);

    const paires = [];
    for (const u of cibles) {
        const main = A_LA_MAIN[u.exp] || null;
        const e = parNom.get(cle(main ? main.nom : String(u.slugSet).replace(/-/g, ' ')));
        if (!e) continue;
        if (main) e.aLaMain = main.pourquoi;
        const nums = (await prod.db.collection('numeros_cartes').find({ idExpansion: u.exp }, { projection: { numero: 1 } }).toArray())
            .map(p => p.numero).filter(n => n != null && String(n).trim() !== '').map(cleNumero);
        const couverts = nums.filter(n => e.nums.has(n)).length;
        // la couverture INVERSE : une vraie identité rend deux fois le même chiffre (§31)
        const inverse = e.nums.size ? [...e.nums].filter(n => nums.includes(n)).length / e.nums.size : 0;
        // 🔴 ET LA COUVERTURE NE VOIT PAS UN NUMÉRO QUI DÉSIGNE DEUX CARTES — mesuré le 2026-09-20.
        // « Leafeon vs Metagross Expert Deck » a passé les DEUX sens à 100 % et a produit 14 produits
        // rattachés à deux cartes : c'est un KIT À DEUX DECKS sous UN nom d'expansion, donc le n°6 existe
        // deux fois, une fois par moitié. 26 cartes déclarent l'expansion pour 15 numéros distincts.
        // 🔑 La couverture compare des ENSEMBLES, et un doublon s'écrase dans un `Set` : elle répondait
        // donc 100 % dans les deux sens sans que les deux populations aient la même taille — la forme
        // exacte de l'inclusion déguisée du §31, une troisième fois, et le contrôle bidirectionnel du §31
        // ne l'attrape PAS. Le pendant de la garde par le nom : un numéro qui désigne PLUSIEURS cartes ne
        // désigne rien.
        const ambigus = [...e.parNumero.entries()].filter(([, cs]) => cs.size > 1).map(([n]) => n);
        paires.push({ u, e, nums: nums.length, couverts, taux: nums.length ? couverts / nums.length : 0, inverse, ambigus });
    }
    paires.sort((a, b) => b.u.produits - a.u.produits);

    // 🔑 IMPRIMER AVANT D'ÉCRIRE, TOUJOURS (§31) : une clé d'appariement se relit ligne à ligne.
    console.log(`PAIRES PAR ÉGALITÉ DU NOM — la couverture est un CONTRÔLE, pas la clé :`);
    for (const p of paires)
        console.log(`   ${p.taux >= SEUIL ? '✅' : '⚠️ '} ${String(p.u.produits).padStart(4)} p · ${String(p.u.codeSet || '—').padEnd(7)} ${String(p.u.slugSet || '(sans slugSet)').slice(0, 42).padEnd(42)} = « ${p.e.nom} » · ${p.e.cartes.size} cartes, ${[...p.e.tirages].join(',')} · contrôle ${p.couverts}/${p.nums} = ${(p.taux * 100).toFixed(0)} % (inverse ${(p.inverse * 100).toFixed(0)} %)${p.ambigus.length ? ` · 🔴 ${p.ambigus.length}/${p.e.nums.size} numéros désignent PLUSIEURS cartes` : ''}${p.e.aLaMain ? ` · ✋ apparié à la main : ${p.e.aLaMain}` : ''}`);

    const sortie = paires.map(p => {
        const tirage = p.e.tirages.has('jp') && !p.e.tirages.has('intl') ? 'jp' : (p.e.tirages.has('intl') && !p.e.tirages.has('jp') ? 'intl' : 'jp');
        const l = {
            code: p.u.codeSet, exp: p.u.exp, prod: p.u.produits, nom: p.u.nom || String(p.u.slugSet).replace(/-/g, ' '),
            slugSet: p.u.slugSet || null, region: tirage === 'intl' ? 'occidental' : 'japonais',
            bulba: { titre: null, sansPage: true, tirage, expansion: p.e.nom },
            ...(p.e.aLaMain ? { apparieALaMain: p.e.aLaMain } : {}),
            attendu: p.u.produits,
            controle: { cartesDeclarantes: p.e.cartes.size, numerosCardmarket: p.nums, couverts: p.couverts, taux: Number(p.taux.toFixed(3)), inverse: Number(p.inverse.toFixed(3)), numerosDeclares: p.e.nums.size, numerosAmbigus: p.ambigus.length, le: new Date().toISOString().slice(0, 10) }
        };
        // ⚠️ `0 / 0` N'EST PAS `0 %` (§8). Quand aucun produit de l'expansion ne porte de numéro, le
        // contrôle n'a pas échoué : il n'a pas été ÉVALUÉ. La ligne reste refusée — mais le motif dit
        // laquelle des deux choses s'est produite, sinon personne ne saura quoi chercher.
        if (!p.nums) l.refus = `aucun produit de cette expansion ne porte de numéro : le contrôle par les numéros n'est PAS ÉVALUÉ (ce n'est pas 0 %). ${p.e.cartes.size} cartes déclarent « ${p.e.nom} » pour ${p.u.produits} produits.`;
        // ⚠️ LA MAJORITÉ DES NUMÉROS DOUBLÉS N'EST PAS UN SEUIL DE RÉGLAGE, C'EST UN CONSTAT DE STRUCTURE :
        // si la plupart des numéros déclarés désignent deux cartes, le nom d'expansion ne couvre pas UNE
        // numérotation mais PLUSIEURS — un kit à deux decks, une page qui fusionne deux moitiés. La
        // jointure par numéro n'y veut plus rien dire. Les collisions ISOLÉES (1 numéro sur 19) ne
        // referment pas la ligne : elles coûteraient 18 produits justes pour un faux. Elles sont ÉCRITES
        // dans le contrôle, à charge du garde par numéro, qui reste à mesurer sur ce qui marche déjà (§22).
        else if (p.ambigus.length > p.e.nums.size / 2) l.refus = `${p.ambigus.length} des ${p.e.nums.size} numéros déclarés désignent PLUSIEURS cartes : « ${p.e.nom} » ne couvre pas une numérotation mais plusieurs (kit à deux decks). La couverture passe à ${(p.taux * 100).toFixed(0)} % dans les deux sens sans le voir — un doublon s'écrase dans un ensemble.`;
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

    // `--sortie=<chemin>` écrit AILLEURS que dans la table : de quoi peser les lignes proposées avec
    // un autre outil avant de remplacer le fichier que le collecteur lit. Imprimer avant d'écrire ne
    // suffit pas quand la décision demande une mesure en base (§22).
    const ailleurs = (process.argv.find(a => a.startsWith('--sortie=')) || '').slice(9);
    if (ailleurs) {
        fs.writeFileSync(ailleurs, JSON.stringify(sortie, null, 1));
        console.log(`\n  ÉCRIT HORS TABLE (inspection) : ${ailleurs}`);
    } else if (process.argv.includes('--ecrire')) {
        fs.writeFileSync(FICHIER, JSON.stringify(sortie, null, 1));
        console.log(`\n  ÉCRIT : ${FICHIER}`);
    } else console.log(`\n  (mesure seule — relancer avec --ecrire)`);
    await fermer();
}

if (require.main === module) principal().catch(e => { console.error(e); process.exit(1); });
module.exports = { FICHIER };
