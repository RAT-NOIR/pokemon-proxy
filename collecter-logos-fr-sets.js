// ============================================================
// LES LOGOS FRANÇAIS DES SETS — `sets.logoFr`, depuis TCGdex, avec leur preuve
// ============================================================
//   node collecter-logos-fr-sets.js            (mesure seule, c'est le défaut)
//   node collecter-logos-fr-sets.js --ecrire
//
// 🔑 POURQUOI PAS BULBAPEDIA, ET POURQUOI CE N'EST PAS UN ÉCHEC. L'archive a été fouillée : aucun
// paramètre `frlogo`, aucun suffixe FR sur `setlogo`, et les 12 pages contenant « French » sont des
// PUBLICITÉS DE MAGAZINE (`TCG set Team Rocket French Ad.jpg`). La voie de l'archive est morte, et
// c'est un CONSTAT ÉNUMÉRÉ, pas une requête qui n'a rien trouvé (§30).
//
// ✅ LA VOIE VIVANTE EST AILLEURS : TCGdex sert ses images par LANGUE — `/fr/…/logo.png` et
// `/en/…/logo.png` sont deux chemins distincts. ⚠️ Et deux chemins distincts NE PROUVENT RIEN : un
// CDN sert très bien le même octet sous deux adresses. Vérifié avant d'y croire, par SHA-256 sur
// 8 sets : **8 images différentes sur 8**, tailles différentes (BRS 54 Ko contre 176 Ko, CRZ 17 contre
// 70). Et sur SVI comme TEF, c'est la version ANGLAISE qui manque — le français est parfois le plus complet.
//
// ⚠️ LA RÉSERVE DE MARQUE EST ÉCRITE ET ASSUMÉE. Les données de TCGdex sont sous licence ouverte ;
// un logo de set reste une MARQUE, comme les visuels de cartes qu'on sert déjà. Décision du testeur
// du 2026-09-21 : on les affiche en connaissance de cause, comme tout l'écosystème. La même réserve
// vaut pour `sets.logo` (anglais, Bulbapedia) : ce n'est pas une nouveauté de ce champ.
//
// 🔑 L'IDENTITÉ DU SET NE SE REDEVINE PAS : elle est RELUE dans `nomFrPreuve`, où
// `collecter-noms-fr-sets.js` a écrit l'id TCGdex entre crochets. Refaire l'appariement ici, ce
// serait une seconde définition de la même règle, et deux définitions divergent toujours (§21 bis).
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const r2 = require('./collecte-cartes/r2');
const https = require('https');
const crypto = require('crypto');

const getJSON = url => new Promise((ok, ko) => https.get(url, { headers: { 'User-Agent': 'rat-market-catalogue/1.0' } }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { ok(JSON.parse(d)); } catch (e) { ko(e); } });
}).on('error', ko));

// 🔴 UNE CADENCE, PARCE QUE LE PREMIER JET N'EN AVAIT PAS. 270 requêtes d'affilée ont fait répondre
// « no available server » à TCGdex sur 94 sets. Ce n'était pas une panne de leur côté : c'était nous.
// ⚠️ TCGdex ne nous a jamais demandé de cadence — Bulbapedia et artofpkm si (§17). L'absence de
// promesse explicite n'autorise pas à marteler : la limite de débit se compte CHEZ LE DESTINATAIRE,
// et un tiers sans contrat est un tiers qu'on traite au moins aussi bien qu'un tiers sous contrat.
const PAUSE_MS = 300;
const dormir = ms => new Promise(r => setTimeout(r, ms));
// et un réessai unique, à trois secondes : une coupure d'une seconde ne doit pas tuer un lot, mais
// une panne longue doit RESTER une panne, visible — jamais une boucle qui frappe un serveur à terre (§29).
async function avecReessai(fn, quoi) {
    try { return await fn(); }
    catch (e) { await dormir(3000); try { return await fn(); } catch (e2) { throw new Error(`${quoi} : ${String(e2.message).slice(0, 60)}`); } }
}
const octets = url => new Promise((ok, ko) => https.get(url, { headers: { 'User-Agent': 'rat-market-catalogue/1.0' } }, r => {
    if (r.statusCode !== 200) { r.resume(); return ok(null); }
    const cs = []; r.on('data', c => cs.push(c)); r.on('end', () => ok(Buffer.concat(cs)));
}).on('error', ko));

// Les dimensions d'un PNG se lisent dans son en-tête IHDR : octets 16..23. Pas de dépendance, et
// surtout : une dimension LUE vaut mieux qu'une dimension annoncée par une API.
function dimensionsPng(buf) {
    if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return { w: null, h: null };
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_IMAGES'] });
    await r2.verifierBucket(process.env.R2_BUCKET_IMAGES);

    const sets = await cx.db.collection('sets').find({ nomFr: { $nin: [null, ''] } },
        { projection: { code: 1, nomFr: 1, nomFrSource: 1, nomFrPreuve: 1, logo: 1, logoFr: 1 } }).toArray();
    console.log(`\n════ DÉNOMINATEUR : ${sets.length} sets portent un nomFr · ${sets.filter(s => s.logo?.cleR2).length} ont déjà un logo anglais ════`);

    // l'id TCGdex, RELU de la preuve — jamais réapparié
    const cibles = [];
    for (const s of sets) {
        const id = (String(s.nomFrPreuve || '').match(/TCGdex \[([^\]]+)\]/) || [])[1];
        if (!id) { console.log(`   ⚠️ ${s.code} : pas d'id TCGdex dans la preuve, ignoré`); continue; }
        cibles.push({ s, id });
    }
    console.log(`   id TCGdex relu depuis nomFrPreuve : ${cibles.length}`);
    if (!ecrire) console.log(`   (mesure seule — relancer avec --ecrire)`);

    let avec = 0, sansLogo = 0, echecs = 0, ecrits = 0, dejaLa = 0, identiques = 0;
    const refus = [];
    for (const { s, id } of cibles) {
        // REPRISE : un set qui porte déjà son logoFr ne se redemande pas. Un outil qui refait tout à
        // chaque lancement est un outil qu'on n'ose pas relancer — et c'est ce qui l'a fait échouer.
        if (ecrire && s.logoFr?.cleR2) { dejaLa++; avec++; continue; }
        await dormir(PAUSE_MS);
        let d; try { d = await avecReessai(() => getJSON(`https://api.tcgdex.net/v2/fr/sets/${encodeURIComponent(id)}`), 'API'); }
        catch (e) { echecs++; refus.push(`${s.code} : ${e.message}`); continue; }
        if (!d?.logo) { sansLogo++; refus.push(`${s.code} : TCGdex [${id}] ne porte pas de logo français`); continue; }
        const url = `${d.logo}.png`;
        const cleObjet = `tcgdex/logos-fr/${id.replace(/[^A-Za-z0-9._-]/g, '_')}.png`;
        if (!ecrire) { avec++; continue; }

        await dormir(PAUSE_MS);
        let buf; try { buf = await avecReessai(() => octets(url), 'téléchargement'); } catch { buf = null; }
        if (!buf) { echecs++; refus.push(`${s.code} : ${url} n'a rien rendu`); continue; }
        const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
        // ⚠️ LE CONTRÔLE QUI DÉCIDE, ET IL EST PAR SET, PAS SUR UN ÉCHANTILLON : si l'image française
        // est OCTET POUR OCTET celle qu'on a déjà en anglais, elle n'apporte rien et on ne l'écrit pas.
        // Un champ qui existe et double son voisin est pire qu'un champ absent (§19).
        let memeQueAnglais = false;
        if (s.logo?.sha256 && s.logo.sha256 === sha256) memeQueAnglais = true;
        if (memeQueAnglais) { identiques++; refus.push(`${s.code} : le logo français est OCTET POUR OCTET l'anglais déjà en base`); continue; }

        const { w, h } = dimensionsPng(buf);
        if (!await r2.existe(process.env.R2_BUCKET_IMAGES, cleObjet)) {
            await r2.deposerBinaire(process.env.R2_BUCKET_IMAGES, cleObjet, buf, 'image/png');
        } else dejaLa++;
        await cx.db.collection('sets').updateOne({ _id: s._id }, {
            $set: {
                logoFr: {
                    cleR2: cleObjet, w, h, octets: buf.length, sha256, urlOriginal: url,
                    source: 'tcgdex:assets-fr',
                    preuve: `TCGdex [${id}], image servie par la langue fr ; SHA-256 vérifié distinct de l'anglais`,
                    le: new Date()
                }
            }
        });
        ecrits++; avec++;
        if (ecrits % 20 === 0) console.log(`   … ${ecrits} écrits`);
    }

    console.log(`\n   ✅ logos français disponibles : ${avec}`);
    if (ecrire) {
        const relu = await cx.db.collection('sets').countDocuments({ 'logoFr.cleR2': { $nin: [null, ''] } });
        console.log(`   ✅ ÉCRITS : ${ecrits} · objets R2 déjà présents : ${dejaLa} · relu en base : ${relu} sets portent un logoFr`);
    }
    console.log(`   ⛔ sans logo chez TCGdex : ${sansLogo} · identiques à l'anglais (non écrits) : ${identiques} · échecs réseau : ${echecs}`);
    console.log(`\n   les refus, avec leur cause :`);
    for (const x of refus.slice(0, 30)) console.log(`      ${x}`);
    if (refus.length > 30) console.log(`      … et ${refus.length - 30} autres`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
