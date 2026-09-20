// TEST — collecte-cartes/lecture-sure.js. Aucune base, aucun réseau.
//   node test-lecture-sure.js      -> code 0 si tout passe
//
// 🔑 CE BANC NE TESTE PAS DES CAS INVENTÉS : IL REJOUE LES VIDES RÉELLEMENT PRODUITS DANS CE DÉPÔT,
// avec leurs vrais noms de champ et leurs vrais dénominateurs. C'est la seule forme qui prouve
// quelque chose — un helper qui attrape des exemples fabriqués pour lui attrape ses propres
// exemples. Chaque cas porte la date et le § où l'occurrence est écrite.
//
// ⚠️ ET LA MOITIÉ DU BANC TESTE QUE LE HELPER SE TAIT. Un contrôle qui crie sur un cas normal est
// contourné le jour où il a raison (§25) : les zéros LÉGITIMES — un set sans carte, une file sans
// unité, une population hétérogène — doivent passer sans un mot. Sans ces cas-là, on ne teste pas
// une garde, on teste un interrupteur.
const { champ, champSur, apparier } = require('./collecte-cartes/lecture-sure');

let passes = 0, echecs = 0;
const ok = (nom, cond, detail = '') => { if (cond) { passes++; console.log(`   ✅ ${nom}`); } else { echecs++; console.log(`   🔴 ${nom}${detail ? ` — ${detail}` : ''}`); } };

// « leve » attrape l'exception et rend son message, pour qu'on puisse vérifier qu'il NOMME la cause.
function leve(fn) { try { fn(); return null; } catch (e) { return e.message; } }

console.log('\n════ CE QUI DOIT LEVER — les vides réellement produits ════');

// #1 — 2026-09-21, §39. `require('./table-sets.js').TABLE_SETS` : l'export s'appelle `TABLE`.
// Annoncé « 152 expansions, 9 144 produits sans ligne » ; réel 134 / 8 467.
{
    const module_ = { TABLE: [{ code: 'BS' }], TABLE_AUTO: [], TABLE_SANS_PAGE: [] };
    const m = leve(() => champ(module_, 'TABLE_SETS', { de: "require('./table-sets')" }));
    ok('#1 TABLE_SETS sur un export nommé TABLE lève', !!m);
    ok('#1 … et le message NOMME les clés disponibles (c\'est lui qui dit « tu voulais TABLE »)',
        !!m && m.includes('TABLE_AUTO') && m.includes('TABLE'), m);
}

// #2 — 2026-09-21, §23. `completImages.mesures` : le champ s'appelle `mesures`.
{
    const sets = [{ _id: 'artofpkm/Skyridge', mesures: { a: [{ w: 465 }] } }, { _id: 'artofpkm/DP2', mesures: {} }];
    const m = leve(() => champSur(sets, 'completImages.mesures', { collection: 'collecte_images_etat' }));
    ok('#2 completImages.mesures sur 2 documents lève', !!m);
    ok('#2 … et le message imprime le DÉNOMINATEUR (0 sur 2, pas « aucune mesure »)',
        !!m && /0 des 2 documents/.test(m), m);
}

// #3 — 2026-09-21, §23. `mesures` sur des sets BULBAPEDIA : leur champ est `infosListe`.
// 🔴 Le plus retors des cinq : le nom de champ est JUSTE, mais pas pour CETTE population.
{
    const bulba = [{ _id: 'bulbapedia/Skyridge', infosListe: [{ w: 465 }] }, { _id: 'bulbapedia/Aquapolis', infosListe: [{ w: 350 }] }];
    ok('#3 `mesures` sur des sets Bulbapedia lève', !!leve(() => champSur(bulba, 'mesures', { collection: 'collecte_images_etat (bulbapedia)' })));
    ok('#3 … et `infosListe` sur la même population passe', champSur(bulba, 'infosListe').length === 2);
}

// #4 — 2026-09-21. `file_images._id` est un CODE de set ; il était apparié à des `slugSet`.
// Tous les comptes de produits sont sortis à 0.
{
    const m = leve(() => apparier(['DP2', 'SK', 'AQ'], ['Diamond-Pearl', 'Skyridge', 'Aquapolis'],
        { gauche: 'file_images._id', droite: 'cartes.sets', cle: 'code↔slugSet' }));
    ok('#4 code ↔ slugSet entre deux collections sans clé commune lève', !!m);
    ok('#4 … et le message montre un exemple de CHAQUE côté (c\'est ce qui rend la faute évidente)',
        !!m && m.includes('DP2') && m.includes('Skyridge'), m);
}

// #5 — 2026-09-21, aujourd'hui. `collecte_etat._id` est un slugSet ; je l'ai cherché par CODE.
// « 0 collectées » sur 34 lignes dont 16 étaient faites.
{
    ok('#5 collecte_etat cherché par code lève',
        !!leve(() => apparier(['CSMLC', 'CSGC'], ['Lillies-Support-Gift-Box', 'Return-of-the-Dragon'],
            { gauche: 'lignes ATCG', droite: 'collecte_etat._id', cle: 'code' })));
}

// #6 — 2026-09-20, §39. La clé par le NOM sur les sets chinois : 0 paire sur 49, parce que les
// deux sources traduisent chacune de leur côté (« Brilliant Fantasy » / « Sparkling Fable »).
{
    ok('#6 clé par le nom sur les sets chinois lève',
        !!leve(() => apparier(['Brilliant Fantasy', 'Eternal Birth'], ['Sparkling Fable', 'Ancient Times, Future Progress'],
            { gauche: 'Cardmarket', droite: 'Bulbapedia', cle: 'nom traduit' })));
}

// #7 — 2026-09-21, §34. Le slug Cardmarket apparié au nom Bulbapedia sur les Trainer Kits :
// « 4 kits sans aucune carte déclarante » ; 10 sur 11 ont les leurs.
{
    ok('#7 slug Cardmarket ↔ nom Bulbapedia sur les Trainer Kits lève',
        !!leve(() => apparier(['BW-Trainer-Kit', 'DP-Trainer-Kit'], ['Black & White Trainer Kit', 'Diamond & Pearl Trainer Kit'],
            { gauche: 'slug', droite: 'bulba.expansion', cle: 'nom' })));
}

// #8 — `videAutorise: true` est refusé. Une échappatoire sans RAISON ÉCRITE est une échappatoire
// qu'on prend sans y penser, donc elle ne coûte rien, donc elle ne protège de rien.
{
    const m = leve(() => champ({ a: 1 }, 'b', { videAutorise: true }));
    ok('#8 videAutorise: true (sans raison) lève', !!m && /RAISON/.test(m), m);
}

console.log('\n════ CE QUI NE DOIT PAS LEVER — les zéros légitimes ════');

// Un zéro sur un dénominateur NUL est normal : aucune information n'est disponible, et prétendre
// le contraire ferait crier la garde sur un set qu'on n'a simplement pas encore collecté.
ok('un set sans aucune carte ne fait pas crier `apparier`',
    apparier([], ['Skyridge'], { gauche: 'cartes du set', droite: 'setlist', videAutorise: 'set pas encore collecté' }).trouvees.length === 0);

// Une population HÉTÉROGÈNE est une information, pas une panne : 2 documents sur 3 portent le champ.
ok('un champ présent sur 2 documents de 3 passe et rend les 2 porteurs',
    champSur([{ w: 1 }, { w: 2 }, {}], 'w').length === 2);

// Un appariement PARTIEL passe, et rend ce qui manque — c'est le cas utile le plus fréquent.
{
    const r = apparier(['A', 'B', 'C'], ['A', 'B'], { gauche: 'g', droite: 'd', cle: 'k' });
    ok('un appariement à 2/3 passe, rend le taux et les manquantes',
        r.trouvees.length === 2 && Math.abs(r.taux - 2 / 3) < 1e-9 && r.manquantes.join() === 'C');
}

// ⚠️ ET LE CAS QUI DIT LE PLUS SUR LE RÉGLAGE : un appariement FAIBLE avertit sans lever.
// Au-dessus de zéro, c'est un jugement — et un jugement qui s'arme tout seul devient un seuil qu'on
// baisse pour faire passer un cas (§23). Zéro est la seule valeur qui ne se discute pas.
{
    const g = Array.from({ length: 100 }, (_, i) => `g${i}`);
    const r = apparier(g, ['g0', 'g1'], { gauche: 'g', droite: 'd', cle: 'k' });
    ok('un appariement à 2 % AVERTIT mais ne lève pas', r.trouvees.length === 2);
}

// Un vide autorisé AVEC sa raison passe, et la raison est imprimée à l'écran juste au-dessus.
ok('un vide autorisé avec une raison écrite passe',
    champ({ restes: [] }, 'restes', { de: 'état', videAutorise: 'un set sans reste est le bon résultat' }) !== undefined);

console.log(`\n════ ${passes} passés · ${echecs} en échec ════`);
process.exit(echecs ? 1 : 0);
