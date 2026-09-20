// ============================================================
// LES SYMBOLES DE SETS — `sets.symbole = { cleR2, w, h }`, par une CONVENTION lue, pas devinée
// ============================================================
//   node collecter-symboles-sets.js              (décide et imprime, rien d'écrit — le défaut)
//   node collecter-symboles-sets.js --verifier   (vérifie l'existence des fichiers par imageinfo, sans écrire)
//   node collecter-symboles-sets.js --ecrire     (verrou global, télécharge, écrit)
//
// 🔑 OÙ VIT LE FICHIER DU SYMBOLE — la question a été posée le 2026-09-19 et la réponse était : NULLE PART.
// `setsymbol` est un BOOLÉEN (376 « yes », 22 « no ») et **aucun des 447 wikitexts de sets ne cite un
// fichier de symbole** ; les pages de cartes non plus. Le nom n'est donc pas écrit : il est CALCULÉ.
// `Template:TCGExpansionInfobox`, lu le 2026-09-20 (une requête), le construit ainsi :
//     [[File:SetSymbol{{{alt|{{{setname|Base Set}}}}}}.png|{{{symbolsize|30px}}}]]
// → **SetSymbol<alt, à défaut setname>.png**, et `alt`/`setname` sont des paramètres d'infobox déjà
// archivés chez nous. Ce n'est plus « un fichier cité quelque part » mais une CONVENTION, et la règle
// du testeur (« seulement si le fichier porte EXACTEMENT le nom du set ») devient vérifiable.
//
// 🔴 LE PIÈGE DE LA LANGUE EST LE MÊME QUE POUR LES LOGOS, ET J'Y SUIS TOMBÉ AVANT DE LE FERMER.
// Bulbapedia fusionne un set japonais et son jumeau occidental sur UNE page, dont l'infobox porte le nom
// OCCIDENTAL. Une première mesure comparait le nom calculé à `nomEn` : elle retenait **125 sets japonais**,
// dont `Rocket Gang → SetSymbolTeam Rocket.png`. Le chiffre était impossible et c'est lui qui a arrêté la
// mesure. Deuxième version, sans `nomEn` : 25 japonais — et **sept passaient encore par le jumeau** par
// `nomJa`/`nomJaTraduit` (« Pokémon Card 151 » → `SetSymbol151.png`, « Collection X » → `SetSymbolXY.png`).
// La règle finale est donc NÉGATIVE autant que positive : le nom calculé doit être un nom de CE set **et
// ne pas être aussi celui du jumeau**. Un nom qui désigne les deux n'en désigne aucun.
require('dotenv').config();
const crypto = require('crypto');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { modeles } = require('./collecte-cartes/schemas');
const r2 = require('./collecte-cartes/r2');
const bulba = require('./collecte-cartes/bulba');
const { gabarits } = require('./collecte-cartes/wikitext');
const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');

const cle = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const cleObjet = f => `bulbapedia/symboles/${cle(f)}.png`;
const VERROU_MS = 3 * 60 * 1000, ATTENTE_MS = 2 * 1000;

/** Le nom du set tel que le gabarit le calculera, ou null avec le motif du refus. */
function deciderSymbole(s, box) {
    const sym = String(box.params.setsymbol ?? '').trim().toLowerCase();
    if (sym === 'no') return { ok: false, motif: '`setsymbol = no` : la source dit qu\'il n\'y a pas de symbole' };
    const nom = String(box.params.alt ?? box.params.setname ?? '').trim();
    if (!nom) return { ok: false, motif: 'ni `alt` ni `setname` dans l\'infobox — le gabarit retomberait sur « Base Set »' };
    // ⚠️ Un `setname` qui contient du wikitext (`{{tt|…}}`, `<br>`, `<small>`) n'est pas un nom de fichier :
    // le gabarit le rendrait tel quel et le lien serait cassé. On refuse plutôt que de nettoyer — nettoyer,
    // c'est fabriquer un nom que la source n'a pas.
    if (/[{}<>|\[\]]/.test(nom)) return { ok: false, motif: `le nom calculé contient du wikitext (« ${nom.slice(0, 40)}… ») : ce n'est pas un nom de fichier` };
    const jumeau = s.region === 'intl' ? null : cle(s.nomEn);
    if (jumeau && cle(nom) === jumeau) return { ok: false, motif: `« ${nom} » est le nom du jumeau occidental : la page est fusionnée, le symbole serait celui de l'autre set` };
    const miens = (s.region === 'intl'
        ? [['nomAffichage', s.nomAffichage], ['nomEn', s.nomEn], ['bulba.expansion', s.bulba?.expansion]]
        : [['nomAffichage', s.nomAffichage], ['nomJaTraduit', s.nomJaTraduit], ['nomJa', s.nomJa], ['bulba.expansion', s.bulba?.expansion]])
        .filter(([, v]) => v);
    const trouve = miens.find(([, v]) => cle(v) === cle(nom));
    if (!trouve) return { ok: false, motif: `« ${nom} » n'est aucun des noms de ce set (${miens.map(([k]) => k).join(', ')})` };
    return { ok: true, nom, fichier: `SetSymbol${nom}.png`, preuve: `le gabarit calcule « SetSymbol${nom}.png » depuis \`${box.params.alt ? 'alt' : 'setname'}\`, et « ${nom} » est le ${trouve[0]} de ce set${jumeau ? ` (≠ le jumeau « ${s.nomEn} »)` : ''}` };
}

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const verifier = process.argv.includes('--verifier') || ecrire;
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_IMAGES'] });
    const M = modeles(cx);
    await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
    await r2.verifierBucket(process.env.R2_BUCKET_IMAGES);

    const sets = await cx.db.collection('sets').find({}, { projection: { code: 1, region: 1, nomAffichage: 1, nomEn: 1, nomJa: 1, nomJaTraduit: 1, bulba: 1, symbole: 1 } }).toArray();
    const avecArchive = sets.filter(s => s.bulba?.cleR2);
    console.log(`\n════ DÉNOMINATEUR : ${sets.length} sets · ${avecArchive.length} ont leur page archivée (${sets.length - avecArchive.length} sans : rien à lire) ════`);

    const retenus = [], refuses = [];
    for (const s of avecArchive) {
        let txt; try { txt = await r2.lireTexte(process.env.R2_BUCKET_BRUT, s.bulba.cleR2); } catch { refuses.push({ s, motif: 'page illisible sur R2' }); continue; }
        const box = gabarits(txt).find(g => /infobox/i.test(g.nom));
        if (!box) { refuses.push({ s, motif: 'aucune infobox' }); continue; }
        const d = deciderSymbole(s, box);
        (d.ok ? retenus : refuses).push({ s, ...d });
    }
    const parMotif = {};
    for (const r of refuses) parMotif[String(r.motif).replace(/«[^»]*»/g, '…')] = (parMotif[String(r.motif).replace(/«[^»]*»/g, '…')] || 0) + 1;
    console.log(`   ✅ RETENUS : ${retenus.length}  (occidentaux ${retenus.filter(r => r.s.region === 'intl').length} · japonais ${retenus.filter(r => r.s.region !== 'intl').length})`);
    console.log(`   🔴 REFUSÉS : ${refuses.length}`);
    for (const [k, v] of Object.entries(parMotif).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`      ${String(v).padStart(4)} — ${k}`);
    const fichiers = [...new Set(retenus.map(r => r.fichier))];
    console.log(`\n   ${retenus.length} sets pour ${fichiers.length} fichiers distincts`);
    console.log(`   TOUS LES JAPONAIS RETENUS (c'est là que le jumeau se cache — ils se relisent un par un) :`);
    for (const r of retenus.filter(x => x.s.region !== 'intl'))
        console.log(`      ${String(r.s.code).padEnd(9)} « ${String(r.s.nomAffichage).slice(0, 30).padEnd(30)} » jumeau « ${String(r.s.nomEn ?? '—').slice(0, 22).padEnd(22)} » → ${r.fichier}`);
    if (!verifier) { console.log(`\n   (décision seule — --verifier pour éprouver les noms, --ecrire pour collecter)`); await fermer(); return; }

    // ---- la vérification : le nom calculé existe-t-il vraiment ? ----
    // ⚠️ AVANT DE COLLECTER, PAS APRÈS. Un nom calculé qui rend 404 sur la moitié des sets se verrait
    // tard, et il coûterait 150 requêtes chez un tiers pour l'apprendre. `imageinfo` répond par lots.
    let arret = false;
    const verrou = fabriquerVerrou({ Modele: M.EtatImages, id: 'bulbapedia/__collecteur__', dureeMs: VERROU_MS, surInsertion: { phase: 'symboles' }, surPerte: () => { arret = true; }, nom: 'verrou global bulbapedia (symboles)' });
    for (let essai = 0; ; essai++) {
        const tenu = await verrou.prendre();
        if (!tenu) { if (essai) console.log(`   verrou obtenu au bout de ${essai} essais.`); break; }
        if (essai === 0) console.log(`⏳ verrou global tenu par pid ${tenu.pid} sur ${tenu.hote} — j'attends.`);
        await new Promise(r => setTimeout(r, ATTENTE_MS));
    }
    console.log(`🔒 verrou global pris.`);
    try {
        const infos = await bulba.imageinfoDe(fichiers.map(f => `File:${f}`));
        const existants = fichiers.filter(f => infos.get(`File:${f}`)?.url);
        const absents = fichiers.filter(f => !infos.get(`File:${f}`)?.url);
        console.log(`\n   🔍 VÉRIFICATION DES NOMS CALCULÉS : ${existants.length}/${fichiers.length} existent chez Bulbapedia (${(existants.length / fichiers.length * 100).toFixed(1)} %)`);
        if (absents.length) { console.log(`   🔴 ${absents.length} nom(s) calculé(s) sans fichier — la convention ne couvre pas ces sets :`); for (const f of absents.slice(0, 20)) console.log(`      ${f}`); }
        if (!ecrire) { console.log(`\n   (vérification seule — relancer avec --ecrire)`); return; }

        let n = 0, sans = 0;
        const objets = new Map();
        for (const f of fichiers) {
            if (arret) break;
            const info = infos.get(`File:${f}`);
            if (!info?.url) { sans++; continue; }
            const co = cleObjet(f);
            if (!await r2.existe(process.env.R2_BUCKET_IMAGES, co)) {
                const { buffer } = await bulba.telecharger(info.url);
                const sha1 = crypto.createHash('sha1').update(buffer).digest('hex');
                if (info.sha1 && sha1 !== info.sha1) { console.warn(`   ⚠️ ${f} : sha1 ≠ imageinfo — non déposé`); sans++; continue; }
                await r2.deposerBinaire(process.env.R2_BUCKET_IMAGES, co, buffer, info.mime || 'image/png');
            }
            objets.set(f, { cleR2: co, w: info.width ?? null, h: info.height ?? null, urlOriginal: info.url, sha1: info.sha1 ?? null });
            n++;
        }
        let ecrits = 0;
        for (const r of retenus) {
            const o = objets.get(r.fichier);
            if (!o) continue;
            await cx.db.collection('sets').updateOne({ _id: r.s._id }, { $set: { symbole: { ...o, fichier: r.fichier, source: 'bulbapedia:convention-infobox', preuve: r.preuve, le: new Date() } } });
            ecrits++;
        }
        const relu = await cx.db.collection('sets').countDocuments({ 'symbole.cleR2': { $nin: [null, ''] } });
        console.log(`\n   TÉLÉCHARGÉS : ${n} fichiers (${sans} sans fichier) · ÉCRITS : ${ecrits} sets · relu en base : ${relu} sets portent un symbole`);
    } finally { await verrou.rendre(); console.log(`🔓 verrou rendu.`); await fermer(); }
})().catch(e => { console.error(e); process.exit(1); });
