// ============================================================
// TEST DE LA RÈGLE « le nombre imprimé est un numéro de Pokédex »
// ============================================================
// Toutes les valeurs viennent d'annonces RÉELLES scannées par les testeurs, avec leur
// vérité vérifiée sur Cardmarket. Aucune n'est inventée.
//
// USAGE : node test-pokedex.js   (pur, aucune base, aucun réseau)

const { numeroEstUnDexId, dexIdsDuNom } = require('./pokedex');

let ok = 0, ko = 0;
function verifier(libelle, obtenu, attendu) {
    const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
    console.log(`  ${bon ? '✅' : '❌'} ${libelle} : ${JSON.stringify(obtenu)}${bon ? '' : ` (attendu ${JSON.stringify(attendu)})`}`);
    bon ? ok++ : ko++;
}

console.log('\n=== 1. Les cinq cartes du testeur ===');
// Vérités : Raichu -> Intro-Pack-Bulbasaur/Raichu-IPB3 (Cardmarket dit 3, la carte dit 026)
//           Ditto -> Challenge-from-the-Darkness/Kogas-Ditto-CFTD (aucun numéro publié)
//           Tangela -> Expansion-Pack/Tangela (aucun numéro publié)
//           Jigglypuff -> Jungle, No.039
//           Dragonite -> Cry-from-the-Mysterious/Dragonite-Lv61-DP5c
{
    verifier('Raichu 026 (= dex 26) -> neutralisé',
        numeroEstUnDexId({ nom: 'Raichu', numero: '026', total: null, langue: 'JP' }).estDex, true);
    verifier("Koga's Ditto 132 (= dex 132) -> neutralisé",
        numeroEstUnDexId({ nom: "Koga's Ditto", numero: '132', total: null, langue: 'JP' }).estDex, true);
    verifier('Tangela 114 (= dex 114) -> neutralisé',
        numeroEstUnDexId({ nom: 'Tangela', numero: '114', total: null, langue: 'JP' }).estDex, true);
    verifier('Jigglypuff 039 (= dex 39) -> neutralisé',
        numeroEstUnDexId({ nom: 'Jigglypuff', numero: '039', total: null, langue: 'JP' }).estDex, true);

    // LE CONTRE-EXEMPLE, et c'est lui qui compte le plus : 180 est un VRAI numéro de carte
    // du set DP5, et le dexId de Dracolosse est 149. La règle ne doit PAS se déclencher.
    const dragonite = numeroEstUnDexId({ nom: 'Dragonite', numero: '180', total: null, langue: 'JP' });
    verifier('Dragonite 180 (dex 149) -> NON neutralisé', dragonite.estDex, false);
    console.log(`       raison : ${dragonite.raison}`);
}

console.log('\n=== 2. Les quatre échecs du banc que la règle explique ===');
// Ces quatre-là sortaient en « troisième état » (nom connu, jamais à ce numéro). La cause
// n'était pas une lecture incohérente : c'était un numéro de Pokédex.
{
    for (const [nom, num, dex] of [['Light Jolteon', '135', 135], ['Dark Haunter', '093', 93],
    ["Misty's Staryu", '120', 120], ['Mew', '151', 151]]) {
        const r = numeroEstUnDexId({ nom, numero: num, total: null, langue: 'JP' });
        verifier(`${nom} ${num} (= dex ${dex}) -> neutralisé`, r.estDex, true);
    }
}

console.log('\n=== 3. Les trois bornes de la règle ===');
{
    // (1) LE TOTAL. Le Charmander McDonald's porte 004/018 : 004 EST son vrai numéro de
    // carte, et la chaîne en a besoin pour trouver MCDP. Sans cette borne, la règle
    // cassait le cas qu'on venait de réparer.
    const mcd = numeroEstUnDexId({ nom: 'Charmander', numero: '004', total: '018', langue: 'JP' });
    verifier('Charmander 004/018 -> NON neutralisé (total imprimé)', mcd.estDex, false);
    console.log(`       raison : ${mcd.raison}`);
    verifier('... mais sans total, il le serait',
        numeroEstUnDexId({ nom: 'Charmander', numero: '004', total: null, langue: 'JP' }).estDex, true);

    // (2) LA LANGUE. Les promos occidentales sont aussi sans total ; on ne les traite pas
    // avant de les avoir mesurées.
    verifier('Raichu 026 en EN -> NON neutralisé (hors périmètre)',
        numeroEstUnDexId({ nom: 'Raichu', numero: '026', total: null, langue: 'EN' }).estDex, false);
    verifier('Raichu 026 en ZH -> neutralisé (langue asiatique)',
        numeroEstUnDexId({ nom: 'Raichu', numero: '026', total: null, langue: 'ZH' }).estDex, true);

    // (3) LE NOM INCONNU ne prouve rien — principe des sources perdues.
    const inconnu = numeroEstUnDexId({ nom: 'Kahili', numero: '173', total: null, langue: 'JP' });
    verifier('nom sans dexId (dresseur) -> NON neutralisé', inconnu.estDex, false);
    console.log(`       raison : ${inconnu.raison}`);
    verifier('aucun numéro lu -> NON neutralisé',
        numeroEstUnDexId({ nom: 'Raichu', numero: null, total: null, langue: 'JP' }).estDex, false);
}

console.log('\n=== 4. La table elle-même ===');
{
    verifier('Raichu -> [26]', dexIdsDuNom('Raichu'), [26]);
    verifier("Koga's Ditto -> [132] (nom de dresseur porté par la table)", dexIdsDuNom("Koga's Ditto"), [132]);
    verifier('apostrophe typographique tolérée', dexIdsDuNom('Koga’s Ditto'), [132]);
    verifier('suffixe [attaques] ignoré', dexIdsDuNom('Raichu [Thunderbolt]'), [26]);
    verifier('nom inconnu -> null', dexIdsDuNom('Professeur Chen'), null);
    verifier('nom vide -> null', dexIdsDuNom(''), null);
}

console.log(`\n${ko === 0 ? '🎉' : '💥'} ${ok}/${ok + ko} assertions passées.`);
process.exit(ko === 0 ? 0 : 1);
