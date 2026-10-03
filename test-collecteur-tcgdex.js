// node test-collecteur-tcgdex.js — la garde du collecteur TCGdex (`releve`) s'écrit par ce qu'elle AUTORISE : une ligne
// de table, un tirage intl, un set TCGdex nommé par l'unité, présent dans la liste ET portant le nom de l'expansion de la
// ligne. On la fait dire NON sur des unités fabriquées avant de lui confier la file (§41) — et OUI une seule fois.
const { releve } = require('./collecteur-images-tcgdex');
const { TABLE } = require('./collecte-cartes/table-sets');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
// une vraie ligne occidentale de la table, et une japonaise : le banc lit la table de production, pas une copie
const intl = TABLE.find(l => (l.bulba?.tirage || 'intl') === 'intl' && typeof l.bulba?.expansion === 'string' && l.region === 'occidental');
const jp = TABLE.find(l => l.bulba?.tirage === 'jp');
if (!intl || !jp) throw new Error('table sans ligne intl ou jp : le banc ne peut pas conclure');
const sets = [{ id: 'bon', name: intl.bulba.expansion }, { id: 'autre', name: 'Un Tout Autre Set' }, { id: 'jumeau', name: intl.bulba.expansion }];
const etat = u => releve(u, sets).etat ?? 'autorise';

verifier('code absent de la table : refuse', etat({ code: 'ZZZ-inexistant', tcgdexSet: 'bon' }), 'refuse-table');
verifier('ligne japonaise : refuse (TCGdex en ne sert que l\'anglais)', etat({ code: jp.code, tcgdexSet: 'bon' }), 'refuse-region');
verifier('unité sans set TCGdex : refuse', etat({ code: intl.code }), 'refuse-tcgdex-set');
verifier('set TCGdex absent de la liste : refuse', etat({ code: intl.code, tcgdexSet: 'inconnu' }), 'refuse-tcgdex-set');
verifier('set TCGdex d\'un autre nom : refuse', etat({ code: intl.code, tcgdexSet: 'autre' }), 'refuse-tcgdex-set');
verifier('nom porté par DEUX sets TCGdex : refuse (un nom qui désigne deux sets n\'en désigne aucun)', etat({ code: intl.code, tcgdexSet: 'bon' }), 'refuse-tcgdex-set');
const seul = [{ id: 'bon', name: intl.bulba.expansion }, { id: 'autre', name: 'Un Tout Autre Set' }];
verifier('le seul chemin qui autorise : ligne intl, set nommé, nom unique', releve({ code: intl.code, tcgdexSet: 'bon' }, seul).ok, true);

// ➕ 2026-09-29 — une AUTRE langue (TCGdex indonésien, sets IDTH) : la clé est le CODE, et le tirage doit être celui de la langue
const idthL = TABLE.find(l => l.bulba?.tirage === 'idth');
if (!idthL) throw new Error('table sans ligne idth : le banc ne peut pas conclure');
const listeId = [{ id: idthL.code, name: 'Nom Traduit' }, { id: 'AUTRE', name: 'Autre' }];
const etatId = u => releve(u, listeId).etat ?? 'autorise';
verifier('langue sans règle (th) : refuse', etatId({ code: idthL.code, langue: 'th', tcgdexSet: idthL.code }), 'refuse-langue');
verifier('langue id sur une ligne intl : refuse', etatId({ code: intl.code, langue: 'id', tcgdexSet: intl.code }), 'refuse-region');
verifier('langue id sur une ligne jp : refuse', etatId({ code: jp.code, langue: 'id', tcgdexSet: jp.code }), 'refuse-region');
verifier('langue id, set TCGdex d\'un autre CODE : refuse', etatId({ code: idthL.code, langue: 'id', tcgdexSet: 'AUTRE' }), 'refuse-tcgdex-set');
verifier('langue id, unité sans set : refuse', etatId({ code: idthL.code, langue: 'id' }), 'refuse-tcgdex-set');
verifier('langue id, code absent de la liste : refuse', releve({ code: idthL.code, langue: 'id', tcgdexSet: idthL.code }, [{ id: 'AUTRE' }]).etat, 'refuse-tcgdex-set');
verifier('langue id, le seul chemin : ligne idth, set du même code, dans la liste', [releve({ code: idthL.code, langue: 'id', tcgdexSet: idthL.code }, listeId).ok, releve({ code: idthL.code, langue: 'id', tcgdexSet: idthL.code }, listeId).langue], [true, 'id']);
verifier('l\'anglais rend sa langue (en)', releve({ code: intl.code, tcgdexSet: 'bon' }, seul).langue, 'en');

console.log(`\n${ok} passés, ${ko} en échec (ligne intl ${intl.code}, ligne jp ${jp.code}, ligne idth ${idthL.code})`);
process.exit(ko ? 1 : 0);
