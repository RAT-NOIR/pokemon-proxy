// ============================================================
// LES PREUVES DE PROVENANCE DES LOGOS DÉPOSÉS (lot LOGOS-ECR, 2026-10-13) — de « inconnu » à « officiel », SEULEMENT sur preuve
// ============================================================
// Règle du testeur (logos déposés, a) : « nouvelle recherche du logo officiel dans nos sources légales ; s'il est trouvé, on le prend là » ; (b) : « le même logo retrouvé
// identique sur une source indépendante (photos d'emballage, pages officielles) ». Ces logos portent `source: 'bulbagarden:demande-site'` et `niveau: 'inconnu'` (poser-niveau-logos.js).
// Passer à `officiel` est une MODIFICATION d'une valeur existante : un outil à part, qui ne remplace RIEN d'autre (`source` et `preuve` d'origine restent) et pose un champ neuf
// `<champ>.niveauPreuve` qui rend le geste réversible.
// UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE (§51) : un set et un fichier de la liste fermée ci-dessous ; une entrée dont le niveau est EXACTEMENT `inconnu`, la source et le fichier attendus,
// le sha1 stocké ET le sha256 des octets de R2 (lus par l'appelant) égaux à ceux de la preuve ; une preuve (a) dont la copie archive.org a le MÊME sha256, ou (b) regardée à l'œil, ≥ 15 inliers
// et ≥ 3 fois le meilleur négatif. Tout le reste refuse et le dit — jamais deviné.
// Les preuves (a) ont été obtenues le 2026-10-13 par l'API CDX d'archive.org (S5\LOGOS-ECR\a3-res.json ; S6\LOGOS-BG\b1-res.json pour les 8 jp) : la copie `id_` du fichier Bulbagarden, téléchargée, a le sha256 de notre objet R2.
const LOT = 'logos-preuves-provenance-2026-10';
const DECISION = 'testeur 2026-10-13 (règle des logos déposés : a, source légale retrouvée ; b, source indépendante) — réversible (poser-preuves-logos.js --retirer)';
const SOURCE = 'bulbagarden:demande-site';
const BILLS_TOT = 'https://billsarchive.com/assets/articles/trick-or-trade-history/';

const a = (set, fichier, sha1, sha256, horodatage, urlOrigine) => ({ set, champ: 'logo', fichier, sourceAttendue: SOURCE, sha1, sha256, type: 'a', archive: { url: `https://web.archive.org/web/${horodatage}id_/${urlOrigine}`, horodatage, sha256 } });
const BG = 'https://archives.bulbagarden.net/media/upload/';
// LISTE FERMÉE (21 champs : 20 preuves a, 1 preuve b). Les 9 autres champs « bulbagarden:demande-site » n'ont pas de preuve aujourd'hui : aucune copie archive.org trouvée le 2026-10-13 par les instruments
// de S6\LOGOS-BG (Classic ×3, Prize Pack Six/Seven/Eight, 25th Anniversary, SV11B ×2) — décision du testeur : sans preuve, ils restent non posés (« inconnu »). Trick or Trade 2024 est en (b).
const PREUVES = [
    a('Play-Pokemon-Prize-Pack-Series-One', 'Play! Pokémon Prize Pack Series One logo.png', 'd53a989d6b921c90b79736a6e19cf9ff939b4c5d', 'a9df3089394d8c5ac45ec682a4b7b88cb19e7d109d06e81e07340646987d86e7', '20250427202304', BG + '5/53/Play%21_Pok%C3%A9mon_Prize_Pack_Series_One_logo.png'),
    a('Play-Pokemon-Prize-Pack-Series-Two', 'Play! Pokémon Prize Pack Series Two logo.png', '70ca1c3d337249fb23d2ad43625f607da1f416ab', '1e5325d3c4e6443ec67c7b220da082b251c4907c2e56f0cbaf3947f8d2aebe84', '20251116013419', BG + '6/6e/Play%21_Pok%C3%A9mon_Prize_Pack_Series_Two_logo.png'),
    a('Play-Pokemon-Prize-Pack-Series-Three', 'Play! Pokémon Prize Pack Series Three logo.png', '220e96a12fdbc7c3bc2208454fa705e629515e57', '5a657e2738963ae0d8d4dd41c27cc8c8df53bd743205887f39c726ed0fe5a50b', '20250910233451', BG + '8/82/Play%21_Pok%C3%A9mon_Prize_Pack_Series_Three_logo.png'),
    a('Play-Pokemon-Prize-Pack-Series-Four', 'Play! Pokémon Prize Pack Series Four logo.png', '7e4ed921fd7542c08e06b7229391191f4460a4a6', 'd0c2aee8042d5c923b749153dcc9998b105c33c48142a8e1d8088e8b89213f46', '20250813105449', BG + 'a/a7/Play%21_Pok%C3%A9mon_Prize_Pack_Series_Four_logo.png'),
    a('Play-Pokemon-Prize-Pack-Series-Five', 'Play! Pokémon Prize Pack Series Five Logo.png', '13db03d4d2c081d10487281f1339781ad74ff411', '811df6ab7891e3034bac436eebe30bba6315085584a8ce8a8adb6ceaa040f539', '20250814080613', BG + '8/8b/Play%21_Pok%C3%A9mon_Prize_Pack_Series_Five_Logo.png'),
    a('Play-Pokemon-Prize-Pack-Series-Nine', 'Play! Pokémon Prize Pack Series Nine logo.png', 'ee4fe6255769f7bac0d9000ddab3f2697c3cd8d4', '42b111faf999614d17690d64e15d9d329a6c27668c792e05a906e72729e1a079', '20260708035115', BG + '4/40/Play%21_Pok%C3%A9mon_Prize_Pack_Series_Nine_logo.png'),
    a('Trick-or-Trade-2023', 'Trick or Trade 2023.png', '722d1453dc979b689243d6ec8b28fd6ddced89c7', '2c2d832c725784f28ccbe69b3275d988d34eb22de69f9551ea7cd2193c5764a5', '20240219220500', BG + '0/00/Trick_or_Trade_2023.png'),
    // Trick or Trade 2024 : pas de copie archive.org du fichier ; preuve (b) — logo identique à celui imprimé sur le booster officiel 2024 (photo Bill's Archive), ORB+RANSAC 171 inliers, couleurs et dessin REGARDÉS
    // identiques (planche LOGOS-DEPOSES\planche-tot-crops.png) ; meilleur négatif hors famille : 11 inliers (Prize Pack Nine contre la même photo).
    { set: 'Trick-or-Trade-2024', champ: 'logo', fichier: 'Trick or Trade 2024.png', sourceAttendue: SOURCE, sha1: 'c9d33c7c6d11aac7fc0f41ed4b5834b07785a6f5', sha256: '584ce47322f707b86dc7da08e8cf06e18e0bfd595adfd868496930086c2b8ea2', type: 'b',
      emballage: { photos: [BILLS_TOT + '579930.webp'], inliers: 171, contreExemple: 11, regarde: true, note: 'logo identique à celui imprimé sur le booster Trick or Trade 2024 ; mesure LOGOS-DEPOSES s6-tot.json' } },
    a('Mask-of-Change', 'SV6 Logo JP.png', '1c71aa8645875e100432348be0248d30f17dc47f', 'b7fd5fc16903504a480fd6f069fa583555290d1a2b66e1746f0763e6e3c621a2', '20250628191056', BG + 'e/ed/SV6_Logo_JP.png'),
    a('White-Flare-JP', 'SV11W Logo JP.png', '96e5a84dab22a9f23b333d12ebd19aec76b2d5d6', '33fda420884b854c448aa1acf884e4a3a03a9b94f6fa7eb739948f4bce1ebe31', '20250725091102', BG + '5/51/SV11W_Logo_JP.png'),
    a('White-Flare-JP-Additionals', 'SV11W Logo JP.png', '96e5a84dab22a9f23b333d12ebd19aec76b2d5d6', '33fda420884b854c448aa1acf884e4a3a03a9b94f6fa7eb739948f4bce1ebe31', '20250725091102', BG + '5/51/SV11W_Logo_JP.png'),
    a('30th-Celebration-JP', '30th Celebration Logo JP.png', 'ec81cef9a9dd57b10d6c2b878b311e5a5527bd6a', 'f2ef89d25bd71fd69d15047ea43eec35fa04afc888a7176f926e9210ffc24264', '20260711154448', BG + '1/1f/30th_Celebration_Logo_JP.png'),
    a('Dragon-Selection', 'Dragon Selection Logo.png', '193ae4b6e138b7e5b2785898ee479cda32f94937', '589b787e98879c8d2aecc57aa07c8a335f34878b5257858033470c740285b90d', '20220123102304', BG + '0/08/Dragon_Selection_Logo.png'),
    // Lot LOGOS-BG (décision 5 du testeur, 2026-10-13) : 8 logos jp prouvés par l'API CDX d'archive.org (prefixe <dossier md5>/<nom>) puis copie `id_` au MÊME sha256 que l'objet R2 (S6\LOGOS-BG\b1-res.json).
    a('VSTAR-Universe', 'S12a VSTAR Universe Logo.png', '52f85ea7452900de5050380a55d77010c0adcc89', '48eb1d9c1cb2db2036828057e77a35e6937dd2628c967ab6ddf32d7ecb7affe5', '20251114170311', BG + '4/42/S12a_VSTAR_Universe_Logo.png'),
    a('Ruler-of-the-Black-Flame', 'SV3 Logo JP.png', '6e3594d1d439e4bc6d451338e606dbe2049edb5d', '868dd05bee47bd48f02f54ef0a98d2b59b3300e4681798f92dbbbcedc154e664', '20251231055135', BG + 'a/aa/SV3_Logo_JP.png'),
    a('Stellar-Miracle', 'SV7 Logo JP.png', 'aab4c5ef090f8532998194400e943aa7eb55a783', '0d8812d4195eea7fb821f8aae7ce4a40e15c9d04711754e0a48fbd5971215754', '20240903145525', BG + '6/69/SV7_Logo_JP.png'),
    a('EX-Battle-Boost', 'EX Battle Boost Logo.png', '812ab600c7a800035bedeaa1ba37ddfcb8580ef3', '6c1fc5c513ba5543056a76de204d37af90bbaf1a15a00148d5ff6b2c3e496dc7', '20220105151145', BG + 'b/bb/EX_Battle_Boost_Logo.png'),
    a('Scarlet-ex', 'SV1S Logo JP.png', 'bef2bf3f3ad5fdcbde1a4e1a159ee3dd21fcb95e', 'dc1166717c943ec86670a4791f7809677d714e4dc9873e948fa294fc901818a0', '20260309024920', BG + 'f/fb/SV1S_Logo_JP.png'),
    a('Violet-ex', 'SV1V Logo JP.png', '09382857b4ca04e0b4ce44f866ae6055b0a6352d', 'f0c7d8db17f02f13622b95ff45b7508d6015bc7a90803d2fe076145da9cac739', '20230207011646', BG + 'a/a6/SV1V_Logo_JP.png'),
    a('Mega-Symphonia', 'M1S Logo JP.png', 'c396f48dc2f3cab5c7bd03d96af67471ec3bf13a', 'a7af9f9975b9296a4ae521234b7d7f10b4b17102c541844b0648cd8c4a78bd5f', '20260301035259', BG + 'd/d7/M1S_Logo_JP.png'),
    a('Mega-Brave', 'M1L Logo JP.png', '62fcafe90008a831bcdf0182c5bfcfdad42fc8a3', '5bdb0d42e28ca65ed5577e954c06dd53004125aeb456054a78abbcfbe8bc290e', '20250725082618', BG + '7/79/M1L_Logo_JP.png')
];

const refus = raison => ({ action: 'refus', raison });
const HEX64 = /^[0-9a-f]{64}$/;

/** La preuve est-elle recevable en elle-même ? Rend la raison du refus, ou null. */
function refusDePreuve(p) {
    if (p.champ !== 'logo') return `champ « ${p.champ} » hors de la liste fermée (logo seulement)`;
    if (p.type === 'a') {
        if (!p.archive || !HEX64.test(p.archive.sha256 ?? '')) return 'preuve a sans copie archive.org (sha256) : refus';
        if (p.archive.sha256 !== p.sha256) return 'preuve a : la copie archive.org n\'a pas le même sha256 que le fichier : refus';
        if (!/^\d{14}$/.test(p.archive.horodatage ?? '')) return 'preuve a sans horodatage de copie : refus';
        return null;
    }
    if (p.type === 'b') {
        const e = p.emballage;
        if (!e || e.regarde !== true) return 'preuve b non regardée à l\'œil : refus';
        if (!Array.isArray(e.photos) || !e.photos.length) return 'preuve b sans adresse de photo : refus';
        if (!(e.inliers >= 15)) return `preuve b : ${e.inliers} inliers (< 15) : refus`;
        if (!(e.inliers >= 3 * e.contreExemple)) return `preuve b : ${e.inliers} inliers contre un négatif à ${e.contreExemple} (< 3×) : refus`;
        return null;
    }
    return `type de preuve « ${p.type} » inconnu : refus`;
}

/** Le plan d'UNE preuve : { action: 'poser'|'deja'|'refus', … }. `set` : le document lu (ou null) ; `sha256Octets` : le sha256 des octets de R2, calculé par l'appelant (null si illisible). */
function planifier({ preuve, set, sha256Octets, le = new Date() }) {
    const rp = refusDePreuve(preuve);
    if (rp) return refus(rp);
    if (!set) return refus(`set ${preuve.set} absent`);
    const champ = preuve.champ, e = set[champ];
    if (!e || typeof e !== 'object') return refus(`${preuve.set} ne porte pas de champ ${champ}`);
    if (e.niveau === 'officiel' && e.niveauPreuve?.lot === LOT && e.sha1 === preuve.sha1) return { action: 'deja', id: preuve.set };
    if (e.niveau !== 'inconnu') return refus(`${preuve.set} : niveau « ${e.niveau ?? '∅'} » (seule la valeur « inconnu » se modifie)`);
    if (e.niveauPreuve) return refus(`${preuve.set} porte déjà un niveauPreuve d'un autre lot : rien n'est remplacé`);
    if (e.source !== preuve.sourceAttendue) return refus(`${preuve.set} : source « ${e.source ?? '∅'} » ≠ « ${preuve.sourceAttendue} »`);
    if (e.fichier !== preuve.fichier) return refus(`${preuve.set} : fichier « ${e.fichier} » ≠ « ${preuve.fichier} »`);
    if (e.sha1 !== preuve.sha1) return refus(`${preuve.set} : sha1 de l'entrée (${String(e.sha1).slice(0, 10)}) ≠ celui de la preuve (${preuve.sha1.slice(0, 10)})`);
    if (!sha256Octets) return refus(`${preuve.set} : octets de R2 illisibles, sha256 inconnu (je ne sais pas)`);
    if (sha256Octets !== preuve.sha256) return refus(`${preuve.set} : sha256 des octets (${sha256Octets.slice(0, 10)}) ≠ celui de la preuve (${preuve.sha256.slice(0, 10)})`);
    const niveauPreuve = preuve.type === 'a'
        ? { type: 'a', avant: 'inconnu', lot: LOT, source: `Bulbagarden (copie archive.org ${preuve.archive.horodatage})`, fichier: preuve.fichier, sha256: preuve.sha256, archive: { ...preuve.archive }, decision: DECISION, le }
        : { type: 'b', avant: 'inconnu', lot: LOT, source: `Bulbagarden (dépôt demande-site), logo identique à celui imprimé sur l'emballage officiel : ${preuve.emballage.photos.join(' ')}`, fichier: preuve.fichier, sha256: preuve.sha256, emballage: { ...preuve.emballage }, decision: DECISION, le };
    return {
        action: 'poser', id: preuve.set,
        filtre: { _id: preuve.set, [`${champ}.niveau`]: 'inconnu', [`${champ}.sha1`]: preuve.sha1, [`${champ}.source`]: preuve.sourceAttendue, [`${champ}.niveauPreuve`]: { $exists: false } },
        set: { [`${champ}.niveau`]: 'officiel', [`${champ}.niveauPreuve`]: niveauPreuve }
    };
}

/** Le retrait : seulement ce que ce lot a posé (niveau officiel ET niveauPreuve du lot ET sha1) ; remet `inconnu`. */
function planifierRetrait({ preuve, set }) {
    if (!set) return refus(`set ${preuve.set} absent`);
    const champ = preuve.champ, e = set[champ];
    if (e?.niveauPreuve?.lot !== LOT) return refus(`${preuve.set} ne porte pas la preuve du lot ${LOT} : rien à retirer`);
    if (e.sha1 !== preuve.sha1) return refus(`${preuve.set} : le sha1 du logo a changé : refus`);
    if (e.niveau !== 'officiel') return refus(`${preuve.set} : niveau « ${e.niveau} », pas « officiel » : refus`);
    return { action: 'retirer', id: preuve.set, filtre: { _id: preuve.set, [`${champ}.niveau`]: 'officiel', [`${champ}.niveauPreuve.lot`]: LOT, [`${champ}.sha1`]: preuve.sha1 }, set: { [`${champ}.niveau`]: 'inconnu' }, unset: { [`${champ}.niveauPreuve`]: '' } };
}

/** L'écriture d'UN plan : une `updateOne` dont le filtre garde la condition lue. Rend { action, ecrits }. */
async function appliquer({ S, plan }) {
    if (plan.action === 'deja') return { action: 'deja', ecrits: 0 };
    if (plan.action === 'refus') return { action: 'refus', ecrits: 0, raison: plan.raison };
    const u = await S.updateOne(plan.filtre, { $set: plan.set, ...(plan.unset ? { $unset: plan.unset } : {}) });
    return { action: u.modifiedCount === 1 ? plan.action : 'conflit', ecrits: u.modifiedCount === 1 ? 1 : 0 };
}

/** Arguments : liste fermée ; `--attendu=<n>` obligatoire avec `--ecrire`, refusé sans. */
function analyserArguments(argv) {
    const erreurs = [];
    const ecrire = argv.includes('--ecrire'), retirer = argv.includes('--retirer'), viaEcriture = argv.includes('--lecture-via-ecriture');
    for (const x of argv) if (!/^(--ecrire|--retirer|--lecture-via-ecriture|--attendu=.*)$/.test(x)) erreurs.push(`argument inconnu : ${x} — autorisés : --retirer, --ecrire, --attendu=<n>, --lecture-via-ecriture`);
    const att = argv.find(x => x.startsWith('--attendu='));
    let attendu = null;
    if (att !== undefined) {
        if (!/^--attendu=\d+$/.test(att)) erreurs.push(`${att} : un entier positif ou nul est exigé`);
        else attendu = Number(att.slice(10));
        if (!ecrire) erreurs.push('--attendu n\'a de sens qu\'avec --ecrire');
    } else if (ecrire) erreurs.push('--ecrire exige --attendu=<n> (le nombre de champs à écrire, annoncé par la simulation)');
    return { erreurs, ecrire, retirer, attendu, viaEcriture };
}

module.exports = { LOT, DECISION, PREUVES, refusDePreuve, planifier, planifierRetrait, appliquer, analyserArguments };
