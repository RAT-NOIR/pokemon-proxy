// ============================================================================
// LA TRANCHE DE CATALOGUE DU VERROU — copiée ici, vidée ici, par les DEUX outils
// ============================================================================
// 🔴 POURQUOI CE FICHIER EXISTE, ET C'EST UN INCIDENT À COMPRENDRE AVANT DE LE LIRE.
//
// LE VERROU N'A PAS PU PASSER AU VERT PENDANT TROIS JOURS, ET LA CAUSE ÉTAIT LA RÈGLE
// DU DÉPÔT ELLE-MÊME, CORRECTEMENT APPLIQUÉE.
//   · `c439564`, le 2026-08-30 à 19:17, ajoute à `verrou-charges.js` la purge de sortie
//     qui manquait : « tout outil qui fait écrire une collection la vide en sortant ».
//     C'était juste — 28 Mo restaient dans le bac, et l'erreur d'instrument #16 est née là.
//   · Mais `verrou-avant-push.js` CONSOMME cette tranche, et ne la construit pas. Son
//     en-tête dit « Prérequis : node verrou-charges.js ». Or ce prérequis DÉTRUIT en
//     sortant ce que l'étape suivante attend.
//   · Le verrou était vert à 18:37 ce jour-là. Il a été cassé à 19:17, quarante minutes
//     plus tard, et personne ne l'a relancé avant le 2026-09-02. Trois jours et douze
//     commits ont été écrits sans garde, sans que rien ne le signale.
//
// 🔑 CE QUE ÇA APPREND, ET C'EST PLUS GÉNÉRAL QUE LE VERROU : une règle correcte,
// appliquée à UN outil d'une chaîne de deux, peut casser la chaîne. « Chaque outil range
// derrière lui » et « l'outil suivant trouve ce qu'il lui faut » sont deux exigences
// justes qui se contredisent dès qu'un artefact est PARTAGÉ. La sortie n'est pas de
// choisir : c'est que chaque outil CONSTRUISE ce qu'il consomme, et vide ce qu'il a
// construit. Il redevient alors autonome, et la règle s'applique sans exception.
//
// D'OÙ CE MODULE : une seule définition de la tranche, appelée par les deux.
//   `verrou-charges.js`    : copie -> enregistre les réponses TCGdex -> vide
//   `verrou-avant-push.js` : copie -> rejoue les charges              -> vide
// Aucun des deux ne dépend de l'ordre d'exécution de l'autre.
//
// ⚠️ ET LA DEUXIÈME LEÇON, SUR LE VIDAGE LUI-MÊME : `deleteMany` NE REND PAS LA PLACE.
// La règle du dépôt protège la REPRODUCTIBILITÉ — un verrou dont le résultat dépend du
// nombre de fois qu'on l'a lancé ne vaut rien. Elle ne protège PAS le QUOTA : WiredTiger
// garde le fichier alloué. Mesuré le 2026-09-02 : `test_scratch` affichait 36,2 Mo avec
// ZÉRO document dans ses onze collections, sur un cluster à 2,5 Mo de marge.
// Il faut donc les deux, et c'est `drop` qui rend la place.
// ⚠️ `dropDatabase` EST REFUSÉ PAR ATLAS sur ce compte (AtlasError 8000) : on passe
// collection par collection, ce que fait `viderTranche`.

// Les collections que la tranche fait écrire. UNE SEULE LISTE — deux listes « qui se
// ressemblent » divergeraient au premier ajout, et la collection oubliée serait celle
// qu'on vient d'ajouter, donc la moins surveillée.
const COLLECTIONS_TRANCHE = ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set', 'references_image'];

function echapper(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Copie depuis la production, dans `bac`, tout ce dont les charges ont besoin.
 * LECTURE SEULE sur `prod`. ÉCRITURE uniquement dans `bac`.
 *
 * @param {object} prod    connexion à la base de production (lecture seule)
 * @param {object} bac     connexion à test_scratch
 * @param {object[]} charges  les charges, telles que charges.json les porte
 * @returns {Promise<object>} le compte par collection
 */
async function copierTranche(prod, bac, charges) {
    // Copiée depuis la production, jamais fabriquée : vrais produits, vrais numéros,
    // vrais codes. Élargie au GAGNANT de chaque charge et à toute son expansion — sans
    // ça, le produit que la production avait retenu peut manquer du vivier.
    const noms = [...new Set(charges.map(c => c.lecture?.name).filter(Boolean))];
    const gagnants = charges.map(c => c.source?.idProduct).filter(v => v != null);
    const numGagnants = await prod.collection('numeros_cartes')
        .find({ idProduct: { $in: gagnants } }, { projection: { idExpansion: 1 } }).toArray();
    const expansions = [...new Set(numGagnants.map(n => n.idExpansion).filter(v => v != null))];
    const idsExpansion = (await prod.collection('numeros_cartes')
        .find({ idExpansion: { $in: expansions } }, { projection: { idProduct: 1 } }).toArray())
        .map(n => n.idProduct);

    const produits = await prod.collection('catalogue_produits').find({
        $or: [
            ...noms.map(n => ({ name: new RegExp(echapper(n), 'i') })),
            { idProduct: { $in: [...gagnants, ...idsExpansion] } }
        ]
    }).limit(6000).toArray();
    const ids = produits.map(p => p.idProduct);
    const numeros = await prod.collection('numeros_cartes').find({ idProduct: { $in: ids } }).toArray();
    const prix = await prod.collection('guide_prix').find({ idProduct: { $in: ids } }).toArray();
    // TOUS les codes de set : 748 lignes minuscules, et `lireTousLesCodesSet` les lit tous
    // pour distinguer une contradiction d'un bruit d'OCR (quatrième principe). En donner
    // une partie fausserait précisément cette distinction.
    const codes = await prod.collection('codes_set').find({}).toArray();

    // 🔑 ON COPIE LES VECTEURS DU VIVIER ENTIER DE CHAQUE CHARGE, pas seulement ceux des
    // produits de la tranche : la garde exige un vecteur pour TOUS les candidats du groupe,
    // et il suffit d'un manquant pour qu'elle se taise. Copier « à peu près » le vivier
    // produirait une abstention que personne ne saurait expliquer.
    const idsVivier = [...new Set(charges.flatMap(c => c.source?.vivierIds ?? []))].filter(v => v != null);
    const vecteurs = await prod.collection('references_image')
        .find({ idProduct: { $in: [...new Set([...ids, ...idsVivier])] } }).toArray();

    const comptes = {};
    for (const [nom, docs] of [['catalogue_produits', produits], ['numeros_cartes', numeros],
    ['guide_prix', prix], ['codes_set', codes], ['references_image', vecteurs]]) {
        await bac.collection(nom).deleteMany({});
        if (docs.length) await bac.collection(nom).insertMany(docs);
        comptes[nom] = docs.length;
    }
    return comptes;
}

/**
 * Vide la tranche ET rend la place. Appelée par CHAQUE outil, à SA sortie.
 * @param {object} bac  connexion à test_scratch
 * @param {function} log
 */
async function viderTranche(bac, log = console.log) {
    if (bac.db?.databaseName !== 'test_scratch') {
        log(`🔴 viderTranche REFUSE : base « ${bac.db?.databaseName} », attendu test_scratch.`);
        return 0;
    }
    let libere = 0;
    for (const nom of COLLECTIONS_TRANCHE) {
        try {
            const st = await bac.db.command({ collStats: nom }).catch(() => null);
            // ⚠️ `drop` ET NON `deleteMany` : voir l'en-tête. `deleteMany` vide la
            // collection et garde le fichier — 36,2 Mo pour zéro document, mesuré.
            await bac.db.dropCollection(nom).catch(() => null);
            if (st) libere += (st.storageSize ?? 0) + (st.totalIndexSize ?? 0);
        } catch (e) { log(`🔴 vidage de ${nom} : ${e.message}`); }
    }
    log(`🧹 tranche vidée (drop) — environ ${(libere / 1e6).toFixed(1)} Mo rendus au cluster.`);
    log(`   ⚠️ WiredTiger ne rend la place qu'au point de reprise suivant : un`);
    log(`      \`dbStats\` immédiat peut encore les montrer.`);
    return libere;
}

module.exports = { COLLECTIONS_TRANCHE, copierTranche, viderTranche };
