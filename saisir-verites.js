// ============================================================
// SAISIE DES VÉRITÉS DU BANC — une carte à la fois, sans se faire influencer
// ============================================================
// LE GOULOT RÉEL. Soixante-dix cartes à vérifier une par une, c'est plusieurs heures, et
// c'est là qu'on bâcle. Cet outil ne remplace pas la vérification — il la rend supportable
// et surtout TRAÇABLE.
//
// ⚠️ LE PIÈGE QU'IL ÉVITE : VOIR LA RÉPONSE DE LA CHAÎNE AVANT DE SE PRONONCER.
// Si l'outil affichait d'emblée les candidats classés, le premier de la liste deviendrait
// la réponse par défaut — et le banc mesurerait alors l'accord de l'opérateur avec la
// chaîne, pas la vérité. C'est la même famille de défaut que « la référence tirée du
// système mesuré », qui a déjà coûté deux réussites comptées comme des régressions.
// D'où le déroulé en deux temps :
//   1. la carte SEULE : l'image, et ce que l'IA a lu. Rien d'autre.
//   2. les candidats, UNIQUEMENT si on les demande — et le fait de les avoir demandés est
//      ENREGISTRÉ dans la provenance de la vérité.
// On ne l'interdit pas : parfois il faut voir la liste pour reconnaître une carte. Mais une
// vérité saisie à l'aveugle et une vérité saisie après avoir vu la liste ne valent pas la
// même chose, et le banc doit pouvoir les distinguer.
//
// CE QU'IL ÉCRIT : banc-verites.json, indexé par CLÉ, avec la provenance et la date. Rien
// n'est écrit en base. Le fichier est relu à chaque lancement : on peut s'arrêter et
// reprendre.
//
// USAGE :
//   node saisir-verites.js              les scans du holdout non encore saisis
//   node saisir-verites.js --tout       y compris ceux déjà saisis (pour corriger)
//   node saisir-verites.js --seau=verification
//   node saisir-verites.js --cle=H078   UNE carte, par sa clé de banc (filtre d'affichage :
//                                       le compte complet du seau reste imprimé au-dessus)

require('dotenv').config();
const fs = require('fs');
const readline = require('readline');
const mongoose = require('mongoose');
// ⚠️ LA LISTE DES CANDIDATS N'EST PLUS CONSTRUITE ICI. Elle vient de `candidats-fiche.js`,
// partagée avec le générateur de fiches — sinon « #3 » désignerait une carte dans la fiche
// et une autre dans l'outil, et la vérité enregistrée serait fausse en silence.
// (`scoring`, `pokedex` et les fonctions de vivier ne sont plus importés ici : ils sont
//  passés dans ce module-là, avec la construction qui les utilisait.)
const { construireCandidats } = require('./candidats-fiche');

const SORTIE = 'banc-verites.json';
const DATE_HOLDOUT = new Date('2026-08-03T00:00:00Z');
const J = mongoose.model('Jv', new mongoose.Schema({}, { strict: false }), 'journal_scans');
const Cat = mongoose.model('Pv', new mongoose.Schema({}, { strict: false }), 'catalogue_produits');
const CS = mongoose.model('Cv', new mongoose.Schema({}, { strict: false }), 'codes_set');

// ⚠️ PAR DÉFAUT : TOUS LES SEAUX. L'ancien défaut était `--seau=holdout`, et il a menti —
// il annonçait « 0 à saisir » pendant que 41 cartes attendaient dans le seau « lot ». Un
// outil qui répond « rien à faire » sur une question qu'on ne lui a pas posée est pire
// qu'un outil qui refuse : on le croit.
// Le seau de chaque carte est affiché, et `--seau=<nom>` reste disponible pour restreindre.
const argSeau = process.argv.find(a => a.startsWith('--seau='));
const seauVoulu = argSeau ? argSeau.split('=')[1] : null;   // null = tous
const tout = process.argv.includes('--tout');
// ⚠️ FILTRE D'AFFICHAGE, PAS DE SÉLECTION. `--cle=H078` restreint la liste À SAISIR à une
// seule clé, pour ne pas parcourir 63 cartes quand une seule manque. Il s'applique APRÈS
// `numeroter` et APRÈS le calcul de `aFaire` : la numérotation reste globale, l'ancrage
// reste l'identité, et le comportement par défaut (aucun `--cle`) est inchangé.
// 🔴 UNE CLÉ INCONNUE LE DIT. Rendre une liste vide en silence ferait croire « rien à
// saisir » sur une faute de frappe — exactement le mensonge que l'ancien défaut
// `--seau=holdout` produisait (« 0 à saisir » pendant que 41 cartes attendaient).
const argCle = process.argv.find(a => a.startsWith('--cle='));
const cleVoulue = argCle ? argCle.split('=')[1] : null;

// ⚠️ SEAUX ET NUMÉROTATION : UNE SEULE SOURCE, partagée avec le banc. Ce fichier avait sa
// PROPRE copie de `seauDe` — trois seaux au lieu de quatre — et n'excluait pas les lignes
// hors service. Conséquence mesurée : 32 vérités saisies une par une sous H009..H033 quand
// le banc numérotait L001..L025. Aucune n'est arrivée, et rien ne le disait.
// Voir banc-seaux.js : deux définitions de la même règle divergent toujours.
const { seauDe, numeroter, identiteDe } = require('./banc-seaux');

function lireVerites() {
    try { return JSON.parse(fs.readFileSync(SORTIE, 'utf8')); }
    catch (_) { return { _lisezMoi: 'Vérités du banc, saisies à la main. `source` dit COMMENT elles ont été obtenues.', verites: {} }; }
}
function ecrireVerites(v) { fs.writeFileSync(SORTIE, JSON.stringify(v, null, 2), 'utf8'); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const demander = q => new Promise(r => rl.question(q, x => r(x.trim())));

const NumeroCarte = mongoose.model('Nvs', new mongoose.Schema({}, { strict: false }), 'numeros_cartes');

/**
 * RÉSOUT CE QUE LE TESTEUR A SOUS LES YEUX vers un idProduct.
 *
 * POURQUOI. L'idProduct est une donnée INTERNE : elle n'apparaît nulle part sur Cardmarket.
 * Exiger qu'elle soit tapée à la main, c'est garantir des fautes de frappe silencieuses sur
 * soixante-dix lignes — et une vérité fausse est pire qu'une vérité manquante, parce qu'elle
 * ne se signale pas. Ce que le testeur a réellement devant lui, c'est l'URL de la fiche ou
 * son slug : « Rhydon-V2-EC4055 ».
 *
 * ⚠️ ELLE REFUSE PLUTÔT QUE D'APPROCHER. Aucun repli sur « le plus proche » : un slug
 * inconnu est rejeté avec son message. C'est le quatrième principe appliqué à la saisie —
 * ne rien trouver n'autorise pas à désigner quelque chose.
 *
 * ⚠️ ET ELLE NE TRANCHE PAS ENTRE LES VARIANTES. Un même slug peut couvrir V1/V2/V3 : on
 * les montre toutes et c'est le testeur qui choisit. Choisir à sa place reviendrait à
 * remettre le jugement de la chaîne dans la vérité censée la juger.
 *
 * @returns {Promise<{ok: boolean, idProduct?: number, moyen: string, message?: string, choix?: object[]}>}
 */
async function resoudreSaisie(saisie, Cat, nomLu = null) {
    const brut = String(saisie).trim();
    if (/^\d+$/.test(brut)) return { ok: true, idProduct: Number(brut), moyen: 'idProduct' };

    // Une URL Cardmarket : le dernier segment est le slug du produit, l'avant-dernier le
    // slug du set. Le second sert à départager si le slug seul est ambigu.
    let moyen = 'slug', slug = brut, slugSet = null;
    if (/^https?:\/\//i.test(brut)) {
        moyen = 'url';
        const segments = brut.split('?')[0].split('#')[0].replace(/\/+$/, '').split('/');
        slug = decodeURIComponent(segments[segments.length - 1] || '');
        slugSet = decodeURIComponent(segments[segments.length - 2] || '') || null;
        if (!slug) return { ok: false, moyen, message: 'URL sans segment final exploitable' };
    }

    // Recherche EXACTE d'abord, puis insensible à la casse — jamais approchée.
    const echapper = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let docs = await NumeroCarte.find({ slug }).lean();
    if (!docs.length) docs = await NumeroCarte.find({ slug: new RegExp(`^${echapper(slug)}$`, 'i') }).lean();
    if (!docs.length) {
        // ════════════════════════════════════════════════════════════════════
        // UN REFUS QUI NOMME LA SORTIE — sinon on retape la même URL des soirs
        // ════════════════════════════════════════════════════════════════════
        // L'OCCURRENCE, LE 2026-09-08. Le testeur a retapé plusieurs soirs de suite l'URL
        // de Palafin ex (`Prismatic-Evolutions/Palafin-ex-PRE151`). Le message était EXACT
        // — aucun produit ne porte ce slug — et INUTILISABLE : il ne disait pas qu'un autre
        // chemin existait. Le produit était pourtant là (idProduct 805545), sur une ligne
        // `numeros_cartes` apprise sans champ `slug`. MESURÉ : 1 787 lignes sur 69 598
        // (2,6 %) sont dans ce cas, et AUCUNE URL ne peut les désigner.
        //
        // 🔑 UN OUTIL QUI REFUSE DOIT DIRE CE QU'ON PEUT FAIRE À LA PLACE. Un refus muet
        // transforme une donnée manquante en boucle silencieuse.
        //
        // ⛔ ET IL NE CHOISIT TOUJOURS PAS, MÊME QUAND UN SEUL CANDIDAT SORT. C'est le
        // principe écrit plus haut : trancher à la place du testeur remettrait le jugement
        // de la chaîne dans la vérité censée la juger. On AFFICHE, on redemande.
        const PLAFOND = 12;
        let candidats = [], totalNom = 0;
        if (nomLu) {
            // Le nom CATALOGUE porte les attaques entre crochets : « Palafin ex [Hero's… ] ».
            // On ancre au début pour ne pas ramener « Dark Palafin » ou « Palafin ex Box ».
            const rx = new RegExp(`^${echapper(String(nomLu).trim())}(\\s*\\[|$)`, 'i');
            totalNom = await Cat.countDocuments({ name: rx });
            // ⚠️ TRI PAR idProduct, ET C'EST VOULU : aucun classement par plausibilité.
            // Trier « du plus probable au moins probable » serait déjà choisir.
            const docsNom = await Cat.find({ name: rx }).sort({ idProduct: 1 }).limit(PLAFOND).lean();
            for (const p of docsNom) {
                const n = await NumeroCarte.findOne({ idProduct: p.idProduct }).lean();
                candidats.push({
                    idProduct: p.idProduct,
                    nom: String(p.name).split('[')[0].trim(),
                    numero: n?.numero || n?.numeroUrl || null,
                    variante: n?.variante || null,
                    slugSet: n?.slugSet || (n?.codeSet ? `code ${n.codeSet}` : null)
                });
            }
        }
        return {
            ok: false, moyen,
            message: `aucun produit ne porte le slug « ${slug} » — rien n'est enregistré`,
            choix: candidats.length ? candidats : undefined,
            indice: `Tu peux répondre par un idProduct NU (le nombre seul) : c'est accepté avant toute recherche par slug.`
                + (nomLu
                    ? (totalNom
                        ? `\n     ${totalNom} produit(s) au catalogue portent le nom lu « ${nomLu} »`
                        + (totalNom > PLAFOND
                            ? `, dont les ${PLAFOND} premiers ci-dessous (tri par idProduct, AUCUN classement par plausibilité).\n`
                            + `     Au-delà du plafond : affine avec le code de set de la carte, ou tape directement l'idProduct.`
                            : ` :`)
                        : `\n     et AUCUN produit du catalogue ne porte le nom lu « ${nomLu} » — vérifie le nom avant l'idProduct.`)
                    : '')
        };
    }
    // Le slug du set, quand l'URL le fournit, lève une éventuelle ambiguïté.
    if (docs.length > 1 && slugSet) {
        const filtres = docs.filter(d => String(d.slugSet || '').toLowerCase() === slugSet.toLowerCase());
        if (filtres.length) docs = filtres;
    }
    if (docs.length === 1) return { ok: true, idProduct: docs[0].idProduct, moyen };

    const choix = [];
    for (const d of docs) {
        const p = await Cat.findOne({ idProduct: d.idProduct }).lean();
        choix.push({ idProduct: d.idProduct, nom: String(p?.name ?? '').split('[')[0].trim(), numero: d.numero || d.numeroUrl || null, variante: d.variante || null, slugSet: d.slugSet || null });
    }
    return { ok: false, moyen, choix, message: `${docs.length} produits portent ce slug` };
}

(async () => {
    const t0 = Date.now();
    while (mongoose.connection.readyState !== 1 && Date.now() - t0 < 30000) await new Promise(r => setTimeout(r, 100));
    const lignes = await CS.find({}, { idExpansion: 1, codeSet: 1, region: 1 }).lean();
    const parExp = new Map(lignes.map(l => [Number(l.idExpansion), l]));

    // ⚠️ ON NUMÉROTE TOUT LE CORPUS, PUIS ON FILTRE. Jamais l'inverse : filtrer d'abord
    // faisait dépendre la clé de la question posée, et c'est ce qui a détaché 32 vérités.
    const docs = (await J.find({}).sort({ le: 1 }).lean());
    // `lignesNumerotees` et non `lignes` : ce dernier nomme déjà les codes de set lus plus
    // haut. Deux `const` du même nom dans une portée est une SyntaxError, donc un fichier
    // qui ne se charge pas — invisible pour toutes les suites, aucune ne le chargeait.
    const { lignes: lignesNumerotees } = numeroter(docs);
    const cartes = lignesNumerotees
        .filter(l => seauVoulu == null || l.seau === seauVoulu)
        .map(l => ({ cle: l.cle, d: l.d, seau: l.seau }));

    const V = lireVerites();
    // ⚠️ « DÉJÀ SAISIE » SE DÉCIDE PAR IDENTITÉ, PAS PAR CLÉ. Une clé positionnelle change
    // dès que la règle des seaux bouge : mesuré à l'instant, l'outil annonçait « 65 à
    // saisir » alors que 24 cartes avaient déjà leur vérité — il les aurait toutes
    // redemandées, et une saisie refaite n'est pas garantie identique à la première.
    // C'est la MÊME cause que les 32 vérités détachées, à un autre endroit : le banc
    // rattachait déjà par identité, cet outil décidait encore par clé.
    const dejaSaisies = new Set(Object.values(V.verites)
        .map(v => v && v.lu ? identiteDe({ nom: v.lu.nom, numero: v.lu.numero, setCode: v.lu.setCode, total: v.lu.total }) : null)
        .filter(Boolean));
    const aFaireComplet = cartes.filter(c => tout || !dejaSaisies.has(identiteDe(c.d)));
    const deja = cartes.length - aFaireComplet.length;
    console.log(`\n${cartes.length} carte(s) ${seauVoulu ? `dans le seau « ${seauVoulu} »` : 'tous seaux confondus'}, ${deja} déjà saisie(s), ${aFaireComplet.length} à saisir.`);

    // Le filtre par clé, APRÈS le compte complet — qui est imprimé ci-dessus quoi qu'il
    // arrive, pour qu'on ne prenne jamais « 1 à saisir » pour l'état réel du seau.
    let aFaire = aFaireComplet;
    if (cleVoulue) {
        aFaire = aFaireComplet.filter(c => c.cle === cleVoulue);
        if (!aFaire.length) {
            // La clé existe-t-elle AILLEURS ? Distinguer « inconnue » de « déjà saisie »
            // est la différence entre une faute de frappe et un travail déjà fait.
            const ailleurs = cartes.find(c => c.cle === cleVoulue);
            const toutesLesCles = lignesNumerotees.find(l => l.cle === cleVoulue);
            console.log(`🔴 --cle=${cleVoulue} ne désigne AUCUNE carte à saisir ici.`);
            if (ailleurs) console.log(`   Elle existe dans ce seau, mais sa vérité est DÉJÀ SAISIE (relance avec --tout pour la corriger).`);
            else if (toutesLesCles) console.log(`   Elle existe, mais dans le seau « ${toutesLesCles.seau} »${seauVoulu ? ` et non « ${seauVoulu} »` : ''}.`);
            else console.log(`   Aucune ligne du banc ne porte cette clé — vérifie la casse et le préfixe (JP / H / V / L).`);
            rl.close(); await mongoose.disconnect(); return;
        }
        console.log(`   -> filtré par --cle=${cleVoulue} : ${aFaire.length} carte(s) demandée(s).`);
    }
    // OÙ elles sont, pour qu'un seau vide ne passe pas pour « rien à faire ».
    const parSeau = new Map();
    for (const c of aFaire) parSeau.set(c.seau, (parSeau.get(c.seau) || 0) + 1);
    for (const [s, n] of [...parSeau.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`   ${String(n).padStart(3)} à saisir dans « ${s} »`);
    }
    console.log('');
    if (!aFaire.length) { rl.close(); await mongoose.disconnect(); return; }

    for (let i = 0; i < aFaire.length; i++) {
        const { cle, d, seau } = aFaire[i];
        console.log('\n' + '═'.repeat(78));
        console.log(`  ${cle}  [${seau}]   (${i + 1}/${aFaire.length})   scanné le ${d.le?.toISOString?.().slice(0, 16)}   build ${d.version ?? '?'}`);
        console.log('═'.repeat(78));
        console.log(`  IMAGE   : ${d.imageUrl ?? '(non enregistrée)'}`);
        console.log(`  ANNONCE : ${d.vintedUrl ?? '(non enregistrée — l\'extension ne l\'envoie pas encore)'}`);
        console.log(`\n  CE QUE L'IA A LU :`);
        console.log(`     nom ......... ${d.nom ?? '—'}${d.nomBrut ? `   (brut : ${d.nomBrut})` : ''}`);
        console.log(`     numéro ...... ${d.numero ?? '—'}        total : ${d.total ?? '—'}`);
        console.log(`     setCode ..... ${d.setCode ?? '—'}        langue : ${d.langue ?? '—'}`);
        console.log(`     rareté ...... ${d.rarete ?? '—'}        symbole : ${d.symboleSet ?? '—'}`);
        console.log(`     confiance du nom : ${d.nomConfiance ?? '—'}`);

        let vuLesCandidats = false;
        // ⚠️ LA LISTE AFFICHÉE FAIT AUTORITÉ POUR « #N », ET ELLE SEULE. La fiche préparée
        // à l'avance porte la même liste (même fonction), mais le catalogue peut s'enrichir
        // entre sa génération et la saisie : un « #3 » qui désignerait un rang d'une liste
        // périmée fabriquerait une vérité fausse en silence. « #N » n'est donc accepté
        // qu'APRÈS que l'outil a imprimé sa propre liste, ici et maintenant.
        let listeAffichee = null;
        let reponse = '';
        while (true) {
            reponse = await demander(
                `\n  La VRAIE carte ? — « #3 » (rang dans la liste) · idProduct · slug · URL Cardmarket` +
                `\n  (« ? » voir les candidats · « aucun » si elle n'est dans AUCUN · « inconnu » · « q » arrêter)\n  > `);
            if (reponse === '?') {
                if (!vuLesCandidats) {
                    vuLesCandidats = true;
                    console.log('\n  ⚠️ Les candidats vont s\'afficher. Ce fait sera enregistré dans la provenance :');
                    console.log('     une vérité saisie APRÈS avoir vu la liste ne vaut pas une vérité saisie à l\'aveugle.');
                }
                listeAffichee = await afficherCandidats(d);
                continue;
            }
            // « #N » : traduit en idProduct AVANT toute autre résolution.
            const m = /^#\s*(\d+)$/.exec(reponse);
            if (m) {
                if (!listeAffichee) {
                    console.log('  ⚠️ « #N » n\'est accepté qu\'après avoir affiché la liste ici (tape « ? »).');
                    console.log('     La fiche préparée peut avoir été générée avant un enrichissement du catalogue :');
                    console.log('     seul le rang que CET outil vient d\'imprimer désigne à coup sûr la bonne carte.');
                    continue;
                }
                const choix = listeAffichee.find(x => x.rang === Number(m[1]));
                if (!choix) { console.log(`  ⚠️ il n'y a pas de rang ${m[1]} dans la liste affichée.`); continue; }
                console.log(`  #${choix.rang} -> ${choix.idProduct} « ${choix.nom} » [${choix.codeSet ?? '?'}] n°${choix.numero ?? '—'}`);
                reponse = String(choix.idProduct);
            }
            break;
        }
        if (reponse.toLowerCase() === 'q') { console.log('\n  Arrêt demandé. Ce qui a été saisi est conservé.'); break; }

        const V2 = lireVerites();
        // ⚠️ « AUCUN DE CEUX-LÀ » N'EST PAS « INCONNU », ET LES CONFONDRE PERDRAIT LA SEULE
        // MESURE QUI COMPTE ICI. « inconnu » dit « je n'ai pas su reconnaître la carte » —
        // c'est une limite du testeur. « aucun » dit « je l'ai reconnue, et elle n'est dans
        // AUCUN candidat que la chaîne propose » — c'est un DÉFAUT DE PÉRIMÈTRE, mesurable,
        // et c'est exactement ce que le vivier par le nom rate. Se rabattre sur un candidat
        // approchant pour « avoir une réponse » fabriquerait une vérité fausse ET effacerait
        // le défaut du même coup.
        if (reponse.toLowerCase() === 'aucun') {
            V2.verites[cle] = {
                idProduct: 'hors-perimetre',
                source: 'defaut-perimetre',
                moyen: 'aucun-candidat-plausible',
                // Ce que la chaîne proposait au moment du constat : sans ça, on saurait
                // qu'elle a raté la carte sans savoir ce qu'elle offrait à la place.
                candidatsVus: listeAffichee ? listeAffichee.length : null,
                lu: { nom: d.nom, numero: d.numero, total: d.total, setCode: d.setCode },
                saisiLe: new Date().toISOString()
            };
            console.log('  -> marqué « hors périmètre ». EXCLUE du taux, et COMPTÉE comme défaut de vivier.');
            ecrireVerites(V2);
            continue;
        }
        if (reponse.toLowerCase() === 'inconnu' || reponse === '') {
            V2.verites[cle] = {
                idProduct: 'inconnu',
                source: vuLesCandidats ? 'inconnu-apres-candidats' : 'inconnu-a-l-aveugle',
                moyen: 'inconnu',
                lu: { nom: d.nom, numero: d.numero, total: d.total, setCode: d.setCode },
                saisiLe: new Date().toISOString()
            };
            console.log('  -> marqué « inconnu ». Cette ligne sera EXCLUE du calcul, jamais comptée juste.');
        } else {
            const r = await resoudreSaisie(reponse, Cat, d.nom);
            if (!r.ok) {
                console.log(`  ⚠️ ${r.message} — RIEN n'a été enregistré, on repassera sur cette carte.`);
                // Le refus NOMME LA SORTIE quand il en connaît une (slug introuvable) ; sinon
                // c'est l'ambiguïté de variante, qui a sa propre phrase.
                if (r.indice) console.log(`     ${r.indice}`);
                if (r.choix) {
                    // On MONTRE les variantes et on ne choisit pas : trancher à la place du
                    // testeur remettrait le jugement de la chaîne dans la vérité censée la juger.
                    if (!r.indice) console.log('     Retape la réponse avec l\'idProduct de la bonne variante :');
                    for (const c of r.choix) {
                        console.log(`       ${String(c.idProduct).padEnd(8)} n°${String(c.numero ?? '—').padEnd(6)} variante ${String(c.variante ?? '—').padEnd(4)} [${c.slugSet ?? '?'}]  ${c.nom}`);
                    }
                }
                continue;
            }
            const p = await Cat.findOne({ idProduct: r.idProduct }).lean();
            if (!p) { console.log(`  ⚠️ aucun produit ${r.idProduct} au catalogue — rien n'a été enregistré.`); continue; }

            // ════════════════════════════════════════════════════════════════════
            // LES DEUX CONTRÔLES DE COLLAGE — une URL tapée pour la mauvaise carte
            // ════════════════════════════════════════════════════════════════════
            // L'OCCURRENCE, LE 2026-09-08. Deux vérités ont reçu l'URL de la carte
            // précédente : « Berry » a pris celle de Pokémon March (06/09), « Tyranitar »
            // celle de Rocket's Minefield Gym (08/09). Rien ne l'a signalé. Une vérité
            // fausse ne se voit pas — elle compte, en silence, dans toutes les mesures qui
            // suivent, et celle de Berry a transformé un juste en FAUX pendant deux jours.
            //
            // ⚠️ AUCUN DES DEUX NE REFUSE : ils DEMANDENT. Un nom lu peut légitimement ne
            // pas recouper le nom catalogue — l'IA lit « The Rocket's Trap » sur ce qui est
            // « Imposter Oak's Revenge », et cette vérité-là est bonne. Refuser
            // fabriquerait des trous ; c'est le testeur qui tranche, on lui montre.
            const nomCatalogue = String(p.name).split('[')[0].trim();
            const motsDe = s => new Set(String(s).toLowerCase()
                .replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(m => m.length > 2));
            const motsLus = motsDe(d.nom), motsCat = motsDe(nomCatalogue);
            const recoupe = [...motsLus].some(m => motsCat.has(m));

            // 1. COLLISION — cet idProduct est-il DÉJÀ la vérité d'une autre carte ? C'est
            //    le contrôle le moins cher : le fichier est relu à chaque entrée de toute
            //    façon. Il attrape les deux cas du 08/09.
            const identiteIci = identiteDe(d);
            const collision = Object.entries(V2.verites).find(([, v]) =>
                v && v.idProduct === r.idProduct && v.lu && identiteDe(v.lu) !== identiteIci);

            // 2. LE NOM — plus fort que la collision : il attrape aussi la mauvaise URL
            //    d'une carte que personne d'autre n'a saisie, cas que la collision ne voit
            //    pas. `d.nom` est le nom NORMALISÉ de la chaîne, pas le brut de l'IA.
            if (collision || (motsLus.size && motsCat.size && !recoupe)) {
                console.log('');
                if (collision) {
                    console.log(`  🔴 COLLISION : ${r.idProduct} est DÉJÀ la vérité de « ${collision[1].lu.nom} » (clé ${collision[0]}).`);
                    console.log(`     Deux cartes différentes ne peuvent pas être le même produit.`);
                }
                if (motsLus.size && motsCat.size && !recoupe) {
                    console.log(`  🔴 NOMS SANS AUCUN MOT COMMUN :`);
                    console.log(`     la chaîne a lu ... « ${d.nom} »`);
                    console.log(`     ce produit est ... « ${nomCatalogue} »`);
                }
                const ok = (await demander('  Garder quand même cette vérité ? (oui / autre = rien enregistré) : ')).toLowerCase();
                if (ok !== 'oui' && ok !== 'o') {
                    console.log('  -> RIEN n\'a été enregistré, on repassera sur cette carte.');
                    continue;
                }
            }

            const cs = parExp.get(Number(p.idExpansion));
            console.log(`  -> ${p.idProduct} « ${nomCatalogue} » [${cs?.codeSet ?? '?'} / ${cs?.region ?? 'INCONNUE'}]   (désigné par ${r.moyen})`);
            V2.verites[cle] = {
                idProduct: r.idProduct,
                nom: nomCatalogue,
                codeSet: cs?.codeSet ?? null,
                // DEUX PROVENANCES DISTINCTES, parce qu'elles répondent à deux questions
                // différentes le jour où une vérité se révèle fausse : ai-je été influencé
                // par la liste des candidats, et par quel chemin la vérité est-elle entrée ?
                source: vuLesCandidats ? 'saisie-apres-candidats' : 'saisie-a-l-aveugle',
                moyen: r.moyen,          // 'idProduct' | 'slug' | 'url'
                saisieBrute: reponse,    // ce qui a été tapé, tel quel
                lu: { nom: d.nom, numero: d.numero, total: d.total, setCode: d.setCode },
                saisiLe: new Date().toISOString()
            };
        }
        ecrireVerites(V2);
    }

    const V3 = lireVerites();
    const n = Object.keys(V3.verites).length;
    const aveugle = Object.values(V3.verites).filter(v => String(v.source).includes('aveugle')).length;
    const parMoyen = new Map();
    for (const v of Object.values(V3.verites)) parMoyen.set(v.moyen ?? '?', (parMoyen.get(v.moyen ?? '?') || 0) + 1);
    console.log(`\n${SORTIE} : ${n} vérité(s) enregistrée(s), dont ${aveugle} à l'aveugle et ${n - aveugle} après avoir vu les candidats.`);
    console.log(`   par moyen de désignation : ${[...parMoyen.entries()].map(([k, v]) => `${k}=${v}`).join('  ')}`);
    rl.close();
    await mongoose.disconnect();
})().catch(async e => { console.error('ERREUR', e.message, e.stack); rl.close(); try { await mongoose.disconnect(); } catch (_) { } process.exit(1); });

/**
 * Les candidats, à la demande seulement, NUMÉROTÉS pour être désignables par « #N ».
 *
 * La liste vient de `candidats-fiche.js` — la même que celle de la fiche préparée. Elle
 * est PAR PRIX CROISSANT et non par score : l'ordre du scoring désignerait un favori.
 *
 * @returns {Promise<object[]>} la liste affichée, qui fait autorité pour « #N »
 */
async function afficherCandidats(d) {
    const { total, liste, retenu, aucun } = await construireCandidats(d);
    if (aucun) { console.log('\n     (aucun candidat par le nom — réponds « aucun »)'); return []; }
    console.log(`\n     ${total} candidat(s) — les ${liste.length} premiers, PAR PRIX (pas par score : l'ordre du scoring désignerait un favori)`);
    for (const c of liste) {
        console.log(`     #${String(c.rang).padEnd(3)} ${String(c.idProduct).padEnd(8)} ${String(c.codeSet ?? '?').padEnd(9)} ` +
            `n°${String(c.numero ?? '—').padEnd(6)} ${String(c.prix ?? '—').padStart(8)} €  ${c.nom}`);
        console.log(`          ${c.nomSet ?? '(set inconnu)'}${c.variante ? `  ·  variante ${c.variante}` : ''}`);
    }
    // ⚠️ EN DERNIER, ET NOMMÉ. Le montrer en tête ferait de lui la réponse par défaut :
    // le banc mesurerait l'accord du testeur avec la chaîne, pas la vérité. Il n'a pas de
    // rang — on ne peut pas le choisir par « #N » sans avoir lu ce qu'il est.
    if (retenu) {
        console.log(`\n     ── ce que la PRODUCTION avait retenu (à ne regarder qu'après avoir décidé) ──`);
        console.log(`        ${retenu.idProduct}  ${retenu.codeSet ?? '?'}  n°${retenu.numero ?? '—'}  ${retenu.prix ?? '—'} €  ${retenu.nom}`);
        console.log(`        ${retenu.nomSet ?? '(set inconnu)'}   -> pour le désigner, tape son idProduct`);
    }
    return liste;
}
