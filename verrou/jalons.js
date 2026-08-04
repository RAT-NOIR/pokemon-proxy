// ============================================================
// LES JALONS — jusqu'où la charge est-elle allée ?
// ============================================================
// LE DÉFAUT QU'ILS CORRIGENT, ET IL VENAIT DE SE PRODUIRE. La première version du verrou
// a affiché huit ✅ sur deux charges qui sortaient de la route à la ligne 2769, alors que
// le code à protéger est à la ligne 2971. « Aucune exception » sur une route qui s'arrête
// après trois pas ne prouve rien — c'est la même illusion que les 52 assertions vertes sur
// un appel inexistant, sous une autre forme. Une vérification qui n'atteint pas le code ne
// vérifie pas ce code.
//
// D'OÙ : CHAQUE CHARGE DÉCLARE LA PROFONDEUR QU'ELLE DOIT ATTEINDRE, et ne pas y arriver
// est un ÉCHEC, pas une remarque.
//
// COMMENT ON MARQUE LA PROFONDEUR — et pourquoi comme ça.
// Par les LOGS QUI EXISTENT DÉJÀ. Pas un champ ajouté à la réponse, pas un en-tête de
// test, pas un `if (process.env.VERROU)` : ZÉRO ligne de code de test dans index.js.
// Ces trois lignes sont là pour l'exploitation, elles sont lues sur Render tous les jours,
// et elles sont INCONDITIONNELLES — au même niveau d'indentation que le corps de la route,
// jamais dans une branche. Le verrou lit la sortie du serveur, comme un opérateur.
//
// ⚠️ LE COUPLAGE, ÉNONCÉ POUR QU'IL NE SURPRENNE PERSONNE : si un de ces logs est
// supprimé ou reformulé, le verrou échouera en annonçant une profondeur non atteinte alors
// que le code va très bien. C'est le prix de n'avoir aucune instrumentation de test dans
// la production, et c'est un prix qu'on paie volontiers — mais le message d'échec doit
// donc TOUJOURS proposer les deux lectures : « soit la chaîne s'est arrêtée avant, soit ce
// log a changé ». Il le fait.

// L'ÉCHELLE, dans l'ordre où la route les franchit. `preuve` est cherchée dans la sortie
// du serveur ; `null` = la preuve est dans la réponse HTTP, pas dans les logs.
const JALONS = [
    {
        cle: 'route',
        preuve: /📷 \[identifier\] \d+ photo/,
        decrit: 'la route est entrée (photos reçues)'
    },
    {
        cle: 'ia-lue',
        preuve: /⏱️ \[identifier\] appel IA/,
        decrit: 'la lecture IA a été parsée (getCardIdFromAI traversée)'
    },
    {
        cle: 'vivier',
        preuve: /🗂️ \[identifier\] \d+ candidat/,
        decrit: 'un vivier de candidats existe — la sortie « carte introuvable » est passée'
    },
    {
        cle: 'perimetre-vintage',
        preuve: /⏱️ \[identifier\] catalogue\+scoring/,
        // ⚠️ C'EST LE JALON QUI COMPTE. Il est journalisé APRÈS l'appel à
        // setCodeCompatibleVintage et AVANT la sortie « aucun produit Cardmarket » :
        // l'atteindre PROUVE que la ligne qui a tué la production le 4 août a été exécutée.
        decrit: 'setCodeCompatibleVintage a été appelée et a rendu la main'
    },
    {
        cle: 'verdict',
        preuve: null,
        decrit: 'la chaîne est allée au bout et a rendu un résultat'
    }
];

const RANG = new Map(JALONS.map((j, i) => [j.cle, i]));

/**
 * Jusqu'où est-on allé ?
 * @param {string} sortieServeur   ce que le serveur a écrit pendant CETTE requête
 * @param {object|null} reponse    le JSON rendu par la route
 * @returns {{atteint: string|null, rang: number, franchis: string[]}}
 */
function profondeurAtteinte(sortieServeur, reponse) {
    const franchis = [];
    for (const j of JALONS) {
        const ok = j.preuve ? j.preuve.test(sortieServeur) : Boolean(reponse && reponse.success === true);
        if (!ok) break;              // l'échelle est ordonnée : on s'arrête au premier manquant
        franchis.push(j.cle);
    }
    const atteint = franchis.length ? franchis[franchis.length - 1] : null;
    return { atteint, rang: franchis.length - 1, franchis };
}

/** Le jalon exigé est-il atteint ? */
function profondeurSuffisante(atteint, exigee) {
    if (!RANG.has(exigee)) return { ok: false, raison: `jalon exigé inconnu : « ${exigee} »` };
    const rAtteint = atteint == null ? -1 : RANG.get(atteint);
    return { ok: rAtteint >= RANG.get(exigee), raison: null };
}

function decrire(cle) { return JALONS.find(j => j.cle === cle)?.decrit ?? cle; }

module.exports = { JALONS, profondeurAtteinte, profondeurSuffisante, decrire, RANG };
