// ============================================================================
// LA TECHNIQUE MARCHE-T-ELLE ? — séparation par embedding d'illustration
// ============================================================================
// SPÉCIFIÉE AVANT D'ÊTRE LANCÉE, ET LES SEUILS SONT ÉCRITS AVANT LES RÉSULTATS.
//
// CE QU'ELLE TESTE : à partir d'une PHOTO D'ANNONCE RÉELLE (tenue à la main, sous
// pochette, de travers), un plus-proche-voisin sur des images de RÉFÉRENCE place-t-il la
// bonne carte devant ses homonymes ? Et avec quelle MARGE ?
// ⚠️ Requête = photo d'annonce, JAMAIS une image de référence. Un appariement
// référence↔référence serait parfait et ne prouverait rien.
//
// CE QU'ELLE NE TESTE PAS, et il faut le lire avant d'interpréter :
//   - le périmètre vintage japonais : autre époque, autre style d'illustration, autre
//     qualité d'impression. TCGdex n'en a AUCUNE image (mesuré), donc c'est structurel.
//   - la qualité des vignettes de galerie : les références TCGdex sont en haute
//     définition, les vignettes Cardmarket peut-être sous 224 px.
//   - le chemin de collecte : rien ici ne touche Cardmarket.
//   - le cas des EX AEQUO : les concurrents occidentaux ne sont pas à égalité au scoring.
//
// ── SEUILS DE DÉCISION, ÉCRITS D'AVANCE ─────────────────────────────────────
// distance = 1 − cosinus, sur vecteurs L2-normalisés. marge = d(concurrent) − d(bon).
//   GO COLLECTE : rang 1 sur ≥ 80 % des requêtes ET marge médiane ≥ 0,05
//   ABANDON     : rang 1 sur < 50 % OU marge médiane ≤ 0,01
//   ZONE GRISE  : entre les deux -> on n'ouvre AUCUNE galerie, on élargit l'échantillon
// ⚠️ CE SONT DES CONVENTIONS DÉCLARÉES, PAS DES VALEURS DÉRIVÉES. Aucune mesure
// antérieure ne les calibre. Ils sont écrits ici pour ne pas être choisis après coup.
//
// USAGE : node mesure-separation-illustration.js --base=<nom>
// PRÉREQUIS : npm i @xenova/transformers   (~200 Mo avec onnxruntime-node ; le modèle
// MobileCLIP-S0 vision, ~12 Mo en int8, est téléchargé au premier lancement et mis en
// cache). Le même code calcule la RÉFÉRENCE et la REQUÊTE : un seul prétraitement, donc
// aucune dérive possible entre les deux — c'est la condition pour que la distance ait un
// sens (voir la comparaison des trois voies).
require('dotenv').config();
const BASE = process.argv.find(a => a.startsWith('--base='))?.split('=')[1];
if (!BASE) { console.error('❌ --base=<nom> obligatoire.'); process.exit(1); }
const mongoose = require('mongoose');
const axios = require('axios');
const { EXPANSIONS_VINTAGE } = require('./sets-vintage-japonais');

const SEUIL_RANG1 = 0.80, SEUIL_MARGE = 0.05;
const SEUIL_ABANDON_RANG1 = 0.50, SEUIL_ABANDON_MARGE = 0.01;

const med = a => { if (!a.length) return null; const t = [...a].sort((x, y) => x - y); const m = t.length >> 1; return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2; };
const cos = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

(async () => {
    const { AutoProcessor, CLIPVisionModelWithProjection, RawImage } = await import('@xenova/transformers');
    const MODELE = 'Xenova/mobileclip_s0';
    console.log(`modèle : ${MODELE} (encodeur VISION seul — l'encodeur de texte est inutile ici)\n`);
    const processeur = await AutoProcessor.from_pretrained(MODELE);
    const vision = await CLIPVisionModelWithProjection.from_pretrained(MODELE, { quantized: true });

    // UN SEUL CHEMIN D'ENCODAGE pour la référence ET la requête.
    async function vecteur(url) {
        const img = await RawImage.fromURL(url);
        const entrees = await processeur(img);
        const { image_embeds } = await vision(entrees);
        const v = Array.from(image_embeds.data);
        const n = Math.hypot(...v) || 1;
        return v.map(x => x / n);
    }

    const c = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: BASE }).asPromise();
    const J = c.collection('journal_scans');
    const CAT = c.collection('catalogue_produits');
    const NUM = c.collection('numeros_cartes');

    // ── LES REQUÊTES : photos d'annonce réelles, hors périmètre vintage ──
    const abouties = await J.find({ route: 'identifier', idProduct: { $ne: null }, motifEchec: null, imageUrl: { $ne: null } }).sort({ le: -1 }).toArray();
    const ids = [...new Set(abouties.map(l => Number(l.idProduct)))];
    const prods = new Map((await CAT.find({ idProduct: { $in: ids } }).toArray()).map(p => [Number(p.idProduct), p]));

    // ⚠️ LA VÉRITÉ, PAS LE RETENU. Noter la distance « au bon » suppose de savoir lequel
    // est bon. `idProduct` du journal est ce que la CHAÎNE a retenu, ce qui n'est pas la
    // même chose. On privilégie la vérité saisie ; à défaut la ligne est marquée
    // NON VÉRIFIÉE et sortie du calcul des seuils.
    let verites = new Map();
    try {
        const v = require('./banc-verites.json').verites || [];
        verites = new Map(v.filter(x => x.idProduct != null).map(x => [`${x.nom}|${x.numero}`, Number(x.idProduct)]));
    } catch (_) { console.warn('⚠️ banc-verites.json illisible — toutes les lignes seront NON VÉRIFIÉES.'); }

    const requetes = [];
    const vus = new Set();
    for (const l of abouties) {
        const p = prods.get(Number(l.idProduct));
        if (!p || EXPANSIONS_VINTAGE.has(Number(p.idExpansion))) continue;
        const nom = String(p.name).split('[')[0].trim();
        if (vus.has(nom)) continue;
        const concurrents = await CAT.find({ name: new RegExp(`^${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|\\[|$)`, 'i') }).toArray();
        if (concurrents.length < 3) continue;
        vus.add(nom);
        const verifie = verites.get(`${l.nom}|${l.numero}`);
        requetes.push({ ligne: l, nom, bon: verifie ?? Number(l.idProduct), verifie: verifie != null, concurrents });
        if (requetes.length >= 8) break;
    }
    console.log(`requêtes retenues : ${requetes.length}  ·  dont vérité SAISIE : ${requetes.filter(r => r.verifie).length}`);
    console.log('⚠️ Les lignes sans vérité saisie sont notées NON VÉRIFIÉE et EXCLUES des seuils.\n');

    // ── LES RÉFÉRENCES : images TCGdex, via le lien appris ──
    async function urlReference(idProduct) {
        const n = await NUM.findOne({ idProduct: Number(idProduct) }, { projection: { setTcgdex: 1, numero: 1, numeroUrl: 1 } });
        if (!n?.setTcgdex) return null;
        const num = String(n.numero || n.numeroUrl || '').replace(/^0+/, '');
        if (!num) return null;
        const base = `https://assets.tcgdex.net/en/${n.setTcgdex.split(/(?<=\D)(?=\d)/)[0] || n.setTcgdex}/${n.setTcgdex}/${num}`;
        for (const f of ['/high.png', '/low.png']) {
            try { const r = await axios.head(base + f, { timeout: 10000 }); if (r.status === 200) return base + f; } catch (_) { }
        }
        return null;
    }

    const resultats = [];
    for (const r of requetes) {
        console.log(`── ${r.nom}${r.verifie ? '' : '  [NON VÉRIFIÉE]'} — ${r.concurrents.length} concurrent(s)`);
        let vq;
        try { vq = await vecteur(r.ligne.imageUrl); }
        catch (e) { console.log(`   ❌ photo d'annonce illisible (${e.message}) — ligne écartée\n`); continue; }

        const notes = [];
        for (const k of r.concurrents) {
            const u = await urlReference(k.idProduct);
            if (!u) continue;
            try { notes.push({ id: Number(k.idProduct), d: 1 - cos(vq, await vecteur(u)) }); } catch (_) { }
        }
        if (notes.length < 2) { console.log(`   ⚠️ ${notes.length} référence(s) seulement — non concluant, ligne écartée\n`); continue; }
        notes.sort((a, b) => a.d - b.d);
        const iBon = notes.findIndex(n => n.id === r.bon);
        if (iBon < 0) { console.log(`   ⚠️ le bon produit ${r.bon} n'a PAS de référence — non concluant\n`); continue; }
        const dBon = notes[iBon].d;
        const meilleurConcurrent = notes.find(n => n.id !== r.bon);
        const marge = meilleurConcurrent.d - dBon;
        console.log(`   références encodées : ${notes.length}/${r.concurrents.length}`);
        console.log(`   d(bon ${r.bon}) = ${dBon.toFixed(4)}   ·   d(meilleur concurrent ${meilleurConcurrent.id}) = ${meilleurConcurrent.d.toFixed(4)}`);
        console.log(`   MARGE = ${marge.toFixed(4)}   ·   RANG DU BON = ${iBon + 1} / ${notes.length}\n`);
        resultats.push({ nom: r.nom, verifie: r.verifie, dBon, dConc: meilleurConcurrent.d, marge, rang: iBon + 1, n: notes.length });
    }

    // ── LE VERDICT, CONTRE LES SEUILS ÉCRITS D'AVANCE ──
    const notes = resultats.filter(r => r.verifie);
    console.log('═'.repeat(78));
    console.log(`VERDICT — sur ${notes.length} requête(s) à vérité saisie (${resultats.length} calculées au total)`);
    console.log('═'.repeat(78));
    if (!notes.length) { console.log('   AUCUNE requête vérifiée : la mesure NE CONCLUT PAS.'); await c.close(); return; }
    const rang1 = notes.filter(r => r.rang === 1).length / notes.length;
    const margeMed = med(notes.map(r => r.marge));
    console.log(`   rang 1        : ${(100 * rang1).toFixed(0)} %   (seuil GO ≥ 80 % · abandon < 50 %)`);
    console.log(`   marge médiane : ${margeMed.toFixed(4)}   (seuil GO ≥ 0,05 · abandon ≤ 0,01)`);
    const go = rang1 >= SEUIL_RANG1 && margeMed >= SEUIL_MARGE;
    const abandon = rang1 < SEUIL_ABANDON_RANG1 || margeMed <= SEUIL_ABANDON_MARGE;
    console.log(`\n   -> ${go ? 'GO COLLECTE' : abandon ? 'ABANDON' : 'ZONE GRISE — aucune galerie ouverte, élargir l\'échantillon'}`);
    console.log(`\n   ⚠️ Échantillon de ${notes.length}. Un verdict sur si peu de lignes BORNE MAL :`);
    console.log('      il dit une tendance, pas une performance. Et il ne dit RIEN du vintage japonais.');
    await c.close();
})().catch(e => { console.error(e.stack); process.exit(1); });
