'use strict';
// COTES-VISUELS, tours 1-2 — le SCRIPT AUTONOME qui précalcule l'archive des visuels et du lien fiche → produits, HORS de l'API (destiné au worker de l'agent catalogue : l'API, sur une offre gratuite qui
// se met en veille ~11 fois par jour, ne recalcule pas 380 s de lecture à chaque réveil — elle lit l'objet R2 et le charge en ~0,1 s).
//   node v2/migrations/construire-fichier-visuels.js --deposer [--vers=<archive.rmv>] [--catalogue=<products_singles_6.json>] [--ignorer-precedente]
// ENTRÉES (variables, des NOMS ici, jamais une valeur) :
//   lecture de `cartes`   MONGODB_CARTES_LECTURE_URI (+ MONGODB_CARTES_URI seulement pour refuser une lecture qui serait l'écriture) — la garde de l'API : variables, privilèges, façade à trois collections ;
//   catalogue             --catalogue=<export Cardmarket local> OU MONGODB_LECTURE_URI (base `test`, privilèges jugés par la même garde) ;
//   scellement            V2_VISUELS_HMAC (≥ 32 caractères, le MÊME secret que l'API) ;
//   dépôt R2 PRIVÉ        V2_VISUELS_R2_COMPTE, V2_VISUELS_R2_ECR_CLE_ID, V2_VISUELS_R2_ECR_SECRET (une clé d'ÉCRITURE limitée à ce bucket), V2_VISUELS_R2_BUCKET, V2_VISUELS_R2_OBJET, [V2_VISUELS_R2_ENDPOINT].
// SORTIES : l'objet R2 (Content-Type application/octet-stream, aucun Content-Encoding) et/ou le fichier --vers (écrit par un fichier temporaire puis un renommage). Rien d'autre.
// REFUS (code 1, AUCUNE publication) : 0 visuel ou 0 lien ; l'aller-retour (le consommateur refuserait l'archive : doublon, structure, entrée rejetée) ; une CHUTE de plus de 10 % des visuels ou des fiches liées
// par rapport à la dernière archive publiée (même objet, même secret) — la garde de garde-lot.js, au bon endroit : l'API redémarre sans version en mémoire et ne peut pas comparer. Si l'archive précédente
// existe mais ne se lit pas, le script refuse aussi (« je ne sais pas ») ; --ignorer-precedente est l'acte explicite qui passe outre. Première publication (objet absent) : rien à comparer, DIT.
const fs = require('fs'); const path = require('path');

const PERTE_MAX = 0.10;

async function principal(argv = process.argv, env = process.env, deps = {}) {
    const arg = n => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
    const vers = arg('vers'), catalogueJson = arg('catalogue'), deposer = argv.includes('--deposer'), ignorer = argv.includes('--ignorer-precedente');
    const stop = m => { console.error(`❌ ARRÊT : ${m}`); return 1; };
    if (!vers && !deposer) return stop('--deposer ou --vers=<archive> est requis (rien à produire sinon)');
    const LS = require('../chargeur/lecture-seule'); const S = require('../chargeur/scellement'); const R2 = require('../chargeur/r2-prive'); const F = require('../chargeur/format'); const DEPOT = require('./depot-r2');
    if (!S.secretValide(env.V2_VISUELS_HMAC)) return stop(`V2_VISUELS_HMAC absent ou trop court (${S.SECRET_MIN} caractères au moins) : une archive non scellée n'est jamais produite`);
    let ecriture = null;
    if (deposer) { ecriture = DEPOT.configEcriture(env); if (!ecriture.ok) return stop(`dépôt R2 : ${ecriture.raison}`); }
    const j = LS.jugerVariables(env); if (!j.ok && !deps.source) return stop(j.raison);                  // refus AVANT toute connexion
    const { fabriquerFichier } = require('../chargeur/precalcul'); const { sourceCartes } = require('../chargeur/source');
    let catalogue = new Map();
    if (deps.catalogue) catalogue = deps.catalogue;
    else if (catalogueJson) {
        for (const p of JSON.parse(fs.readFileSync(catalogueJson, 'utf8')).products) catalogue.set(p.idProduct, p.idMetacard);
    } else {
        const uri = env.MONGODB_LECTURE_URI; if (!uri) return stop('ni --catalogue= ni MONGODB_LECTURE_URI : le catalogue (idMetacard) manque');
        const mongoose = require('mongoose'); const { facadeLecture } = require('../../collecte-cartes/facade-lecture');
        const cx = await mongoose.createConnection(uri, { dbName: 'test', serverSelectionTimeoutMS: 20000 }).asPromise();
        try {
            const p = LS.jugerPrivileges(await cx.db.admin().command({ connectionStatus: 1, showPrivileges: true }));
            if (!p.ok) return stop(`MONGODB_LECTURE_URI : ${p.raison}`);
            const f = facadeLecture(cx.db);
            for await (const c of f.collection('catalogue_produits').find({}, { projection: { idProduct: 1, idMetacard: 1 } })) catalogue.set(c.idProduct, c.idMetacard);
        } finally { await cx.close(); }
    }
    let f;
    try { f = await fabriquerFichier({ source: deps.source || (() => sourceCartes({ env })), catalogue, secret: env.V2_VISUELS_HMAC }); }
    catch (e) { return stop(e && e.motif ? e.motif : `calcul impossible (${(e && (e.name || e.code)) || 'erreur'})`); }
    const c = f.comptes;
    console.log(`   calculé en ${(f.dureeMs / 1000).toFixed(0)} s : sets ${c.sets} · cartes ${c.cartes} · cartes_produits ${c.produits} · catalogue ${c.catalogue} · entrées ${c.visuels} · refusées ${c.refusees} · doublons d'idProduct identiques ${c.doublons || 0} (une seule entrée gardée) · contradictoires ${c.doublonsContradictoires || 0} (visuels différents : AUCUN visuel pour ces produits) · fiches liées ${c.fichesLiees} (produits ${c.produitsLies}, sets ${c.setsAvecLiens})`);
    // m1 : les compteurs du lot REPLI-REIMPRESSIONS, lisibles dans la sortie (jamais seulement dans un banc)
    if (c.repliRefuse) console.log('   repli : produits sans image d\'un autre tirage ' + c.repliRefuse.total + ' (' + Object.entries(c.repliRefuse.parFamille).map(([k, n]) => k + ' ' + n).join(' · ') + ') · basse définition exclue ' + (c.basseDefinitionExclue || 0)
        + ' · partage incohérent écarté ' + (c.partageIncoherent || 0) + ' · variante sans preuve ' + (c.varianteSansPreuve || 0) + ' · marquages ' + JSON.stringify(c.marquees || null)
        + ' · familles HORS LISTE FERMÉE : ' + ((c.familleHorsListe || []).length ? c.familleHorsListe.join(', ') : 'aucune'));

    let client = null;
    if (deposer) {
        client = deps.client || R2.creerClient(ecriture.c);
        // la GARDE des 10 % : contre la dernière archive publiée
        let precedente;
        try { precedente = await R2.lireObjet({ client, bucket: ecriture.c.bucket, objet: ecriture.c.objet, max: F.PLAFONDS.archive + 64, siAbsent: 'null' }); }
        catch (e) { if (!ignorer) return stop(`l'archive précédente n'a pas pu être lue (${e && e.motif ? e.motif : 'erreur'}) : je ne sais pas si la nouvelle est amputée — AUCUNE publication (--ignorer-precedente pour passer outre, en le décidant)`); precedente = undefined; }
        if (precedente === null) console.log('   première publication : aucune archive précédente à comparer');
        else if (precedente !== undefined) {
            let p;
            try { p = F.deserialiser(await F.decompresser(S.ouvrir(precedente, env.V2_VISUELS_HMAC))); }
            catch (e) { if (!ignorer) return stop(`l'archive précédente est illisible (${e && e.motif ? e.motif : 'erreur'}) : AUCUNE publication (--ignorer-precedente pour passer outre, en le décidant)`); p = null; }
            if (p) {
                const perdu = (a, b) => a > 0 && b < a * (1 - PERTE_MAX);
                if (perdu(p.comptes.visuels, c.visuels)) return stop(`chute de plus de 10 % des visuels par rapport à l'archive publiée (${p.comptes.visuels} → ${c.visuels}) : AUCUNE publication`);
                if (perdu(p.comptes.fichesLiees, c.fichesLiees)) return stop(`chute de plus de 10 % des fiches liées par rapport à l'archive publiée (${p.comptes.fichesLiees} → ${c.fichesLiees}) : AUCUNE publication`);
                console.log(`   comparée à l'archive publiée (${p.chargeLe.toISOString()}) : visuels ${p.comptes.visuels} → ${c.visuels}, fiches liées ${p.comptes.fichesLiees} → ${c.fichesLiees} : chute ≤ 10 %`);
            }
        }
    }
    if (vers) {
        const tmp = `${vers}.tmp-${process.pid}`;
        fs.mkdirSync(path.dirname(path.resolve(vers)), { recursive: true });
        fs.writeFileSync(tmp, f.scelle); fs.renameSync(tmp, vers);
        console.log(`✅ ${vers} : ${(f.brut.length / 1048576).toFixed(1)} Mo brut, ${(f.scelle.length / 1048576).toFixed(2)} Mo scellé`);
    }
    if (deposer) {
        try { await DEPOT.deposerObjet({ client, bucket: ecriture.c.bucket, objet: ecriture.c.objet, corps: f.scelle }); }
        catch (e) { return stop(`dépôt R2 refusé (${(e && (e.name || e.code)) || 'erreur'}) : rien n'a été publié`); }
        console.log(`✅ publié : ${(f.scelle.length / 1048576).toFixed(2)} Mo scellés, bucket et objet des variables V2_VISUELS_R2_BUCKET / V2_VISUELS_R2_OBJET`);
    }
    return 0;
}
module.exports = { principal, PERTE_MAX };

if (require.main === module) {
    require('dotenv').config();
    principal().then(code => process.exit(code)).catch(e => { console.error('❌', (e && (e.name || e.code)) || 'erreur'); process.exit(1); });
}
