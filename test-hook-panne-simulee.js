// Préchargé par test-hook-commandes.js (`node -r ./test-hook-panne-simulee.js <hook>`) : fait LEVER toute RegExp, donc le hook
// plante en plein verdict. Le banc vérifie qu'un hook qui plante REFUSE (code 2) au lieu de laisser passer (code 1, non bloquant).
RegExp.prototype.test = function () { throw new Error('panne simulée par le banc'); };
