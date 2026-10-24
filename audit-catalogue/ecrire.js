'use strict';
// Les sorties de l'audit : UN dossier, et la garde d'écriture (collecte-cartes/garde-ecriture.js::autoriser) sur chaque chemin — jamais un dossier du testeur
// (CARDMARKET IMAGE, Logo FR, apport-manuel, LOGO), jamais le dépôt principal. Écrit par ce qu'elle AUTORISE : AUDIT, et rien d'autre.
const fs = require('fs');
const path = require('path');
const { autoriser } = require('../collecte-cartes/garde-ecriture');

const DOSSIER_AUDIT = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S8\\AUDIT';
const RACINES = [DOSSIER_AUDIT];
const sortie = (...morceaux) => autoriser(path.join(DOSSIER_AUDIT, ...morceaux), RACINES);

function ecrireJson(cheminRelatif, objet, { indent = 0 } = {}) {
    const p = sortie(cheminRelatif);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(objet, null, indent || undefined));
    return p;
}
function ecrireBinaire(cheminRelatif, tampon) {
    const p = sortie(cheminRelatif);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, tampon);
    return p;
}
const lireJson = cheminRelatif => JSON.parse(fs.readFileSync(path.join(DOSSIER_AUDIT, cheminRelatif), 'utf8'));

module.exports = { DOSSIER_AUDIT, sortie, ecrireJson, ecrireBinaire, lireJson };
