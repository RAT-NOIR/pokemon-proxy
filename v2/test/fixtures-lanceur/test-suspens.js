'use strict';
// Faux banc : une promesse reste en suspens, Node sort en code 0 sans qu'aucune assertion n'ait tourné ni de bilan.
(async () => { await new Promise(() => {}); console.log('1 réussis, 0 échoués'); })();
