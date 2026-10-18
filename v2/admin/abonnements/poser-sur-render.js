'use strict';
// poserSurRender(nomDeVariable, valeur) — LA SEULE écriture sur Render de ce lot. À RELIRE avant de tourner.
//   · UN service : « essai » (jamais la production, jamais le collecteur) ; le nom du service est une constante de ce fichier, pas un paramètre ;
//   · UNE variable permise : V2_STRIPE_WEBHOOK_SECRET (liste fermée) ;
//   · la procédure de render-garde.js : lecture des variables → SAUVEGARDE CHIFFRÉE → essai à blanc PAR LES NOMS (ajoutés / retirés / modifiés : ce diff ne doit contenir que la variable
//     visée, sinon on s'arrête avant d'écrire) → remplacement de l'ensemble → RELECTURE (mêmes noms, mêmes valeurs partout ailleurs, la variable visée à la bonne valeur) ;
//   · la valeur ne sort jamais : ni affichage, ni fichier, ni message d'erreur (les erreurs ne citent que des noms) ;
//   · aucun déploiement n'est déclenché ici : le coordinateur déploie.
const SERVICE = 'essai';
const VARIABLES_PERMISES = Object.freeze(['V2_STRIPE_WEBHOOK_SECRET']);

function fabriquer(garde, trace = () => { }) {
    if (!garde || typeof garde.lireVariables !== 'function' || typeof garde.sauvegarder !== 'function' || typeof garde.diffNoms !== 'function' || typeof garde.remplacerVariables !== 'function') throw new Error('poserSurRender : garde Render incomplète');
    return async function poserSurRender(nom, valeur) {
        if (!VARIABLES_PERMISES.includes(nom)) throw new Error(`poserSurRender : la variable « ${String(nom).slice(0, 60)} » n'est pas permise`);
        if (typeof valeur !== 'string' || valeur.length < 8 || valeur.length > 512 || /[\r\n]/.test(valeur)) throw new Error('poserSurRender : valeur illisible (jamais affichée)');
        const avant = await garde.lireVariables(SERVICE);
        if (!Array.isArray(avant) || !avant.length) throw new Error('poserSurRender : aucune variable lue sur l\'essai — on ne remplace pas un ensemble qu\'on ne connaît pas');
        const sauvegarde = garde.sauvegarder(SERVICE, avant, 'avant-stripe-v2');
        trace(`sauvegarde chiffrée de ${avant.length} variables de l'essai faite`);
        const i = avant.findIndex(x => x.key === nom);
        const apres = avant.map(x => ({ key: x.key, value: x.value }));
        if (i >= 0) apres[i] = { key: nom, value: valeur }; else apres.push({ key: nom, value: valeur });
        const d = garde.diffNoms(avant, apres);
        trace(`essai à blanc (noms) : ajoutés [${d.ajoutes.join(', ')}] · retirés [${d.retires.join(', ')}] · modifiés [${d.modifies.join(', ')}]`);
        const autres = [...d.ajoutes, ...d.retires, ...d.modifies].filter(k => k !== nom);
        if (autres.length || d.retires.length) throw new Error('poserSurRender : le diff touche autre chose que la variable visée — arrêt avant toute écriture');
        // M5 : juste avant le remplacement, une seconde lecture doit compter le MÊME nombre de variables (le PUT remplace l'ensemble : une variable que Render génère, masque ou qui vient d'être
        // ajoutée à la main serait perdue). Les variables à valeur générée par Render et les fichiers secrets ne passent pas par cette API : le coordinateur contrôle l'essai à la main.
        const verif = await garde.lireVariables(SERVICE);
        if (!Array.isArray(verif) || verif.length !== avant.length) throw new Error(`poserSurRender : le nombre de variables a changé entre deux lectures (${avant.length}, puis ${Array.isArray(verif) ? verif.length : '?'}) — arrêt avant toute écriture`);
        await garde.remplacerVariables(SERVICE, apres, { sauvegarde, essaiABlanc: true });
        const relu = await garde.lireVariables(SERVICE);
        const m = new Map(relu.map(x => [x.key, x.value])), attendu = new Map(apres.map(x => [x.key, x.value]));
        const ecarts = [...new Set([...m.keys(), ...attendu.keys()])].filter(k => m.get(k) !== attendu.get(k));
        if (ecarts.length) throw new Error(`poserSurRender : la relecture diffère de ce qui était posé (variables : ${ecarts.join(', ')})`);
        trace(`relecture des noms : ${relu.length} variables, ${nom} présente, le reste inchangé`);
        return { service: SERVICE, variable: nom, sauvegarde: sauvegarde.fichier ? 'chiffrée (fichier)' : 'faite' };
    };
}
module.exports = { fabriquer, SERVICE, VARIABLES_PERMISES };
