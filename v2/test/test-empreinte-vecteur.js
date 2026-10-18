'use strict';
// Banc MODELE-VISUEL-API (1) — la vérification du vecteur envoyé par l'extension (§3 de l'étude sans service, points 1 à 4). Module PUR : ni base, ni réseau, ni fichier.
// Écrit par ce que le module AUTORISE : exactement 256 nombres finis |x| <= 0,5, une norme L2 dans [0,999 ; 1,001], un meilleur cosinus à l'index >= 0,30. Tout le reste se tait (jamais d'exception).
// Le banc fabrique ses vecteurs (aucune donnée réelle) : une graine fixe, une normalisation, puis l'encodage fp16 petit-boutiste base64 que l'extension fait.
const H = require('./_harnais');
const E = require('../identifier/empreinte-vecteur');

function graine(s) { let x = s >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; }
function unitaire(seed, n = 256) { const r = graine(seed), v = new Float32Array(n); let s = 0; for (let i = 0; i < n; i++) { v[i] = r() - 0.5; s += v[i] * v[i]; } s = Math.sqrt(s); for (let i = 0; i < n; i++) v[i] /= s; return v; }
const b64 = v => E.encoderVecteur(v);

(async () => {
    // ── les constantes sont CELLES de la consigne, pas des valeurs approchées
    H.v('0. constantes : 256 nombres, 512 octets, 684 caractères, |x| <= 0,5, norme [0,999 ; 1,001], cosinus >= 0,30',
        [E.DIM, E.OCTETS, E.BASE64_LONGUEUR, E.ABS_MAX, E.NORME_MIN, E.NORME_MAX, E.COSINUS_MIN], [256, 512, 684, 0.5, 0.999, 1.001, 0.30]);

    // ── fp16 : l'aller-retour des valeurs que l'extension envoie
    H.v('1. fp16 : 0 -> 0, 1 -> 1, -0,5 -> -0,5, 0,333251953125 exact', [E.demiVersFlottant(E.flottantVersDemi(0)), E.demiVersFlottant(E.flottantVersDemi(1)), E.demiVersFlottant(E.flottantVersDemi(-0.5)), E.demiVersFlottant(E.flottantVersDemi(0.333251953125))], [0, 1, -0.5, 0.333251953125]);
    H.vrai('   fp16 : une valeur ordinaire (0,0123) revient à moins de 1e-3 relatif', Math.abs(E.demiVersFlottant(E.flottantVersDemi(0.0123)) - 0.0123) / 0.0123 < 1e-3);
    H.vrai('   fp16 : l\'infini et NaN (exposant 31) ne se décodent pas en nombre fini', !Number.isFinite(E.demiVersFlottant(0x7c00)) && !Number.isFinite(E.demiVersFlottant(0x7e00)) && !Number.isFinite(E.demiVersFlottant(0xfc00)));

    // ── un vecteur de l'extension : 256 composantes unitaires, encodées
    const v = unitaire(1), s64 = b64(v);
    H.v('2. l\'encodage fait 684 caractères base64 (512 octets) et se décode en 256 nombres', [s64.length, Buffer.from(s64, 'base64').length], [684, 512]);
    const d = E.decoderVecteur(s64);
    H.vrai('   decoderVecteur rend ok et 256 nombres', d.ok === true && d.vecteur.length === 256);
    H.vrai('   la norme du vecteur décodé est dans [0,999 ; 1,001] (l\'arrondi fp16 ne la sort pas)', d.ok && (n => n >= 0.999 && n <= 1.001)(Math.sqrt(d.vecteur.reduce((s, x) => s + x * x, 0))));

    // ── la forme : tout ce qui n'est pas exactement la chaîne canonique se tait, sans lever
    const ko = (nom, entree, code) => { let r; try { r = E.decoderVecteur(entree); } catch (e) { r = { leve: String(e && e.message) }; } H.v(nom, r.ok === false ? r.code : r, code); };
    ko('3a. pas une chaîne -> forme', 12345, 'forme');
    ko('3b. null -> forme', null, 'forme');
    ko('3c. chaîne vide -> forme', '', 'forme');
    ko('3d. 683 caractères -> forme', s64.slice(0, 683), 'forme');
    ko('3e. 685 caractères -> forme', s64 + 'A', 'forme');
    ko('3f. un caractère hors alphabet base64 -> forme', s64.slice(0, 10) + '!' + s64.slice(11), 'forme');
    ko('3g. base64 URL (un tiret au lieu de + ou /) -> forme (alphabet standard seulement)', s64.slice(0, 5) + '-' + s64.slice(6), 'forme');
    ko('3h. un espace ou un retour à la ligne glissé -> forme', s64.slice(0, 100) + '\n' + s64.slice(101), 'forme');
    ko('3i. un objet -> forme', { a: 1 }, 'forme');
    ko('3j. un tableau de 256 nombres (pas la forme base64) -> forme', Array.from(v), 'forme');
    // un dernier groupe non canonique (bits de bourrage non nuls) donnerait les mêmes 512 octets : refusé, une seule écriture admise
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const val = alphabet.indexOf(s64[682]), sale = alphabet[(val & ~3) | ((val & 3) === 1 ? 2 : 1)];       // ne change QUE les deux bits de bourrage
    H.v('3k0. contrôle du banc : la variante sale décode les MÊMES 512 octets', Buffer.from(s64.slice(0, 682) + sale + '=', 'base64').equals(Buffer.from(s64, 'base64')), true);
    ko('3k. bits de bourrage non nuls (écriture non canonique du même contenu) -> forme', s64.slice(0, 682) + sale + '=', 'forme');
    // une valeur fp16 non finie en position 17
    const brut = Buffer.from(s64, 'base64'); brut.writeUInt16LE(0x7c00, 34);
    ko('3l. une composante infinie (fp16 0x7c00) -> valeurs', brut.toString('base64'), 'valeurs');
    const nan = Buffer.from(s64, 'base64'); nan.writeUInt16LE(0x7e01, 0);
    ko('3m. une composante NaN -> valeurs', nan.toString('base64'), 'valeurs');

    // ── les valeurs et la norme
    const verifierBrut = x => E.verifierVecteur(x);
    const grand = Float32Array.from(v); grand[3] = 0.51;
    H.v('4a. une composante à 0,51 (> 0,5) -> valeurs', verifierBrut(grand).code, 'valeurs');
    const limite = new Float32Array(256); limite[0] = limite[1] = limite[2] = limite[3] = 0.5;     // 4 × 0,25 = norme 1
    H.vrai('4b. une composante à exactement 0,5 (valeur-limite) est admise si la norme est bonne', verifierBrut(limite).ok === true);
    const petit = Float32Array.from(v).map(x => x * 0.5);
    H.v('4c. norme 0,5 -> norme', verifierBrut(petit).code, 'norme');
    const gros = Float32Array.from(v).map(x => x * 1.002);
    H.v('4d. norme 1,002 -> norme', verifierBrut(gros).code, 'norme');
    const zero = new Float32Array(256);
    H.v('4e. le vecteur nul -> norme (jamais une division)', verifierBrut(zero).code, 'norme');
    const juste = Float32Array.from(v).map(x => x * 1.0009), juste2 = Float32Array.from(v).map(x => x * 0.9991);
    H.vrai('4f. normes 1,0009 et 0,9991 (dans la fenêtre) -> admises', verifierBrut(juste).ok === true && verifierBrut(juste2).ok === true);
    const trop = Float32Array.from(v).map(x => x * 1.0011), pas = Float32Array.from(v).map(x => x * 0.9989);
    H.v('4g. normes 1,0011 et 0,9989 (juste hors de la fenêtre) -> norme, norme', [verifierBrut(trop).code, verifierBrut(pas).code], ['norme', 'norme']);
    H.v('4h. 255 nombres -> forme', verifierBrut(v.slice(0, 255)).code, 'forme');
    H.v('4i. 257 nombres -> forme', verifierBrut(new Float32Array([...v, 0])).code, 'forme');
    H.v('4j. pas un Float32Array -> forme', verifierBrut(Array.from(v)).code, 'forme');
    const inf = Float32Array.from(v); inf[7] = Infinity;
    H.v('4k. une composante infinie -> valeurs', verifierBrut(inf).code, 'valeurs');

    // ── la plausibilité, évaluée SEULEMENT si la forme, les valeurs et la norme passent
    let appels = 0;
    const cos = x => { appels++; return x; };
    const bon = E.verifier(s64, () => cos(0.39));
    H.vrai('5a. cosinus 0,39 -> admis, le vecteur et le cosinus rendus', bon.ok === true && bon.vecteur.length === 256 && bon.meilleurCosinus === 0.39);
    H.v('5b. cosinus 0,30 pile -> admis', E.verifier(s64, () => 0.30).ok, true);
    H.v('5c. cosinus 0,2999 -> plausibilite', E.verifier(s64, () => 0.2999).code, 'plausibilite');
    H.v('5d. cosinus NaN -> plausibilite (une garde qui ne sait pas conclure se tait)', E.verifier(s64, () => NaN).code, 'plausibilite');
    H.v('5e. cosinus qui lève -> plausibilite, jamais une exception', E.verifier(s64, () => { throw new Error('index cassé'); }).code, 'plausibilite');
    H.v('5f. cosinus non nombre (chaîne « 0,9 ») -> plausibilite', E.verifier(s64, () => '0.9').code, 'plausibilite');
    appels = 0;
    E.verifier(12345, () => cos(0.9)); E.verifier(b64(Float32Array.from(v).map(x => x * 2)), () => cos(0.9));
    H.v('5g. une forme ou une norme fausse n\'appelle JAMAIS l\'index (le coût d\'une recherche n\'est pas offert à un vecteur invalide)', appels, 0);
    H.v('5h. sans fonction de cosinus -> plausibilite (on n\'admet jamais sans avoir pu juger)', E.verifier(s64).code, 'plausibilite');

    // ── bruit grossier : la plausibilité est le seul garde-fou contre un vecteur gaussien normalisé (mesuré 0,194-0,348 à l'étude : la marge est mince, la garde ne bloque que le bruit grossier)
    H.v('6. le code de refus est UN mot d\'une liste fermée (forme, valeurs, norme, plausibilite)', E.CODES, ['forme', 'valeurs', 'norme', 'plausibilite']);
    H.bilan();
})().catch(e => { console.error(e); process.exit(1); });
