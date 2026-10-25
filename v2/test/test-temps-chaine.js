'use strict';
// LOT TEMPS-CHAINE — banc des changements de temps de la chaîne d'identification (p95 < 5 s).
//   · le pré-filtre de « tout le catalogue au numéro N » : le même résultat que la lecture complète, sur un sur-ensemble ;
//   · l'image NON calculée quand le symbole ou l'attaque a déjà décidé : même forme de champs que departager() ;
//   · le prompt allégé : mêmes champs, moins les deux champs que RIEN ne lit ;
//   · les réglages : lus par ce qu'ils AUTORISENT (« 1 » seulement).
const fs = require('fs'), path = require('path');
const H = require('./_harnais');
const TC = require('../identifier/temps-chaine');
const { comparerNumeros } = require('../../scoring');
const { departager } = require('../../departage-image');
const { v, vrai } = H;

// ── 1. le pré-filtre ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log('=== 1. filtre de pré-sélection du numéro ===');
const re = n => { const f = TC.motifNumeroPartout(n); return f === null ? null : new RegExp(f); };
v('numéro sans chiffre : pas de pré-filtre (l\'égalité de texte reste possible)', TC.motifNumeroPartout('PROMO'), null);
v('numéro nul', TC.motifNumeroPartout(null), null);
v('numéro vide', TC.motifNumeroPartout('   '), null);
v('numéro à plus de 15 chiffres : pas de pré-filtre (parseInt perd la précision)', TC.motifNumeroPartout('1234567890123456'), null);
vrai('"7" retient "7", "007", "SV7", " 07a", "tg07"', ['7', '007', 'SV7', ' 07a', 'tg07'].every(c => re('7').test(c)));
vrai('"7" écarte "17", "70", "SV8", "x", "8-7" (premier groupe de chiffres = 8)', ['17', '70', 'SV8', 'x', '8-7'].every(c => !re('7').test(c)));
vrai('"0" retient "0", "00", "SV0"', ['0', '00', 'SV0'].every(c => re('0').test(c)));
vrai('"TG09" se lit comme 9', re('TG09').test('9') && re('TG09').test('SV009') && !re('TG09').test('19'));

// LA PROPRIÉTÉ QUI COMPTE : tout candidat que comparerNumeros retient est retenu par le motif (un sur-ensemble ; le tri exact reste celui de la production)
let graine = 20261018;
const alea = () => { graine = (graine * 1664525 + 1013904223) % 4294967296; return graine / 4294967296; };
const pick = a => a[Math.floor(alea() * a.length)];
const prefixes = ['', '', '', 'SV', 'tg', 'S', ' ', 'H', 'RC', 'GG', 'a-'], suffixes = ['', '', '', 'C', 'L', 'a', '/100', ' ', '-2'];
const zeros = ['', '', '0', '00', '000'], nombres = ['0', '1', '7', '9', '12', '14', '19', '100', '173', '999', '1234'];
const faire = () => pick(prefixes) + pick(zeros) + pick(nombres) + pick(suffixes);
let paires = 0, retenues = 0, manquees = 0, exemple = null;
for (let i = 0; i < 40000; i++) {
    const lu = faire(), cand = alea() < 0.3 ? lu.toLowerCase() : faire();
    const r = re(lu);
    if (r === null) continue;
    paires++;
    if (comparerNumeros(lu, cand)) { retenues++; if (!r.test(cand)) { manquees++; exemple = exemple || [lu, cand]; } }
}
v(`fuzz : ${paires} paires, ${retenues} que comparerNumeros retient — aucune manquée par le motif`, manquees, 0);
if (exemple) console.log('   exemple manqué :', JSON.stringify(exemple));
vrai('le fuzz a vraiment exercé le cas (plus de 2000 paires retenues)', retenues > 2000);

console.log('=== 1 bis. le filtre Mongo : forme et repli ===');
const f7 = TC.filtreNumeroPartout('7');
vrai('numéro à pré-filtrer : la condition d\'origine (chaîne non vide) est CONSERVÉE', JSON.stringify(f7).includes('"$ne":""'));
vrai('...et le motif y est', JSON.stringify(f7).includes('$regex'));
const fSans = TC.filtreNumeroPartout('PROMO');
v('numéro sans chiffre : EXACTEMENT le filtre d\'origine', fSans, TC.FILTRE_PARTOUT_ORIGINE);

// ── 1 ter. la vraie base : même résultat qu'une lecture complète ──────────────────────────────────────────────────────────────────────────
(async () => {
    console.log('=== 1 ter. mongod en mémoire : pré-filtre contre lecture complète ===');
    const banc = await H.ouvrirBancV2();
    const { MongoClient } = require('mongodb');
    const cl = new MongoClient(banc.uri); await cl.connect();
    const col = cl.db('rm_tc_test').collection('numeros_cartes');
    const docs = [];
    let id = 1;
    for (const numero of ['7', '007', 'SV7', 'tg07', '17', '70', '8', 'PROMO', '', null, '001C', '001L', '14', 'SV14', 'H07', '0007', 'S19', '019'])
        for (const url of [null, '7', '', 'SV7', '19'])
            docs.push({ idProduct: id++, idExpansion: 1 + (id % 5), numero, numeroUrl: url });
    docs.push({ idProduct: id++, idExpansion: 1, numero: 7, numeroUrl: null });           // un numéro écrit comme un NOMBRE (ancienne écriture) : doit rester retenu
    docs.push({ idProduct: id++, idExpansion: 1, numero: null, numeroUrl: 7 });
    await col.insertMany(docs);
    const projection = { idProduct: 1, idExpansion: 1, numero: 1, numeroUrl: 1 };
    const retenus = (liste, lu) => liste.filter(d => comparerNumeros(lu, d.numero) || comparerNumeros(lu, d.numeroUrl)).map(d => d.idProduct).sort((a, b) => a - b);
    let toutOk = true, lus = 0, lusOrigine = 0;
    for (const lu of ['7', '07', 'SV7', '14', '019', '19', '001C', '0', 'PROMO', '5', 'tg9']) {
        const complet = await col.find(TC.FILTRE_PARTOUT_ORIGINE, { projection }).toArray();
        const filtre = await col.find(TC.filtreNumeroPartout(lu), { projection }).toArray();
        lusOrigine += complet.length; lus += filtre.length;
        const a = retenus(complet, lu), b = retenus(filtre, lu);
        if (JSON.stringify(a) !== JSON.stringify(b)) { toutOk = false; console.log(`   ❌ numéro ${lu} : complet ${a.length} retenus, pré-filtré ${b.length}`); }
    }
    v('11 numéros lus : exactement les mêmes produits retenus que par la lecture complète', toutOk, true);
    vrai(`le pré-filtre lit moins de documents (${lus} contre ${lusOrigine})`, lus < lusOrigine);
    await cl.db('rm_tc_test').dropDatabase(); await cl.close();
    await banc.arreter();

    // ── 2. l'image non calculée ──────────────────────────────────────────────────────────────────────────────────────────────────────────
    console.log('=== 2. image non calculée (symbole / attaque prioritaires) ===');
    const modele = await departager({ imageUrl: null, langue: 'EN', total: null, classement: [] });
    const ch = TC.champsImageNonCalcules('symbole');
    v('mêmes clés que departager()', Object.keys(ch).sort(), Object.keys(modele.champs).sort());
    v('statut : abstention-symbole-prioritaire', ch.imageStatut, 'abstention-symbole-prioritaire');
    v('statut : abstention-attaque-prioritaire', TC.champsImageNonCalcules('attaque').imageStatut, 'abstention-attaque-prioritaire');
    vrai('le motif dit que ce n\'est pas calculé', /non calculée?/i.test(ch.imageMotif));
    v('aucun gagnant inventé', [ch.imageGagnant, ch.imageInliers, ch.imageInliersSecond], [null, null, null]);
    v('durée : 0 (rien n\'a été fait)', ch.imageMs, 0);
    v('une cause inconnue : refus', (() => { try { TC.champsImageNonCalcules('autre'); return 'accepte'; } catch { return 'refuse'; } })(), 'refuse');

    // ── 3. le prompt allégé ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
    console.log('=== 3. prompt allégé ===');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8');
    const prompt = new Function('title', 'return `' + src.match(/const prompt = `([\s\S]*?)`;/)[1] + '`')('titre de test');
    const champsDe = p => { const m = p.match(/format exact :\n(\{[^\n]*\})/); return m ? [...m[1].matchAll(/(?:^\{|, )"(\w+)": /g)].map(x => x[1]).sort() : null; };
    const avant = champsDe(prompt), allege = TC.allegerPrompt(prompt);
    vrai('le gabarit JSON d\'origine se lit', Array.isArray(avant) && avant.length >= 18);
    v('les champs du gabarit allégé : les mêmes, MOINS illustrateur et illustrateurConfiance', champsDe(allege), avant.filter(k => !/^illustrateur/.test(k)));
    vrai('le paragraphe « L\'ILLUSTRATEUR » est retiré', prompt.includes('L\'ILLUSTRATEUR') && !allege.includes('L\'ILLUSTRATEUR'));
    vrai('le prompt allégé est plus court', allege.length < prompt.length - 800);
    vrai('le titre de l\'annonce y est toujours, en dernier', allege.endsWith('titre de test'));
    vrai('toutes les consignes des champs lus subsistent (nom, attaque, number, setCode, symboleSet, rarete, reverse, motif, language, etat)',
        ['"nomBrut"', 'L\'ATTAQUE', 'IMPORTANT pour "number"', 'Le "setCode"', 'Pour "symboleSet"', 'Pour "rarete"', 'Pour "reverse"', 'Pour "motif"', 'Pour "language"', 'ÉVALUATION DE L\'ÉTAT'].every(s => allege.includes(s)));
    vrai('idempotent', TC.allegerPrompt(allege) === allege);
    v('un texte sans marque connue : rendu tel quel, jamais déformé', TC.allegerPrompt('autre prompt'), 'autre prompt');

    // ── 4. les réglages ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    console.log('=== 4. réglages ===');
    v('rien dans l\'environnement : tout éteint', TC.reglages({}), { imagePrioritaireSansCalcul: false, secondeParallele: false });
    v('"1" allume', TC.reglages({ V2_TC_IMAGE_PRIORITAIRE: '1' }).imagePrioritaireSansCalcul, true);
    v('"true" n\'allume pas (écrit par ce qu\'on AUTORISE)', TC.reglages({ V2_TC_IMAGE_PRIORITAIRE: 'true' }).imagePrioritaireSansCalcul, false);
    v('"oui", "0", " 1" non plus', ['oui', '0', ' 1', ''].map(x => TC.reglages({ V2_TC_IMAGE_PRIORITAIRE: x }).imagePrioritaireSansCalcul), [false, false, false, false]);
    v('le prompt allégé et le fournisseur par latence ne sont PAS des réglages (rejetés par la mesure)', Object.keys(TC.reglages({ V2_TC_PROMPT_ALLEGE: '1', V2_TC_IA_PROVIDER: 'latency' })), ['imagePrioritaireSansCalcul', 'secondeParallele']);
    // index.js ne branche QUE ce qui est retenu : le prompt envoyé est celui de la production, octet pour octet
    {
        const fs2 = require('fs'), path2 = require('path');
        const src2 = fs2.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8');
        vrai('index.js n\'appelle pas allegerPrompt (rejeté)', !/allegerPrompt\(/.test(src2));
        vrai('index.js envoie `prompt` tel quel', /\{ type: "text", text: prompt \}/.test(src2));
        vrai('index.js n\'ajoute aucun `provider` à la requête du modèle', !/iaProvider/.test(src2));
        vrai('index.js : « tout le catalogue au numéro N » passe par le pré-filtre', /NumeroCarte\.find\(\s*TEMPS_CHAINE\.filtreNumeroPartout\(numeroLu\)/.test(src2));
        vrai('index.js : l\'image n\'est « non calculée » que derrière le réglage ET quand le symbole ou l\'attaque a décidé', /\(departageParSymbole \|\| departageParAttaqueFait\) && TEMPS_CHAINE\.reglages\(\)\.imagePrioritaireSansCalcul/.test(src2));
        vrai('index.js : sans le réglage, departagerParImage est appelé comme avant', /: await departagerParImage\(\{\s*imageUrl: photos\[0\], langue: cardInfo\.language,\s*total: cardInfo\.total, classement\s*\}\);/.test(src2));
    }
    return H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
