// BANC de collecte-cartes/tirage-image.js — le bon fichier Bulbapedia pour un tirage.
// Script node autonome, sans framework, sans base ni réseau : les wikitexts sont des FRAGMENTS RECOPIÉS TELS QUELS
// de l'archive R2 (rat-market-cartes-brut, clé `bulba.cleR2` de chaque carte, lus le 2026-10-08), jamais retouchés
// sauf pour être tronqués aux seuls blocs qui pilotent la résolution (en-tête d'infobox, blocs /Expansion, galerie).
// Lance : node test-tirage-image.js   -> code 1 si un cas échoue.
//
// Deux défauts trouvés par le rapport A1 (cas témoin « SM Black Star Promos »), corrigés ici :
//   C1  le nom de la CARTE est aussi le nom d'un SET (« Detective Pikachu ») : le préfixe du fichier
//       `DetectivePikachuSMPromo170.jpg` était lu comme un set -> `conflit` au lieu du fichier légendé.
//   C2  fichier légendé « SM Black Star Promos » mais numéroté en JAPONAIS (`PikachuSMPromo367.jpg`, 367/SM-P
//       dans le même bloc que cardno=SM227) -> `set-voisin` au lieu de num/227.
const { resoudreTirages } = require('./collecte-cartes/tirage-image');

// ── carte 236303 « Detective Pikachu » (SM170) ──────────────────────────────
const WT_DETECTIVE = `{{PokémoncardInfobox
|cardname=Detective Pikachu
|jname=名探偵ピカチュウ
|jtrans=
|image=DetectivePikachuDetectivePikachu10.jpg
|caption={{TCG|Detective Pikachu}} print<br>Illus. [[MPC Film]]
|reprints=2
|reprint1=DetectivePikachuSMPromo170.jpg
|recaption1={{TCG|SM Black Star Promos|SM Promotional}} print<br>Illus. Unknown
|species=Pikachu
}}
{{PokémoncardInfobox/Expansion
|type=Lightning
|expansion={{TCG|Detective Pikachu}}
|rarity={{rar|Rare Holo}}
|cardno=10/18
|jpexpansion={{TCG|SM-P Promotional cards}}
|jpcardno=338/SM-P
}}
{{PokémoncardInfobox/Expansion
|type=Lightning
|expansion={{TCG|SM Black Star Promos}}
|cardno=SM170
|jpexpansion={{TCG|SM-P Promotional cards}}
|jpcardno=337/SM-P
}}
{{TCGGallery
|type=Lightning
|image1=DetectivePikachuDetectivePikachu10.jpg
|set1=Detective Pikachu
|illus1=MPC Film
|image2=DetectivePikachuSMPromo170.jpg
|caption2={{TCG|SM Black Star Promos|SM Promotional}} print<br>Illus. Unknown
}}`;
const CARTE_DETECTIVE = { nomEn: 'Detective Pikachu', impressions: [
    { tirage: 'intl', expansion: 'Detective Pikachu', numero: '10', total: '18' },
    { tirage: 'jp', expansion: 'SM-P Promotional cards', numero: '338', total: 'SM-P' },
    { tirage: 'intl', expansion: 'SM Black Star Promos', numero: 'SM170', total: null },
    { tirage: 'jp', expansion: 'SM-P Promotional cards', numero: '337', total: 'SM-P' },
] };

// ── carte 239241 « Pikachu » (SM227) ────────────────────────────────────────
const WT_PIKACHU = `{{PokémoncardInfobox
|cardname=Pikachu
|jname=ピカチュウ
|jtrans=
|image=PikachuSMPromo367.jpg
|caption={{TCG|SM Black Star Promos|SM Promotional}} print<br>Illus. 2019 Pikachu Project
|reprints=2
|reprint1=PikachuSMPromo369.jpg
|recaption1={{TCG|SM-P Promotional cards|SM-P Promotional}} print<br>Illus. 2019 Pikachu Project
|species=Pikachu
}}
{{PokémoncardInfobox/Expansion
|type=Lightning
|expansion={{TCG|SM Black Star Promos}}
|cardno=SM227
|jpexpansion={{TCG|SM-P Promotional cards}}
|jpcardno=367/SM-P
}}
{{PokémoncardInfobox/Expansion
|type=Lightning
|jpexpansion={{TCG|SM-P Promotional cards}}
|jpcardno=369/SM-P
}}
{{TCGGallery
|type=Lightning
|image1=PikachuSMPromo367.jpg
|caption1={{TCG|SM Black Star Promos|SM Promotional}} print<br>Illus. 2019 Pikachu Project
|image2=PikachuSMPromo369.jpg
|caption2={{TCG|SM-P Promotional cards|SM-P Promotional}} print<br>Illus. 2019 Pikachu Project
}}`;
const CARTE_PIKACHU = { nomEn: 'Pikachu', impressions: [
    { tirage: 'intl', expansion: 'SM Black Star Promos', numero: 'SM227', total: null },
    { tirage: 'jp', expansion: 'SM-P Promotional cards', numero: '367', total: 'SM-P' },
    { tirage: 'jp', expansion: 'SM-P Promotional cards', numero: '369', total: 'SM-P' },
] };

// ── carte 15237 « Blastoise » : un VRAI conflit (légende « Base Set », fichier `…BaseSet2.jpg` = « Base Set 2 ») ──
const WT_BLASTOISE = `{{PokémoncardInfobox
|cardname=Blastoise
|jname=カメックス
|image=BlastoiseBaseSet2.jpg
|caption={{TCG|Base Set}} print<br>Illus. [[Ken Sugimori]]
|reprints=3
|reprint1=BlastoiseBestCDPromo.jpg
|recaption1={{TCG|Unnumbered Promotional cards|Unnumbered Promotional}} print<br>Illus. [[Ken Sugimori]]
|reprint2=BlastoiseBlastoiseDeck3.jpg
|recaption2={{TCG|Pokémon Trading Card Game Classic|Pokémon TCG Classic}} print<br>Illus. [[Mitsuhiro Arita]]
}}
{{PokémoncardInfobox/Expansion
|type=Water
|expansion={{TCG|Base Set}}
|rarity={{rar|Rare Holo}}
|cardno=2/102
|jpexpansion={{TCG|Expansion Pack}}
}}
{{PokémoncardInfobox/Expansion
|type=Water
|expansion={{TCG|Base Set 2}}
|rarity={{rar|Rare Holo}}
|cardno=2/130
}}`;
const CARTE_BLASTOISE = { nomEn: 'Blastoise', impressions: [
    { tirage: 'intl', expansion: 'Base Set', numero: '2', total: '102' },
    { tirage: 'intl', expansion: 'Base Set 2', numero: '2', total: '130' },
] };

// ── carte 15227 « Growlithe » : « Base Set 2 » n°42, des fichiers d'un AUTRE numéro -> set-voisin ──
const WT_GROWLITHE = `{{PokémoncardInfobox
|cardname=Growlithe
|jname=ガーディ
|image=GrowlitheBaseSet28.jpg
|caption=Illus. [[Ken Sugimori]]
|species=Growlithe
}}
{{PokémoncardInfobox/Expansion
|type=Fire
|expansion={{TCG|Base Set}}
|rarity={{rar|Uncommon}}
|cardno=28/102
|jpexpansion={{TCG|Expansion Pack}}
}}
{{PokémoncardInfobox/Expansion
|type=Fire
|expansion={{TCG|Base Set 2}}
|rarity={{rar|Uncommon}}
|cardno=42/130
}}`;
const CARTE_GROWLITHE = { nomEn: 'Growlithe', impressions: [
    { tirage: 'intl', expansion: 'Base Set', numero: '28', total: '102' },
    { tirage: 'intl', expansion: 'Base Set 2', numero: '42', total: '130' },
] };

// ── carte 15384 « Professor Oak » : le numéro japonais 026 est apparié à DEUX tirages (024 et 025) -> ne se traduit pas ──
const WT_OAK = `{{TCGTrainerCardInfobox
|cardname=Professor Oak
|image=ProfessorOakBaseSet88.jpg
|caption=Illus. [[Ken Sugimori]]
|reprints=2
|reprint1=ProfessorOakVenusaurDeck26.jpg
|recaption1={{TCG|Pokémon Trading Card Game Classic|Pokémon TCG Classic}} print<br>Illus. [[Ken Sugimori]]
}}
{{TCGTrainerCardInfobox/Expansion
|expansion={{TCG|Pokémon Trading Card Game Classic}}
|cardno=024/034
|jpexpansion={{TCG|Pokémon Card Game Classic}}
|jpcardno=026/032
}}
{{TCGTrainerCardInfobox/Expansion
|expansion={{TCG|Pokémon Trading Card Game Classic}}
|cardno=023/034
|jpexpansion={{TCG|Pokémon Card Game Classic}}
|jpcardno=027/032
}}
{{TCGTrainerCardInfobox/Expansion
|expansion={{TCG|Pokémon Trading Card Game Classic}}
|cardno=025/034
|jpexpansion={{TCG|Pokémon Card Game Classic}}
|jpcardno=026/032
}}`;
const CARTE_OAK = { nomEn: 'Professor Oak', impressions: [
    { tirage: 'intl', expansion: 'Pokémon Trading Card Game Classic', numero: '024', total: '034' },
    { tirage: 'jp', expansion: 'Pokémon Card Game Classic', numero: '026', total: '032' },
    { tirage: 'intl', expansion: 'Pokémon Trading Card Game Classic', numero: '023', total: '034' },
    { tirage: 'jp', expansion: 'Pokémon Card Game Classic', numero: '027', total: '032' },
    { tirage: 'intl', expansion: 'Pokémon Trading Card Game Classic', numero: '025', total: '034' },
] };

const CAS = [
    // — les deux défauts —
    { nom: 'C1 SM170 : le nom de la carte est un nom de set -> le fichier légendé « SM Black Star Promos »', wt: WT_DETECTIVE, carte: CARTE_DETECTIVE, exp: 'SM Black Star Promos', numero: 'SM170', classe: 'num', fichier: 'DetectivePikachuSMPromo170.jpg' },
    { nom: 'C2 SM227 : fichier légendé au numéro JAPONAIS 367 -> traduit en n°227 par l\'infobox', wt: WT_PIKACHU, carte: CARTE_PIKACHU, exp: 'SM Black Star Promos', numero: 'SM227', classe: 'num', fichier: 'PikachuSMPromo367.jpg' },
    // — ce qui doit RESTER inchangé —
    { nom: 'inchangé : Detective Pikachu n°10 (fichier DetectivePikachuDetectivePikachu10.jpg, nom de carte = nom de set)', wt: WT_DETECTIVE, carte: CARTE_DETECTIVE, exp: 'Detective Pikachu', numero: '10', classe: 'num', fichier: 'DetectivePikachuDetectivePikachu10.jpg' },
    { nom: 'inchangé : vrai conflit (légende Base Set, fichier BaseSet2) Blastoise Base Set n°2', wt: WT_BLASTOISE, carte: CARTE_BLASTOISE, exp: 'Base Set', numero: '2', classe: 'conflit', fichier: null },
    { nom: 'inchangé : vrai set-voisin Growlithe Base Set 2 n°42', wt: WT_GROWLITHE, carte: CARTE_GROWLITHE, exp: 'Base Set 2', numero: '42', classe: 'set-voisin', fichier: null },
    { nom: 'inchangé : Professor Oak Classic n°025, jp 026 apparié à 024 ET 025 -> pas de traduction', wt: WT_OAK, carte: CARTE_OAK, exp: 'Pokémon Trading Card Game Classic', numero: '025', classe: 'set-voisin', fichier: null },
];

let echecs = 0;
for (const c of CAS) {
    const rs = resoudreTirages(c.wt, c.carte, c.exp, { tirage: 'intl' }).filter(x => x.impression.numero === c.numero);
    const r = rs[0];
    const ok = rs.length === 1 && r.classe === c.classe && r.fichier === c.fichier;
    console.log(`${ok ? '✅' : '🔴'} ${c.nom}\n     attendu ${c.classe}/${c.fichier ?? '∅'} — rendu ${r ? `${r.classe}/${r.fichier ?? '∅'}` : `(${rs.length} résultat)`}`);
    if (!ok) echecs++;
}
console.log(echecs ? `\n🔴 ${echecs} cas en échec sur ${CAS.length}` : `\n✅ ${CAS.length} cas sur ${CAS.length}`);
process.exit(echecs ? 1 : 0);
