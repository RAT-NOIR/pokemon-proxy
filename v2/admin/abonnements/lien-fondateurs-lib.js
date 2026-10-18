'use strict';
// LE LIEN RÉSERVÉ DES FONDATEURS — la logique (le script lien-fondateurs.js la câble au .env d'api-v2 et au dossier local du testeur ; le banc, à un dossier temporaire).
// L'offre Fondateurs n'est JAMAIS publique : son adresse (« <site>/fr/fondateurs?code=… », page noindex du site, qui appelle POST /api/abonnement/fondateurs avec ce code) est fabriquée ici, depuis le
// code du .env, et ÉCRITE dans un fichier local. Elle n'est ni affichée, ni journalisée, ni rendue : la fonction ne rend que le chemin du fichier et ses octets. Aucune erreur ne cite le code.
const fs = require('fs'), path = require('path');
const { normaliserCode, CODE_FONDATEURS_MIN } = require('../../abonnements/config');
const NOM_FICHIER = 'lien-fondateurs.txt';
const SITE = /^https:\/\/[^\s/]+$/;

/**
 * @param {{ code: string, site: string, dossier: string }} o  `code` : la valeur de V2_FONDATEURS_CODE (jamais son empreinte : une empreinte ne se transforme pas en lien).
 * @returns {{ chemin: string, octets: number }}
 */
function ecrireLien({ code, site, dossier }) {
    if (typeof code !== 'string' || !code.trim()) throw new Error('lien Fondateurs : le code est absent (le .env ne porte peut-être que son empreinte, qui ne suffit pas)');
    const canonique = normaliserCode(code);            // la forme que l'API compare : espaces retirés, majuscules
    if (canonique.length < CODE_FONDATEURS_MIN || canonique.length > 64) throw new Error(`lien Fondateurs : le code n'a pas la longueur admise (${CODE_FONDATEURS_MIN} à 64 caractères)`);
    if (typeof site !== 'string' || !SITE.test(site)) throw new Error('lien Fondateurs : site attendu sous la forme https://hôte (sans chemin)');
    if (typeof dossier !== 'string' || !dossier || !fs.existsSync(dossier) || !fs.statSync(dossier).isDirectory()) throw new Error('lien Fondateurs : le dossier de destination n\'existe pas (il n\'est jamais créé ici)');
    const chemin = path.join(dossier, NOM_FICHIER);
    const contenu = `${site}/fr/fondateurs?code=${encodeURIComponent(canonique)}\n`;
    fs.writeFileSync(chemin, contenu, { encoding: 'utf8', mode: 0o600 });
    return { chemin, octets: Buffer.byteLength(contenu) };
}
module.exports = { ecrireLien, NOM_FICHIER };
