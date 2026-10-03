// ============================================================
// LA PANNE DU CATALOGUE, SUR COMMANDE — une seule définition, deux préchargements
// ============================================================
// POURQUOI UN MODULE. Le faux réseau (verrou-avant-push.js) faisait tomber `catalogue_produits`
// sur un message IPC ; l'enregistreur (verrou-charges.js) ne le savait pas. Depuis que la
// charge de la 7e cellule passe par le PONT (2026-09-12), une panne du catalogue y fait
// échouer la lecture du pont, et la route repart vers TCGdex — des URL que l'enregistrement
// fait en mode NORMAL ne demande jamais. Le verrou rejouait donc la panne sur un enregistrement
// à trou : TCGdex « injoignable » par absence de cassette, et la cellule mesurait le faux réseau,
// pas la parade (2026-10-03). L'enregistreur arme désormais la MÊME panne, par ce module, pour
// capturer ce que la route demande à TCGdex quand le catalogue est tombé.
// 🔑 Deux copies de ce patch auraient divergé (§21 bis) : la panne enregistrée et la panne
// rejouée doivent être la même, sinon la cassette décrit un autre chemin que celui qu'on rejoue.
//
// CE QU'ON CASSE, ET RIEN D'AUTRE : les requêtes mongoose sur `catalogue_produits`. Les crédits
// (le remboursement doit marcher), `numeros_cartes` et `codes_set` (le journal doit s'écrire)
// restent vivants. Casser tout Mongo mesurerait le plantage, pas la parade.
// ARMÉE PAR IPC ('panne-catalogue' / 'panne-catalogue-off'), JAMAIS PAR DEVINETTE : la même
// image sert à la charge normale et à la charge de panne.

const mongoose = require('mongoose');

let enPanne = false;
let pose = false;

function poserPanneCatalogue() {
    if (pose) return;
    pose = true;
    const execOriginal = mongoose.Query.prototype.exec;
    mongoose.Query.prototype.exec = function (...args) {
        const collection = this.mongooseCollection?.name ?? this.model?.collection?.name ?? '';
        if (enPanne && collection === 'catalogue_produits') {
            return Promise.reject(new Error('[faux-reseau] catalogue_produits injoignable (panne simulée)'));
        }
        return execOriginal.apply(this, args);
    };
    process.on('message', m => {
        if (m === 'panne-catalogue') {
            enPanne = true;
            console.log('🎛️ [faux-reseau] PANNE-CATALOGUE ARMEE — catalogue_produits injoignable.');
        } else if (m === 'panne-catalogue-off') {
            enPanne = false;
            console.log('🎛️ [faux-reseau] PANNE-CATALOGUE LEVEE.');
        }
    });
}

module.exports = { poserPanneCatalogue };
