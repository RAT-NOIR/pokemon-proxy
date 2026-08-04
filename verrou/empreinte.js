// ============================================================
// L'EMPREINTE DU PROMPT — comment on saura que les charges ont dérivé
// ============================================================
// LE PROBLÈME QU'ELLE RÉSOUT. Les charges utiles du verrou sont des lectures d'IA
// enregistrées. Le jour où le prompt change — un champ ajouté, une énumération élargie,
// une consigne reformulée — le modèle rend une forme que ces lectures n'ont plus. Le
// verrou continuerait de passer au vert en rejouant une forme MORTE, et on ne le
// découvrirait qu'en production. C'est exactement le défaut qu'on vient de payer deux
// fois : une vérification qui rassure sans rien mesurer.
//
// LA PARADE. Les charges portent l'empreinte du prompt sous lequel elles ont été
// extraites. Au moindre écart, le verrou le DIT. Il n'échoue pas pour autant — un prompt
// qui change n'est pas une panne, et bloquer un push pour ça pousserait à contourner le
// verrou, ce qui est pire. Il avertit, bruyamment, avec la commande de rafraîchissement.
//
// CE QUE L'EMPREINTE COUVRE : le texte du prompt ET le modèle. Changer de modèle change
// la forme des réponses autant que changer les consignes.
//
// ⚠️ ELLE NE PROTÈGE PAS DE TOUT, et il faut le savoir : le modèle peut dériver sans que
// le prompt bouge (une preview qui évolue en silence — c'est écrit noir sur blanc au-dessus
// de MODELE_IA). Contre CETTE dérive-là, seul U4 peut quelque chose, parce que lui appelle
// vraiment le modèle. L'empreinte couvre nos changements à nous, pas ceux d'en face.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Empreinte du prompt et du modèle, lue dans la SOURCE d'index.js.
 * Lire la source plutôt qu'appeler la fonction évite de charger index.js (qui démarre
 * une connexion Mongo) juste pour calculer un hash.
 *
 * @returns {{hash: string, modele: string, tailleprompt: number}}
 */
function empreintePrompt() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

    // Le prompt : de `const prompt = \`` jusqu'au backtick de clôture suivi d'un `;`.
    const m = source.match(/const prompt = `([\s\S]*?)`;/);
    const texte = m ? m[1] : null;

    // Le modèle : la constante MODELE_IA.
    const mm = source.match(/const MODELE_IA\s*=\s*["']([^"']+)["']/);
    const modele = mm ? mm[1] : null;

    if (!texte || !modele) {
        // On ne devine pas. Une empreinte fausse serait pire qu'une empreinte absente :
        // elle certifierait une correspondance qu'on n'a pas vérifiée.
        return { hash: 'INCALCULABLE', modele: modele || '?', taillePrompt: 0 };
    }
    const hash = crypto.createHash('sha256').update(modele + '\n' + texte).digest('hex').slice(0, 16);
    return { hash, modele, taillePrompt: texte.length };
}

module.exports = { empreintePrompt };
