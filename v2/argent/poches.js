'use strict';
// Les poches et leur ordre de consommation. L'ordre vient de la configuration (V2_ORDRE_POCHES), jamais d'une constante locale.
// Écrit par ce qu'il AUTORISE : un type de porteur inconnu n'a aucune poche.
function ordreDe(porteur, cfg) {
    if (porteur && porteur.type === 'compte') return cfg.ordrePoches.filter(p => p !== 'essai');
    if (porteur && porteur.type === 'installation') return ['essai', 'achete'];
    return [];
}
const moisCle = d => d.toISOString().slice(0, 7);
// le lundi STRICTEMENT suivant (UTC) : depuis un lundi, le lundi d'après
function prochainLundi(d) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    x.setUTCDate(x.getUTCDate() + (8 - (x.getUTCDay() || 7)));
    return x.toISOString().slice(0, 10);
}
// Le code d'un débit refusé faute de poche : un compte non vérifié se voit demander de CONFIRMER son adresse, tout autre porteur est à court (une seule définition :
// le débit et le contrôle sans débit du scanner, solde.peutPayer, la lisent ici).
const codeRefus = porteur => (porteur && porteur.compte && !porteur.compte.verifie ? 'VERIFICATION' : 'QUOTA');
module.exports = { ordreDe, moisCle, prochainLundi, codeRefus };
