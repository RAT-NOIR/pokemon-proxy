// ============================================================
// TESTS — L'IDENTITÉ DU BANC N'A QU'UNE SEULE DÉFINITION
// ============================================================
// POURQUOI CE FICHIER EXISTE. `banc-seaux.js` a été écrit pour qu'il n'existe qu'UNE
// définition de l'identité d'une carte scannée — après l'incident des 32 vérités saisies
// sous des clés que le banc ne produisait plus. Et pendant tout ce temps, il en contenait
// DEUX : `identiteDe`, et une copie écrite en ligne dans `numeroter()` pour dédoublonner.
// Personne ne l'avait vu parce que les deux copies étaient d'accord.
//
//   ⚠️ DEUX DÉFINITIONS DE LA MÊME RÈGLE DANS DEUX ENDROITS DIVERGENT TOUJOURS.
//   Sixième occurrence du motif. Le correctif n'est jamais de synchroniser les copies —
//   c'est d'en supprimer une, PUIS d'empêcher la suivante de naître.
//
// CE FICHIER EST CETTE SECONDE MOITIÉ. Il ne vérifie pas que l'identité est « bonne » :
// il vérifie qu'elle est UNIQUE. Si quelqu'un rajoute une composante à `identiteDe` sans
// la rajouter au dédoublonnage — ou l'inverse, ou réécrit une clé en ligne — une des
// assertions ci-dessous tombe.
//
// USAGE : node test-banc-seaux.js   (pur, aucune base, aucun réseau)
const SEAUX = require('./banc-seaux');
const { COMPOSANTES_IDENTITE, identiteDe, identiteDeVerite, cleDeDedoublonnage, seauDe, numeroter } = SEAUX;

let echecs = 0;
function verifier(libelle, obtenu, attendu) {
    const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
    if (!ok) { echecs++; console.log(`  ❌ ${libelle} : obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`); }
    else console.log(`  ✅ ${libelle}`);
}

// ⚠️ LA DATE EST ANTÉRIEURE À LA FRONTIÈRE DU HOLDOUT, ET CE N'EST PAS UN DÉTAIL.
// `seauDe` rend 'entrainement' immédiatement dans ce cas, AVANT de regarder le nom ou le
// numéro. Sans cette précaution, muter `nom` pourrait changer le seau (une carte déclarée
// en vérification l'est par nom + numéro) et le test attribuerait à l'identité un
// changement qui vient du seau.
const AVANT_FRONTIERE = new Date('2026-07-20T10:00:00Z');

// Une ligne de journal plausible, avec plus de champs que l'identité n'en utilise :
// c'est ce surplus qui permet de vérifier que l'identité NE les prend PAS.
const ligne = () => ({
    le: AVANT_FRONTIERE, nom: 'Wartortle', numero: '019', total: '029', setCode: 'e1',
    langue: 'JP', rarete: 'normale', symboleSet: 'e1', idProduct: 762583, version: 'aaaaaaaaaaaa'
});

console.log('--- 1. LA CLÉ DE DÉDOUBLONNAGE DÉRIVE DE L\'IDENTITÉ, elle ne la recopie pas ---');
{
    const d = ligne();
    verifier('cleDeDedoublonnage = seau + identité, exactement',
        cleDeDedoublonnage(d), `${seauDe(d)}|${identiteDe(d)}`);
    verifier('l\'identité d\'une vérité se calcule comme celle d\'une ligne',
        identiteDeVerite({ lu: d }), identiteDe(d));
}

console.log('\n--- 2. LE CONTRÔLE QUI ÉCHOUE SI LES DEUX DÉFINITIONS DIVERGENT ---');
// Pour CHAQUE champ d'une ligne, on le mute et on regarde bouger les deux clés. Elles
// doivent bouger ENSEMBLE, et seulement pour les composantes déclarées. Un champ ajouté
// d'un seul côté fait tomber l'une des deux lignes ci-dessous.
{
    const CHAMPS = ['nom', 'numero', 'total', 'setCode', 'langue', 'rarete', 'symboleSet', 'idProduct', 'version'];
    const bougentEnsemble = [], identiteSeule = [], dedoublonnageSeul = [];
    for (const champ of CHAMPS) {
        const a = ligne();
        const b = { ...a, [champ]: 'VALEUR-MUTEE-POUR-LE-TEST' };
        const ident = identiteDe(a) !== identiteDe(b);
        const cle = cleDeDedoublonnage(a) !== cleDeDedoublonnage(b);
        if (ident && cle) bougentEnsemble.push(champ);
        else if (ident) identiteSeule.push(champ);
        else if (cle) dedoublonnageSeul.push(champ);
    }
    verifier('les champs qui bougent les DEUX clés = les composantes déclarées',
        bougentEnsemble, [...COMPOSANTES_IDENTITE]);
    verifier('AUCUN champ ne bouge l\'identité seule', identiteSeule, []);
    verifier('AUCUN champ ne bouge le dédoublonnage seul', dedoublonnageSeul, []);
}

console.log('\n--- 3. `setCode` EST HORS DE LA CLÉ — la régression qu\'on ne veut plus ---');
// Le cas mesuré : 3 cartes du journal occupaient DEUX places de seau chacune selon que
// l'IA avait lu le code, et les trois avaient abouti au MÊME produit.
{
    const avec = ligne();
    const sans = { ...ligne(), setCode: null };
    verifier('même carte, code lu ou non -> MÊME identité', identiteDe(avec), identiteDe(sans));
    verifier('même carte, code lu ou non -> MÊME clé de dédoublonnage',
        cleDeDedoublonnage(avec), cleDeDedoublonnage(sans));
    const { lignes } = numeroter([avec, sans]);
    verifier('numeroter() n\'en garde qu\'UNE ligne', lignes.length, 1);
    verifier('  ... et c\'est la PREMIÈRE vue', lignes[0].d.setCode, 'e1');
}

console.log('\n--- 4. CE QUI RESTE DISTINCT ---');
{
    const base = ligne();
    verifier('un numéro différent -> deux identités',
        identiteDe(base) !== identiteDe({ ...base, numero: '020' }), true);
    verifier('un total différent -> deux identités',
        identiteDe(base) !== identiteDe({ ...base, total: '032' }), true);
    // Le seau reste dans la clé de dédoublonnage : deux scans identiques de part et
    // d'autre d'une frontière restent deux lignes.
    const apres = { ...base, le: new Date('2026-08-10T10:00:00Z') };
    verifier('même carte, deux seaux -> deux clés de dédoublonnage',
        cleDeDedoublonnage(base) !== cleDeDedoublonnage(apres), true);
    verifier('  ... mais UNE SEULE identité', identiteDe(base), identiteDe(apres));
}

console.log('\n--- 5. LES ABSENCES NE SE CONFONDENT PAS ENTRE ELLES ---');
{
    // null et chaîne vide se rendent pareil (les deux valent « rien lu »), mais une
    // composante absente ne doit pas décaler les autres.
    verifier('null et \'\' donnent la même identité',
        identiteDe({ nom: 'Abra', numero: null, total: '102' }),
        identiteDe({ nom: 'Abra', numero: '', total: '102' }));
    verifier('un champ vide ne décale pas les suivants',
        identiteDe({ nom: 'Abra', numero: null, total: '102' }), 'Abra||102');
    verifier('une vérité sans champ `lu` ne rend aucune identité', identiteDeVerite({}), null);
}

console.log(`\n${echecs === 0 ? '✅ tout passe' : `❌ ${echecs} échec(s)`}`);
process.exit(echecs === 0 ? 0 : 1);
