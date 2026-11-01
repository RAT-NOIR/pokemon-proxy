'use strict';
// LEVIERS-ABDE — pré-chargeur du banc de mutation (test-leviers-abde-mutation.js). Chargé par `node --require` dans un PROCESSUS ENFANT : il remplace, dans le TEXTE d'UN fichier de production, l'ancre `de` par `vers` à chaque lecture du fichier
// (fs.readFileSync) — donc aussi bien quand le chargeur de modules le COMPILE que quand un banc le LIT comme texte (les contrôles statiques de la route). Le fichier du dépôt n'est jamais touché.
// L'ancre doit exister et être UNIQUE dans le fichier lu, sinon le processus sort avec le code 99 (« mutation invalide », jamais un faux « tué »). Si ce banc ne lit jamais le fichier, il sort avec le code 98 (« il n'a rien à dire de cette
// mutation » : le banc de mutation passe au banc suivant). Code de banc : aucune production ne le charge.
const fs = require('fs');
const brut = process.env.LEVIERS_MUTATION;
if (brut) {
    const M = JSON.parse(brut);
    const lire = fs.readFileSync;
    let appliquee = false;
    fs.readFileSync = function (chemin, ...reste) {
        const sortie = lire.call(this, chemin, ...reste);
        if (typeof chemin === 'string' && typeof sortie === 'string' && chemin.replace(/\\/g, '/').endsWith(M.fichier)) {
            const n = sortie.split(M.de).length - 1;
            if (n !== 1) { console.error(`MUTATION INVALIDE : l'ancre « ${M.de.slice(0, 80)} » apparaît ${n} fois dans ${M.fichier}`); process.exit(99); }
            appliquee = true;
            return sortie.replace(M.de, () => M.vers);
        }
        return sortie;
    };
    process.on('exit', code => { if (!appliquee && code !== 99) { console.error(`MUTATION SANS EFFET : ${M.fichier} n'est pas lu par ce banc`); process.exitCode = 98; } });
}
