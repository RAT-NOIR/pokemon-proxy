// ============================================================
// LA TABLE ÉTENDUE DES LOGOS COMPOSÉS — un set par ligne, ÉNUMÉRÉ (collecte-cartes/logos-composes-etendus.json)
// ============================================================
//   node generer-logos-composes-etendus.js            (la table, imprimée ; rien d'écrit)
//   node generer-logos-composes-etendus.js --ecrire   (écrit le JSON — un fichier du dépôt, relu au commit ; aucune base touchée)
//
// LA DEMANDE (testeur, 2026-10-06) : « logos composés : fais-les pour les 271 sets sans logo officiel (logo de la série parente + étiquette
// Rat-Market, promos à étoile noire, POP Série N, McDonald's Promo + année), marqués « logo composé » ». La table à la main
// (logo-compose.js, COMPOSITIONS) couvre POP, Battle Academy, McDonald's et les séries promos ; celle-ci couvre le RESTE, set par set.
// LES RÈGLES, et pourquoi elles sont celles-ci :
//   · un logo de SÉRIE est anglais : il ne va que sur un set OCCIDENTAL dont la série parente est CERTAINE par le nom du set (les Trainer
//     Kits « XY », « BW », « HS », « DP », « SM », « EX » ; les Énergies Méga-Évolution et Écarlate et Violet ; Celebrations, de la série
//     Épée et Bouclier). Le set de tête de la série porte un logo « set occidental » (vérifié par planifier()).
//   · un set d'un autre tirage (japonais, chinois, indonésien, thaï) reçoit l'ÉTIQUETTE SEULE — la règle de langue des logos interdit le
//     logo anglais de la série (comme pour Battle Academy japonais, planche validée le 2026-10-04) : son nom, et son tirage en sous-titre.
//     La série (l'ère) n'y est PAS écrite : la date d'un set japonais en base est parfois celle de son jumeau occidental (EC1 : 15 sept. 2002),
//     et un sous-titre faux serait un mensonge affiché.
//   · McDonald's : le logo McDonald's Collection et « Promo » + l'année (les deux de 2018 se distinguent par le mois de leur date en base).
//   · une série promo d'un autre tirage : l'étoile et « PROMOS », comme M-P-Traditional-Chinese-Promos.
//   · WCD : « WCD <année> », « Championnats du monde » ; aucun logo commun n'existe chez une source autorisée.
// Un set qui a déjà un logo propre, un logoFr ou un logoCompose n'est pas listé (planifier() le garderait de toute façon).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const M = require('./collecte-cartes/logo-compose');
const AUTORISES = [/^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --ecrire`); process.exit(2); }
const FICHIER = path.join(__dirname, 'collecte-cartes', 'logos-composes-etendus.json');

// ⚠️ (relecture) PAS EX-Trainer-Kit : le logo du set de tête de l'ère EX est « EX Ruby & Sapphire », le nom d'UN set — sur le kit, il
// dirait un set qui n'est pas le sien. Ici, le logo de tête porte le nom de la SÉRIE (Diamond & Pearl, Black & White, XY, Sun & Moon…).
const SERIES = {
    'DP-Trainer-Kit': ['Diamond-Pearl', 'Kit du Dresseur'],
    'HS-Trainer-Kit': ['HeartGold-SoulSilver', 'Kit du Dresseur'], 'BW-Trainer-Kit': ['Black-White', 'Kit du Dresseur'],
    'XY-Trainer-Kit': ['XY', 'Kit du Dresseur'], 'XY-Trainer-Kit-Bisharp-Wigglytuff': ['XY', 'Kit du Dresseur', 'Bisharp & Wigglytuff'],
    'XY-Trainer-Kit-Latias-Latios': ['XY', 'Kit du Dresseur', 'Latias & Latios'], 'XY-Trainer-Kit-Pikachu-Libre-Suicune': ['XY', 'Kit du Dresseur', 'Pikachu Libre & Suicune'],
    'SM-Trainer-Kit-Lycanroc-Alolan-Raichu': ['Sun-Moon', 'Kit du Dresseur', 'Lycanroc & Alolan Raichu'],
    'SM-Trainer-Kit-Alolan-Sandslash-Alolan-Ninetales': ['Sun-Moon', 'Kit du Dresseur', 'Alolan Sandslash & Alolan Ninetales'],
    'Mega-Evolution-Energies': ['Mega-Evolution', 'Énergies'], 'Scarlet-Violet-Energies': ['Scarlet-Violet', 'Énergies'],
    'Celebrations': ['Sword-Shield', 'Celebrations']
};
const SOUS_TIRAGE = { jp: 'Japon', 'zh-hans': 'Chine · simplifié', 'zh-hant': 'Chine · traditionnel', idth: 'Indonésie · Thaïlande', id: 'Indonésie', th: 'Thaïlande' };
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ buckets: [] });
    const sets = await cx.db.collection('sets').find({}, { projection: { nomAffichage: 1, region: 1, tirage: 1, logo: 1, logoFr: 1, logoCompose: 1, 'bulba.pageid': 1, dateSortieEn: 1 } }).toArray();
    if (!sets.length) throw new Error('collection sets vide : base fausse');
    const gen = M.generiquesDe(sets);
    const img = x => !!x && typeof x.cleR2 === 'string' && x.cleR2.length > 0;
    const propre = x => img(x) && x.logoGenerique !== true && !(x.sha1 && gen.has(String(x.sha1).toLowerCase()));
    // UNE RÉGÉNÉRATION AJOUTE, ELLE NE RETIRE RIEN (§59) : les lignes déjà dans le fichier restent telles quelles (un set composé depuis
    // n'est plus « sans logo », mais sa ligne dit comment il l'a été) ; seuls la table à la main et les sets déjà listés sont exclus.
    const existantes = fs.existsSync(FICHIER) ? JSON.parse(fs.readFileSync(FICHIER, 'utf8')).compositions : {};
    const cibles = sets.filter(s => typeof s.nomAffichage === 'string' && s.nomAffichage && !propre(s.logo) && !propre(s.logoFr) && !img(s.logoCompose) && !M.A_LA_MAIN[s._id] && !existantes[s._id]);
    const table = { ...existantes }, refus = [];
    console.log(`lignes déjà dans le fichier, gardées telles quelles : ${Object.keys(existantes).length}`);
    for (const s of cibles.sort((a, b) => a._id.localeCompare(b._id))) {
        const tirage = s.tirage ?? s.region, nom = s.nomAffichage.trim();
        let c = null;
        if (SERIES[s._id]) { const [tete, etiquette, sous] = SERIES[s._id]; c = { famille: 'serie', logo: { serie: tete }, etiquette, ...(sous ? { sous } : {}) }; }
        else if (/^McDonald-?s-Collection-/.test(s._id)) {
            const d = s.dateSortieEn ? new Date(s.dateSortieEn) : null;
            if (!d || isNaN(d)) { refus.push(`${s._id} : McDonald's sans date en base — l'année ne se devine pas`); continue; }
            // (relecture) l'année du slug, quand il en porte une, recoupe celle de la date : un désaccord refuse
            const anSlug = (/-(\d{4})(?:-|$)/.exec(s._id) || [])[1];
            if (anSlug && Number(anSlug) !== d.getUTCFullYear()) { refus.push(`${s._id} : année du slug ${anSlug} ≠ date ${d.getUTCFullYear()}`); continue; }
            const sous = s._id.includes('25th') ? '25e anniversaire' : s._id.includes('2018') ? `${MOIS[d.getUTCMonth()]} 2018` : null;
            c = { famille: 'mcdonalds', logo: { source: 'mcdonalds' }, etiquette: `Promo ${d.getUTCFullYear()}`, ...(sous ? { sous } : {}) };
        }
        else if (/^WCD-\d{4}$/.test(s._id)) c = { famille: 'wcd', logo: null, etiquette: `WCD ${s._id.slice(4)}`, sous: 'Championnats du monde' };
        else if (/-Promos$/.test(s._id) && tirage !== 'intl') {
            // la forme des séries promos déjà validées : « Méga-Évolution · chinois traditionnel »
            const langue = { 'zh-hans': 'chinois simplifié', 'zh-hant': 'chinois traditionnel', id: 'indonésien', th: 'thaï' }[tirage];
            const serie = /^M-P/.test(s._id) ? 'Méga-Évolution' : /^Scarlet-Violet/.test(s._id) ? 'Écarlate et Violet' : null;
            if (!langue || !serie) { refus.push(`${s._id} : série promo « ${tirage} » sans série ou langue connue`); continue; }
            c = { famille: 'promos', logo: null, etoile: true, etiquette: 'PROMOS', sous: `${serie} · ${langue}` };
        }
        else if (tirage === 'intl') c = { famille: 'etiquette', logo: null, etiquette: nom };
        else if (SOUS_TIRAGE[tirage]) c = { famille: 'etiquette', logo: null, etiquette: nom.replace(/ IDTH$/, ''), sous: SOUS_TIRAGE[tirage] };
        else { refus.push(`${s._id} : tirage « ${tirage} » sans sous-titre connu`); continue; }
        table[s._id] = c;
    }
    const plan = Object.entries(table).map(([slug, c]) => ({ slug, ...c, action: 'ecrire', logoCle: c.logo?.serie ? `serie:${c.logo.serie}` : c.logo?.source ? `source:${c.logo.source}` : null }));
    const toutes = [...plan, ...Object.entries(M.A_LA_MAIN).map(([slug, c]) => ({ slug, ...c, action: 'ecrire', logoCle: c.logo?.serie ? `serie:${c.logo.serie}` : c.logo?.source ? `source:${c.logo.source}` : null }))];
    const col = M.collisions(toutes);
    const familles = {}; for (const c of Object.values(table)) familles[c.famille] = (familles[c.famille] || 0) + 1;
    console.log(`DÉNOMINATEUR : ${sets.length} sets · ${cibles.length} publiés sans logo propre hors table à la main · ${Object.keys(table).length} dans la table étendue · refus ${refus.length} · familles ${JSON.stringify(familles)}`);
    for (const [slug, c] of Object.entries(table)) console.log(`   ${c.famille.padEnd(9)} ${slug.padEnd(52)} ${c.logo?.serie ? `[${c.logo.serie}] ` : c.logo?.source ? `[${c.logo.source}] ` : ''}${c.etoile ? '★ ' : ''}« ${c.etiquette} »${c.sous ? ` / « ${c.sous} »` : ''}`);
    for (const r of refus) console.log(`   🔴 ${r}`);
    if (col.length) { console.error(`🔴 collisions (deux sets composeraient le même logo) : ${JSON.stringify(col)}`); await fermer(); process.exit(1); }
    if (process.argv.includes('--ecrire') && JSON.stringify(table) === JSON.stringify(existantes)) console.log('rien de neuf : le fichier n\'est pas réécrit');
    else if (process.argv.includes('--ecrire')) {
        fs.writeFileSync(FICHIER, JSON.stringify({ genere: new Date().toISOString(), par: 'generer-logos-composes-etendus.js', regle: 'voir l\'en-tête du générateur', compositions: table }, null, 1) + '\n');
        console.log(`✅ écrit : ${FICHIER} (${Object.keys(table).length} sets)`);
    } else console.log('(table seule — --ecrire écrit le JSON)');
    await fermer();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
