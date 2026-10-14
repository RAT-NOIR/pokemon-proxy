'use strict';
// Lot MARCHES-DESCRIPTION — B3 (12 marchés ouverts, AUD) et B6 (la description n'est plus conservée par défaut).
// Base EN MÉMOIRE (H.ouvrirBac), aucune requête réseau réelle.
const H = require('./_harnais');
const { v, vrai } = H;
const db = require('../db');
const M = require('../modeles');
const T = require('../identifier/taux');
const { lireConfig } = require('../config');
const { verifierEntree } = require('../identifier/routes');
const { conserverAnnonce } = require('../annonce/conservation');

const IMAGE = 'https://images1.vinted.net/t/00_x/f800/a.webp';
const corps = o => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...o });
const NOUVEAUX = ['vinted.ie', 'vinted.co.uk', 'vinted.hu', 'vinted.ro', 'vinted.si', 'vinted.hr', 'vinted.gr', 'vinted.lv', 'vinted.ee', 'vinted.dk', 'vinted.fi', 'vinted.com.au'];

(async () => {
    await H.ouvrirBac('test-marches-description.js');
    await M.creerIndex();
    const cfg = lireConfig({});

    // ── B3 : marchés
    for (const m of NOUVEAUX) v(`B3 : ${m} accepté`, verifierEntree(corps({ marche: m }), cfg).erreur, undefined);
    v('B3 : vinted.co.uk accepté', Boolean(verifierEntree(corps({ marche: 'vinted.co.uk' }), cfg).entree), true);
    const uk = verifierEntree(corps({ marche: 'vinted.uk' }), cfg);
    v('B3 : vinted.uk refusé 422 MARCHE (le domaine n\'existe pas)', uk.erreur && uk.erreur.code, 'MARCHE');
    for (const m of ['vinted.xx', 'vinted.co.au', 'ebay.fr', '', null, 5]) v(`B3 : marché inconnu ${JSON.stringify(m)} refusé MARCHE`, verifierEntree(corps({ marche: m }), cfg).erreur.code, 'MARCHE');
    for (const m of ['fr', 'be', 'com', 'de', 'es', 'it', 'nl', 'lu', 'at', 'pl', 'pt', 'se', 'cz', 'sk', 'lt']) vrai(`B3 : vinted.${m} reste accepté`, cfg.marches.includes(`vinted.${m}`));
    v('B3 : 15 anciens + 12 nouveaux = 27 marchés', cfg.marches.length, 27);
    v('B3 : vintedUrl d\'un nouveau marché accepté', Boolean(verifierEntree(corps({ marche: 'vinted.ie', vintedUrl: 'https://www.vinted.co.uk/items/1-x' }), cfg).entree), true);
    v('B3 : vintedUrl vinted.uk refusée', verifierEntree(corps({ vintedUrl: 'https://www.vinted.uk/items/1-x' }), cfg).erreur?.detail, 'vinted-url');
    v('B3 : V2_MARCHES posé garde la priorité', lireConfig({ V2_MARCHES: 'vinted.fr' }).marches, ['vinted.fr']);
    v('B3 : V2_MARCHES posé : vinted.ie refusé', verifierEntree(corps({ marche: 'vinted.ie' }), lireConfig({ V2_MARCHES: 'vinted.fr' })).erreur.code, 'MARCHE');

    // ── M1 (r1) : la liste CORS héritée (index.js) suit les 27 marchés
    {
        const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'index.js'), 'utf8');
        const m = /const ORIGINES_AUTORISEES = \[[\s\S]*?\];/.exec(src);
        const res = [...m[0].matchAll(/\/(\^https[^\n]*?\$)\//g)].map(x => new RegExp(x[1].replace(/\\\//g, '/')));
        vrai('CORS hérité : l\'expression des domaines Vinted est lue dans index.js', res.length === 1);
        const accepte = d => res.some(re => re.test(`https://www.${d}`) && re.test(`https://${d}`));
        for (const d of cfg.marches) vrai(`CORS hérité : ${d} accepté`, accepte(d));
        v('CORS hérité : vinted.uk refusé', accepte('vinted.uk'), false);
    }

    // ── B3 : AUD
    vrai('B3 : AUD dans les devises', cfg.devises.includes('AUD'));
    v('B3 : devise AUD acceptée avec un prix', Boolean(verifierEntree(corps({ marche: 'vinted.com.au', prixVinted: 12, devise: 'AUD' }), cfg).entree), true);
    v('B3 : devise inconnue toujours refusée', verifierEntree(corps({ prixVinted: 12, devise: 'XXX' }), cfg).erreur.detail, 'devise');
    const XML = "<gesmes:Envelope><Cube><Cube time='2026-10-14'><Cube currency='USD' rate='1.1000'/><Cube currency='AUD' rate='1.6000'/></Cube></Cube></gesmes:Envelope>";
    v('B3 : le fichier BCE lu porte AUD', T.lireTauxBCE(XML).taux.AUD, 1.6);
    await db.col('taux').insertOne({ devise: 'USD', date: '2026-10-14', rate: 1.1 });     // la base a un taux, mais pas pour AUD
    v('B3 : base SANS taux AUD (dénominateur : 1 ligne USD) : versEUR null, rien d\'inventé', [(await db.col('taux').countDocuments({ devise: 'AUD' })), (await T.versEUR('AUD', { maintenant: new Date('2026-10-14T15:00:00Z') })).versEUR], [0, null]);
    await db.col('taux').insertOne({ devise: 'AUD', date: '2026-10-14', rate: 1.6 });
    const r = await T.versEUR('AUD', { maintenant: new Date('2026-10-14T15:00:00Z') });
    v('B3 : une annonce en AUD obtient versEUR non nul (1/1.6) quand un taux AUD est en base', r, { versEUR: 0.625, tauxDate: '2026-10-14' });
    v('B3 : taux AUD périmé (plus de 7 jours), versEUR null',(await T.versEUR('AUD', { maintenant: new Date('2026-12-30T15:00:00Z') })).versEUR, null);

    // ── B6 : défaut
    v('B6 : défaut V2_DESCRIPTION_CONSERVEE éteint', cfg.annonce.conservee, false);
    v('B6 : V2_DESCRIPTION_CONSERVEE=1 allume', lireConfig({ V2_DESCRIPTION_CONSERVEE: '1' }).annonce.conservee, true);
    v('B6 : V2_DESCRIPTION_CONSERVEE=0 éteint', lireConfig({ V2_DESCRIPTION_CONSERVEE: '0' }).annonce.conservee, false);
    v('B6 : auModele reste faux', cfg.annonce.auModele, false);
    await conserverAnnonce('d1', { titre: 'T', description: 'DESCRIPTION-SECRETE-9', expurgeeParServeur: false }, cfg);
    v('B6 : par défaut conserverAnnonce n\'écrit rien', await db.col('annonces').countDocuments(), 0);
    await conserverAnnonce('d2', { titre: 'T', description: 'DESCRIPTION-GARDEE-9', expurgeeParServeur: false }, lireConfig({ V2_DESCRIPTION_CONSERVEE: '1' }));
    v('B6 : V2_DESCRIPTION_CONSERVEE=1 garde l\'ancien comportement (une ligne, description comprise)', (await db.col('annonces').findOne({ _id: 'd2' }) || {}).description, 'DESCRIPTION-GARDEE-9');

    // ── B6 : une requête sans description reste valide
    const sans = corps(); delete sans.description;
    v('B6 : requête sans description valide', Boolean(verifierEntree(sans, cfg).entree), true);

    H.bilan();
    process.exit();         // routes.js (require) laisse des poignées ouvertes : la sortie passe par le nettoyage du harnais (vidage du préfixe)
})().catch(e => { console.error('❌', e); process.exit(1); });
