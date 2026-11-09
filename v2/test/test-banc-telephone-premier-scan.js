'use strict';
// BANC-TELEPHONE, lot « premier scan » : (1) le cache durable du modèle et du moteur (public/preparation.mjs : Cache Storage injecté, jamais retéléchargé, un échec retombe sur le réseau),
// (2) la garde de la préparation en arrière-plan, (3) les fichiers servis compressés (brotli/gzip) et revalidables (ETag, 304) — c'est le 14 Mo de .wasm servi par l'API, pas la création de session, qui prenait ~15 s,
// (4) le dépôt accepte l'objet `preparation` (liste fermée), (5) ce que le code de la page doit contenir. Aucun réseau, aucune base (un petit serveur express local pour les routes).
const H = require('./_harnais');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const express = require('express');
const { pathToFileURL } = require('url');
const routes = require('../banc-telephone/routes');
const S = require('../banc-telephone/stockage');
const PUB = path.join(__dirname, '..', 'banc-telephone', 'public');
const ENV = { V2_BANC_TELEPHONE: '1', V2_CIBLE: 'essai', RENDER_SERVICE_ID: 'srv-db7ticgm7kps73crjibg', MONGODB_BASE: 'rm_essai' };

// un Cache Storage de bouchon : put lit le corps jusqu'au bout (comme le vrai), match rend une NOUVELLE réponse
function faussesCaches({ putLeve = false, matchLeve = false, openLeve = false } = {}) {
    const magasins = new Map(), journal = [];
    return { journal, magasins, open: async nom => {
        if (openLeve) throw new Error('open');
        if (!magasins.has(nom)) magasins.set(nom, new Map());
        const m = magasins.get(nom);
        return {
            match: async cle => { journal.push(['match', cle]); if (matchLeve) throw new Error('match'); const e = m.get(cle); return e ? new Response(e.octets, { status: 200, headers: e.entetes }) : undefined; },
            put: async (cle, rep) => { journal.push(['put', cle]); if (putLeve) { try { await rep.body.cancel(); } catch { /* sans effet */ } throw new Error('quota'); } m.set(cle, { octets: Buffer.from(await rep.arrayBuffer()), entetes: Object.fromEntries(rep.headers) }); },
            delete: async cle => { journal.push(['delete', cle]); return m.delete(cle); }
        };
    } };
}
const reponse = (octets, extra = {}) => new Response(octets, { status: 200, headers: { 'content-length': String(octets.length), ...extra } });
const octetsDe = n => { const o = new Uint8Array(n); for (let i = 0; i < n; i++) o[i] = (i * 31 + 7) & 255; return o; };
const egal = (a, b) => a && b && a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

(async () => {
    const P = await import(pathToFileURL(path.join(PUB, 'preparation.mjs')).href);
    const CLE = '/api/modele-empreinte/' + 'a'.repeat(64);
    const MODELE = octetsDe(300000);

    // ═══ 1. le cache durable ═══
    {
        const caches = faussesCaches(); let appels = 0; const phases = [];
        const reseau = async () => { appels++; return reponse(MODELE); };
        const r1 = await P.chargerOctets({ cle: CLE, reseau, caches, octetsAttendus: MODELE.length, surPhase: (n, e) => phases.push(n + ':' + e) });
        H.v('1. cache vide : le réseau sert, source « reseau », cache « manque », écriture « ok », octets identiques', [r1.source, r1.cache, r1.ecriture, appels, egal(r1.octets, MODELE), r1.verifie], ['reseau', 'manque', 'ok', 1, true, true]);
        H.v('1. l\'entrée est rangée sous la clé, avec sa taille', [caches.magasins.get(P.NOM_CACHE).has(CLE), caches.magasins.get(P.NOM_CACHE).get(CLE).entetes['content-length']], [true, String(MODELE.length)]);
        const r2 = await P.chargerOctets({ cle: CLE, reseau, caches, octetsAttendus: MODELE.length });
        H.v('1. second appel : le cache sert, le réseau n\'est PAS rappelé, source « cache », cache « touche »', [r2.source, r2.cache, appels, egal(r2.octets, MODELE), r2.verifie], ['cache', 'touche', 1, true, true]);
        H.v('1. les phases réelles sont dites (téléchargement, sinon lecture du cache) : ni pourcentage, ni phase inventée', [phases.includes('telechargement:debut'), phases.includes('telechargement:fin'), r1.ms.reseau >= 0, r2.ms.cacheLecture >= 0], [true, true, true, true]);
    }
    {   // une entrée dont le contenu n'est plus le bon (verifier la refuse) : effacée, réseau, remplacée
        const caches = faussesCaches(); let appels = 0;
        const reseau = async () => { appels++; return reponse(MODELE); };
        await P.chargerOctets({ cle: CLE, reseau, caches, octetsAttendus: MODELE.length });
        const m = caches.magasins.get(P.NOM_CACHE); const e = m.get(CLE); e.octets[10] ^= 1;               // un bit change dans le cache
        const bon = Buffer.from(MODELE);
        const r = await P.chargerOctets({ cle: CLE, reseau, caches, octetsAttendus: MODELE.length, verifier: async o => Buffer.compare(Buffer.from(o), bon) === 0 });
        H.v('1. entrée corrompue : refusée par le vérificateur, retombée sur le réseau, remplacée (cache « corrompu »)', [r.source, r.cache, appels, egal(r.octets, MODELE), r.verifie, egal(m.get(CLE).octets, MODELE)], ['reseau', 'corrompu', 2, true, true, true]);
    }
    {   // le réseau lui-même rend un contenu refusé : verifie=false, rien ne reste dans le cache
        const caches = faussesCaches();
        const r = await P.chargerOctets({ cle: CLE, reseau: async () => reponse(MODELE), caches, octetsAttendus: MODELE.length, verifier: async () => false });
        H.v('1. contenu réseau refusé : verifie=false et l\'entrée est SUPPRIMÉE du cache', [r.verifie, caches.magasins.get(P.NOM_CACHE).has(CLE)], [false, false]);
    }
    {   // taille du cache différente de la taille attendue : corrompu
        const caches = faussesCaches(); const m = new Map(); caches.magasins.set(P.NOM_CACHE, m);
        m.set(CLE, { octets: Buffer.from(MODELE.subarray(0, 1000)), entetes: { 'content-length': '1000' } });
        let appels = 0; const r = await P.chargerOctets({ cle: CLE, reseau: async () => { appels++; return reponse(MODELE); }, caches, octetsAttendus: MODELE.length });
        H.v('1. entrée de la mauvaise taille ⇒ « corrompu », réseau, octets justes', [r.cache, r.source, appels, egal(r.octets, MODELE)], ['corrompu', 'reseau', 1, true]);
    }
    {   // une réponse COMPRESSÉE : fetch décompresse, Content-Length est celui du corps compressé ; la taille décompressée vient de X-Rm-Octets
        const caches = faussesCaches(); const gros = octetsDe(50000);
        const r = await P.chargerOctets({ cle: CLE, reseau: async () => reponse(gros, { 'content-length': '9000', 'x-rm-octets': '50000' }), caches });
        const e = caches.magasins.get(P.NOM_CACHE).get(CLE);
        const r2 = await P.chargerOctets({ cle: CLE, reseau: async () => { throw new Error('non'); }, caches });
        H.v('1. réponse compressée : la taille décompressée (X-Rm-Octets) fait foi, rangée au cache, relue sans réseau', [r.octets.length, e.entetes['content-length'], r2.source, egal(r2.octets, gros)], [50000, '50000', 'cache', true]);
    }
    {   // la revalidation : le serveur dit « changé » ⇒ entrée périmée, réseau ; « valide » ou sans réponse ⇒ cache ; l'étiquette du serveur est rangée avec l'entrée
        const caches = faussesCaches(); let appels = 0; const vus = [];
        const reseau = async () => { appels++; return reponse(MODELE, { etag: '"e1"' }); };
        await P.chargerOctets({ cle: CLE, reseau, caches, octetsAttendus: MODELE.length });
        H.v('1. l\'étiquette du serveur est rangée avec l\'entrée (x-rm-etag)', caches.magasins.get(P.NOM_CACHE).get(CLE).entetes['x-rm-etag'], '"e1"');
        let r = await P.chargerOctets({ cle: CLE, reseau, caches, octetsAttendus: MODELE.length, revalider: async ({ etag }) => { vus.push(etag); return 'valide'; } });
        H.v('1. revalidation « valide » ⇒ cache, l\'étiquette rangée est celle transmise', [r.source, r.cache, appels, vus[0]], ['cache', 'touche', 1, '"e1"']);
        r = await P.chargerOctets({ cle: CLE, reseau, caches, octetsAttendus: MODELE.length, revalider: async () => { throw new Error('hors ligne'); } });
        H.v('1. revalidation impossible (hors ligne) ⇒ le cache sert quand même', [r.source, r.cache, appels], ['cache', 'touche', 1]);
        r = await P.chargerOctets({ cle: CLE, reseau, caches, octetsAttendus: MODELE.length, revalider: async () => 'change' });
        H.v('1. revalidation « change » ⇒ entrée « perime » retirée, réseau, octets justes, entrée réécrite', [r.source, r.cache, appels, egal(r.octets, MODELE), caches.magasins.get(P.NOM_CACHE).has(CLE)], ['reseau', 'perime', 2, true, true]);
    }
    for (const [nom, caches, etat] of [['pas de Cache Storage', undefined, 'indisponible'], ['open() lève', faussesCaches({ openLeve: true }), 'indisponible'], ['match() lève', faussesCaches({ matchLeve: true }), 'indisponible']]) {
        let appels = 0; const r = await P.chargerOctets({ cle: CLE, reseau: async () => { appels++; return reponse(MODELE); }, caches, octetsAttendus: MODELE.length });
        H.v(`1. ${nom} ⇒ retombe proprement sur le réseau (cache « ${etat} »), octets justes`, [r.source, r.cache, appels, egal(r.octets, MODELE), r.verifie], ['reseau', etat, 1, true, true]);
    }
    {
        const caches = faussesCaches({ putLeve: true });
        const r = await P.chargerOctets({ cle: CLE, reseau: async () => reponse(MODELE), caches, octetsAttendus: MODELE.length });
        H.v('1. écriture impossible (quota) ⇒ le téléchargement réussit quand même, écriture « echec »', [r.source, r.ecriture, egal(r.octets, MODELE), r.verifie], ['reseau', 'echec', true, true]);
    }
    {
        let leve = null; try { await P.chargerOctets({ cle: CLE, reseau: async () => reponse(octetsDe(10), { 'content-length': '5' }), caches: undefined, octetsAttendus: 0 }); } catch (e) { leve = e.detail; }
        H.v('1. plus d\'octets que annoncé ⇒ erreur nommée', /plus d'octets que annonce/.test(leve || ''), true);
        leve = null; try { await P.chargerOctets({ cle: CLE, reseau: async () => reponse(octetsDe(5), { 'content-length': '10' }), caches: undefined, octetsAttendus: 0 }); } catch (e) { leve = e.detail; }
        H.v('1. moins d\'octets que annoncé ⇒ erreur nommée', /octets recus/.test(leve || ''), true);
        leve = null; try { await P.chargerOctets({ cle: CLE, reseau: async () => { throw Object.assign(new Error('x'), { detail: 'reseau-mort' }); }, caches: faussesCaches() }); } catch (e) { leve = e.detail; }
        H.v('1. une erreur du réseau remonte telle quelle (l\'appelant la classe)', leve, 'reseau-mort');
    }
    {
        const vus = []; await P.chargerOctets({ cle: CLE, reseau: async () => reponse(octetsDe(2 * 1048576 + 5)), caches: undefined, octetsAttendus: 0, surProgres: (recu, total) => vus.push([recu, total]) });
        H.v('1. la progression dit les octets REÇUS sur le total, sans pourcentage inventé', [vus.length > 0, vus[vus.length - 1][0], vus[vus.length - 1][1]], [true, 2 * 1048576 + 5, 2 * 1048576 + 5]);
    }

    // ═══ 1 bis. (tour 1, B1) le sha256 du fichier brut, rangé avec l'entrée, rejoué à chaque lecture ; (M2) l'écriture du cache ne retarde plus la session ═══
    {
        const caches = faussesCaches(); const SHA = 'b'.repeat(64); let appels = 0; const vus = [];
        const reseau = async () => { appels++; return reponse(MODELE, { 'x-rm-sha256': SHA, etag: '"e9"' }); };
        const verifier = async (o, { sha } = {}) => { vus.push(sha); return sha === SHA; };
        const r1 = await P.chargerOctets({ cle: CLE, reseau, caches, octetsAttendus: MODELE.length, verifier });
        H.v('1b. le sha publié par le serveur (X-Rm-Sha256) est transmis au vérificateur à la lecture réseau, et rangé avec l\'entrée', [vus[0], caches.magasins.get(P.NOM_CACHE).get(CLE).entetes['x-rm-sha256'], r1.verifie], [SHA, SHA, true]);
        const r2 = await P.chargerOctets({ cle: CLE, reseau, caches, octetsAttendus: MODELE.length, verifier });
        H.v('1b. à la lecture du cache, le vérificateur reçoit le sha RANGÉ : il est rejoué à CHAQUE lecture', [r2.source, vus[1], r2.verifie, appels], ['cache', SHA, true, 1]);
        caches.magasins.get(P.NOM_CACHE).get(CLE).entetes['x-rm-sha256'] = 'c'.repeat(64);
        const r3 = await P.chargerOctets({ cle: CLE, reseau, caches, octetsAttendus: MODELE.length, verifier });
        H.v('1b. un sha rangé qui n\'est plus celui du serveur (autre version) est refusé : « corrompu », réseau', [r3.source, r3.cache, appels], ['reseau', 'corrompu', 2]);
        const revu = [];
        await P.chargerOctets({ cle: CLE, reseau, caches, octetsAttendus: MODELE.length, verifier, revalider: async x => { revu.push(x); return 'valide'; } });
        H.v('1b. revalider reçoit l\'étiquette ET le sha rangés', [revu[0].etag, revu[0].sha], ['"e9"', SHA]);
        // M2 : sans attendre l'écriture : les octets sont rendus tout de suite, l'écriture se termine ensuite
        const c2 = faussesCaches(); const phases = [];
        const rA = await P.chargerOctets({ cle: CLE, reseau: async () => reponse(MODELE), caches: c2, octetsAttendus: MODELE.length, attendreEcriture: false, surPhase: (n, e) => phases.push(n + ':' + e) });
        H.v('1b. attendreEcriture:false ⇒ « en-cours » rendu aussitôt, la promesse finEcriture dit « ok » ensuite', [rA.ecriture, await rA.finEcriture, c2.magasins.get(P.NOM_CACHE).has(CLE), egal(rA.octets, MODELE)], ['en-cours', 'ok', true, true]);
        const c3 = faussesCaches(), ph3 = [];
        await P.chargerOctets({ cle: CLE, reseau: async () => reponse(MODELE), caches: c3, octetsAttendus: MODELE.length, surPhase: (n, e) => ph3.push(n + ':' + e) });
        H.v('1b. quand on attend l\'écriture, la phase « ecriture-cache » est DITE (début et fin)', [ph3.includes('ecriture-cache:debut'), ph3.includes('ecriture-cache:fin')], [true, true]);
        const c4 = faussesCaches({ putLeve: true }); const rB = await P.chargerOctets({ cle: CLE, reseau: async () => reponse(MODELE), caches: c4, octetsAttendus: MODELE.length, attendreEcriture: false });
        H.v('1b. écriture refusée sans attente ⇒ finEcriture « echec », octets quand même rendus', [await rB.finEcriture, egal(rB.octets, MODELE)], ['echec', true]);
        // retirerEntrees : après un échec de session venue du cache
        const c5 = faussesCaches(); await P.chargerOctets({ cle: CLE, reseau: async () => reponse(MODELE), caches: c5 }); await P.chargerOctets({ cle: '/autre', reseau: async () => reponse(MODELE), caches: c5 });
        await P.retirerEntrees({ caches: c5, cles: [CLE, '/autre', '/inconnue'] });
        H.v('1b. retirerEntrees retire les clés nommées du cache, sans lever pour une clé absente', [c5.magasins.get(P.NOM_CACHE).size], [0]);
        let leve = false; try { await P.retirerEntrees({ caches: faussesCaches({ openLeve: true }), cles: [CLE] }); await P.retirerEntrees({ caches: undefined, cles: [CLE] }); } catch { leve = true; }
        H.v('1b. retirerEntrees ne lève jamais (cache absent ou open qui lève)', leve, false);
    }

    // ═══ 1 ter. (tour 2, P3-1) les trois décisions de B1 sont des fonctions PURES, testées par leur comportement ; trois mutations les font échouer ═══
    {
        const os = require('os');
        const sha256Hex = async o => require('crypto').createHash('sha256').update(Buffer.from(o)).digest('hex');
        const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 9, 9, 9, 9]), SHA_OK = require('crypto').createHash('sha256').update(Buffer.from(wasm)).digest('hex');
        // les verdicts de B1 pour un module `M` (le vrai, ou un mutant) : chacun doit être VRAI pour le vrai module
        const verdictsB1 = async M => {
            const v = [];
            // (1) la clé suit la version d'ORT
            v.push(M.cleMoteur('/m.wasm', '1.30.0') !== M.cleMoteur('/m.wasm', '1.31.0'));
            v.push(/1\.30\.0/.test(M.cleMoteur('/m.wasm', '1.30.0')) && M.cleMoteur('/m.wasm', '1.30.0').startsWith('/m.wasm'));
            v.push(/inconnue/.test(M.cleMoteur('/m.wasm', null)) && /^\/m\.wasm\?ort=[\w.-]*$/.test(M.cleMoteur('/m.wasm', '../../x y/z')));      // version absente : « inconnue » ; version étrange : nettoyée, jamais un second chemin
            // (2) le sha du moteur est REJOUÉ : bon sha accepté ; mauvais, absent, mal formé, mauvaise magie refusés
            v.push(await M.verifierMoteur(wasm, SHA_OK, { sha256Hex }) === true);
            v.push(await M.verifierMoteur(wasm, 'f'.repeat(64), { sha256Hex }) === false);
            v.push(await M.verifierMoteur(wasm, null, { sha256Hex }) === false && await M.verifierMoteur(wasm, 'xyz', { sha256Hex }) === false);
            v.push(await M.verifierMoteur(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), SHA_OK, { sha256Hex }) === false && await M.verifierMoteur(new Uint8Array(3), SHA_OK, { sha256Hex }) === false);
            v.push(await M.verifierMoteur(wasm, null, {}) === true);       // contexte non sécurisé : pas de sha256 possible, comme pour le modèle
            // (3) un échec de session venu du cache retire modèle ET moteur ; rien ne bouge si tout venait du réseau
            const cas = async (sources) => { const c = faussesCaches(); for (const k of ['/w', '/m', '/autre']) await P.chargerOctets({ cle: k, reseau: async () => reponse(octetsDe(500)), caches: c }); const r = await M.apresEchecDeSession({ caches: c, sources, cles: ['/w', '/m'] }); return { r, restent: [...c.magasins.get(P.NOM_CACHE).keys()].sort() }; };
            const a = await cas({ wasm: 'cache', modele: 'reseau' }), b = await cas({ wasm: 'reseau', modele: 'cache' }), n = await cas({ wasm: 'reseau', modele: 'reseau' }), t = await cas({ wasm: 'cache', modele: 'cache' });
            v.push(a.r === true && JSON.stringify(a.restent) === '["/autre"]');
            v.push(b.r === true && JSON.stringify(b.restent) === '["/autre"]');
            v.push(n.r === false && JSON.stringify(n.restent) === '["/autre","/m","/w"]');
            v.push(t.r === true && JSON.stringify(t.restent) === '["/autre"]');
            return v;
        };
        const reel = await verdictsB1(P);
        H.v('1c. les décisions de B1 (clé versionnée, sha du moteur rejoué, éviction sur échec venu du cache) : tous les comportements tiennent sur le vrai module', reel.every(x => x === true), true);
        // trois mutations, du TEXTE de preparation.mjs, chacune doit être TUÉE (au moins un verdict faux)
        const source = fs.readFileSync(path.join(PUB, 'preparation.mjs'), 'utf8'); let n = 0;
        const muter = async (de, vers) => {
            if (!source.includes(de)) return { absente: true };
            const tmp = path.join(os.tmpdir(), `rm-mutant-ps-${process.pid}-${++n}.mjs`); fs.writeFileSync(tmp, source.replace(de, vers));
            try { const M = await import(pathToFileURL(tmp).href); return { verdicts: await verdictsB1(M) }; } finally { try { fs.unlinkSync(tmp); } catch { /* jetable */ } }
        };
        const tuee = r => !r.absente && r.verdicts.some(x => x === false);
        H.v('1c. MUTATION 1 — l\'éviction ne se déclenche plus quand le moteur venait du cache (`false && …`) : TUÉE', tuee(await muter('if (sources.wasm === \'cache\' ||', 'if (false && sources.wasm === \'cache\' ||')), true);
        H.v('1c. MUTATION 2 — le sha du moteur n\'est plus jamais comparé (`return true`) : TUÉE', tuee(await muter('return (await sha256Hex(octets)) === sha;', 'return true;')), true);
        H.v('1c. MUTATION 3 — la clé du cache n\'a plus la version d\'ORT : TUÉE', tuee(await muter('?ort=${String(versionOrt || \'inconnue\').replace(/[^\\w.-]/g, \'\').slice(0, 20)}', '')), true);
        H.v('1c. MUTATION 4 (témoin) — un texte sans rapport ne tue rien : le banc ne crie pas à tort', (await muter('export const ETATS_CACHE', 'export const ETATS_CACHE_X = 0; export const ETATS_CACHE')).verdicts.every(x => x === true), true);
    }

    // ═══ 2. la préparation seule : la garde ═══
    H.v('2. rien de particulier ⇒ la page prépare seule', P.peutPreparerSeul({ marqueur: null, deviceMemory: undefined, recherche: '' }), { auto: true, raison: 'ok' });
    H.v('2. ?prep=0 ⇒ pas de préparation seule (on attend le clic)', P.peutPreparerSeul({ marqueur: null, deviceMemory: 8, recherche: '?prep=0' }), { auto: false, raison: 'demande' });
    H.v('2. la préparation précédente n\'a jamais fini (onglet tué) ⇒ pas de préparation seule', P.peutPreparerSeul({ marqueur: 'en-cours', deviceMemory: 8, recherche: '' }), { auto: false, raison: 'interrompue' });
    H.v('2. appareil à moins de 2 Go déclarés ⇒ pas de préparation seule', P.peutPreparerSeul({ marqueur: 'ferme', deviceMemory: 1, recherche: '' }), { auto: false, raison: 'memoire-faible' });
    H.v('2. marqueur « pret » resté tel quel (onglet mort visible, avec la session chargée) ⇒ pas de préparation seule', P.peutPreparerSeul({ marqueur: 'pret', deviceMemory: 8, recherche: '' }), { auto: false, raison: 'interrompue' });
    H.v('2. marqueur « ferme » (page cachée ou quittée normalement) et mémoire inconnue (iOS ne la donne pas) ⇒ oui', P.peutPreparerSeul({ marqueur: 'ferme', deviceMemory: undefined, recherche: '' }).auto, true);
    // tour 1, B2 : la garde est écrite par ce qu'elle AUTORISE — marqueur absent ou « ferme », ?prep ≠ 0, pas d'économie de données, mémoire absente (Safari/iOS) ou ≥ 2 ; tout le reste bloque
    const g = o => P.peutPreparerSeul({ marqueur: null, deviceMemory: undefined, recherche: '', saveData: false, ...o });
    H.v('2. marqueur « echec » ⇒ pas de relance seule (un échec déterministe, ex. CORS de R2, ne recommence pas à chaque ouverture)', g({ marqueur: 'echec' }), { auto: false, raison: 'echec' });
    H.v('2. marqueur inconnu (« x », un nombre, vide, un objet) ⇒ pas de préparation seule', [g({ marqueur: 'x' }), g({ marqueur: 12 }), g({ marqueur: '' }), g({ marqueur: {} })].map(r => [r.auto, r.raison]), Array(4).fill([false, 'inconnu']));
    H.v('2. marqueur absent (null, undefined) ou « ferme » ⇒ oui', [g({ marqueur: null }).auto, g({ marqueur: undefined }).auto, g({ marqueur: 'ferme' }).auto], [true, true, true]);
    H.v('2. mémoire de l\'appareil ABSENTE (Safari/iOS : décision de l\'éditeur, la préparation se mesure sur iPhone) ⇒ oui ; null aussi', [g({ deviceMemory: undefined }).auto, g({ deviceMemory: null }).auto], [true, true]);
    H.v('2. mémoire présente et ≥ 2 ⇒ oui ; exactement 2 aussi', [g({ deviceMemory: 2 }).auto, g({ deviceMemory: 8 }).auto], [true, true]);
    H.v('2. mémoire présente mais illisible (texte, NaN, négative) ⇒ pas de préparation seule', [g({ deviceMemory: '4' }).auto, g({ deviceMemory: NaN }).auto, g({ deviceMemory: -1 }).auto, g({ deviceMemory: 0.5 }).auto], [false, false, false, false]);
    H.v('2. économie de données (navigator.connection.saveData) ⇒ pas de préparation seule', g({ saveData: true }), { auto: false, raison: 'data-economie' });
    // tour 2 : saveData aussi par ce qu'il AUTORISE — absent (undefined, null : Safari ne l'expose pas) ou exactement false ; toute autre valeur bloque
    H.v('2. saveData absent (undefined, null) ou exactement false ⇒ oui', [g({ saveData: undefined }).auto, g({ saveData: null }).auto, g({ saveData: false }).auto], [true, true, true]);
    H.v('2. saveData autre qu\'absent ou false (true, « true », 1, 0, « false ») ⇒ pas de préparation seule', [g({ saveData: true }), g({ saveData: 'true' }), g({ saveData: 1 }), g({ saveData: 0 }), g({ saveData: 'false' })].map(r => [r.auto, r.raison]), Array(5).fill([false, 'data-economie']));
    H.v('2. aucun argument ⇒ le marqueur est absent, la mémoire et saveData aussi : la garde autorise, sans lever', (() => { try { return P.peutPreparerSeul({}); } catch { return 'leve'; } })(), { auto: true, raison: 'ok' });
    H.v('2. aucun objet du tout ⇒ même réponse', (() => { try { return P.peutPreparerSeul(); } catch { return 'leve'; } })(), { auto: true, raison: 'ok' });
    H.v('2. médiane et p95 (échantillons de scans)', [P.mediane([5, 1, 3]), P.mediane([4, 1, 3, 2]), P.p95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), P.mediane([]), P.p95([])], [3, 2.5, 10, null, null]);

    // ═══ 3. les fichiers servis : compressés, revalidables, identiques une fois décompressés ═══
    {
        const app = express(); const router = express.Router();
        H.v('3. (montage) le routeur est monté', routes.monter(router, { modeleEmpreinte: { sha256: 'a'.repeat(64), octets: 118202501 } }, { envBancTelephone: ENV, nomBaseBancTelephone: 'rm_essai' }), true);
        // le brotli du .wasm est calculé AU MONTAGE, en tâche de fond (le premier visiteur ne paie pas ~1 s de CPU, bien plus sur une petite instance)
        await routes.attendrePrechauffage();
        H.v('3. après le montage, le .wasm d\'ORT est DÉJÀ prêt en brotli (préchauffage), le .wasm WebGPU pas encore', [routes.representationsGardees().some(c => /ort-wasm-simd-threaded\.wasm\|br$/.test(c)), routes.representationsGardees().some(c => /asyncify/.test(c))], [true, false]);
        app.use(router); const s = await H.serveur(app);
        // http brut : fetch décompresserait seul, et ce banc doit voir les octets TELS QU'ENVOYÉS
        const http = require('http');
        const get = (chemin, entetes = {}, methode = 'GET') => new Promise((ok, ko) => { http.request(s.url + chemin, { method: methode, headers: entetes }, res => { const morceaux = []; res.on('data', c => morceaux.push(c)); res.on('end', () => { const corps = Buffer.concat(morceaux); ok({ status: res.statusCode, headers: { get: n => (res.headers[n.toLowerCase()] === undefined ? null : String(res.headers[n.toLowerCase()])) }, arrayBuffer: async () => corps, corps }); }); }).on('error', ko).end(); });
        const wasm = '/api/banc/telephone/ort/ort-wasm-simd-threaded.wasm', fichier = fs.readFileSync(path.join(PUB, 'ort', 'ort-wasm-simd-threaded.wasm'));
        let r = await get(wasm, { 'accept-encoding': 'br' }); let corps = Buffer.from(await r.arrayBuffer());
        H.v('3. .wasm avec Accept-Encoding: br ⇒ brotli, Content-Length = octets envoyés, bien plus petit', [r.status, r.headers.get('content-type'), r.headers.get('content-encoding'), Number(r.headers.get('content-length')) === corps.length, corps.length < fichier.length / 3, /Accept-Encoding/i.test(r.headers.get('vary') || '')], [200, 'application/wasm', 'br', true, true, true]);
        H.v('3. le brotli décompressé est le fichier, octet pour octet', Buffer.compare(zlib.brotliDecompressSync(corps), fichier), 0);
        H.v('3. l\'isolement COOP/COEP et CORP sont posés sur la réponse compressée', [r.headers.get('cross-origin-embedder-policy'), r.headers.get('cross-origin-resource-policy')], ['require-corp', 'same-origin']);
        H.v('3. X-Rm-Octets dit la taille DÉCOMPRESSÉE (le client préalloue d\'après elle : fetch décompresse, Content-Length est celui du corps compressé)', r.headers.get('x-rm-octets'), String(fichier.length));
        const shaBrut = require('crypto').createHash('sha256').update(fichier).digest('hex');
        H.v('3. X-Rm-Sha256 = le sha256 du fichier BRUT (pas du corps compressé), sur la réponse compressée', r.headers.get('x-rm-sha256'), shaBrut);
        // la revalidation du moteur (app.js) se fait par HEAD : le sha, la taille et l'étiquette doivent y figurer, sans corps
        const rh = await get(wasm, { 'accept-encoding': 'br' }, 'HEAD');
        H.v('3. HEAD : X-Rm-Sha256, X-Rm-Octets, ETag, isolement présents, AUCUN corps', [rh.status, rh.headers.get('x-rm-sha256'), rh.headers.get('x-rm-octets'), rh.headers.get('etag') === r.headers.get('etag'), rh.headers.get('cross-origin-embedder-policy'), rh.corps.length], [200, shaBrut, String(fichier.length), true, 'require-corp', 0]);
        const etag = r.headers.get('etag');
        H.v('3. un ETag est posé, et le cache est « no-cache » (revalidation à chaque visite, jamais un fichier périmé)', [typeof etag === 'string' && etag.length > 4, /no-cache/.test(r.headers.get('cache-control') || '')], [true, true]);
        r = await get(wasm, { 'accept-encoding': 'br', 'if-none-match': etag });
        H.v('3. If-None-Match identique ⇒ 304 sans corps, isolement toujours posé', [r.status, (await r.arrayBuffer()).byteLength, r.headers.get('cross-origin-embedder-policy')], [304, 0, 'require-corp']);
        H.v('3. le 304 porte aussi X-Rm-Sha256 et X-Rm-Octets (une revalidation HEAD/GET conditionnelle les lit)', [r.headers.get('x-rm-sha256'), r.headers.get('x-rm-octets')], [shaBrut, String(fichier.length)]);
        r = await get(wasm, { 'accept-encoding': 'gzip' }); corps = Buffer.from(await r.arrayBuffer());
        H.v('3. Accept-Encoding: gzip seul ⇒ gzip', [r.headers.get('content-encoding'), Buffer.compare(zlib.gunzipSync(corps), fichier)], ['gzip', 0]);
        r = await get(wasm, { 'accept-encoding': 'identity' }); corps = Buffer.from(await r.arrayBuffer());
        H.v('3. Accept-Encoding: identity ⇒ le fichier tel quel, Content-Length exact, aucun Content-Encoding', [r.headers.get('content-encoding'), Number(r.headers.get('content-length')), corps.length === fichier.length], [null, fichier.length, true]);
        const e2 = r.headers.get('etag'); r = await get(wasm, { 'accept-encoding': 'br' });
        H.v('3. l\'ETag d\'une représentation compressée diffère de celle du fichier brut (deux corps, deux étiquettes)', e2 !== r.headers.get('etag'), true);
        r = await get('/api/banc/telephone/app.js', { 'accept-encoding': 'br, gzip' }); corps = Buffer.from(await r.arrayBuffer());
        H.v('3. app.js compressé lui aussi, décompressé identique', [r.headers.get('content-encoding'), Buffer.compare(zlib.brotliDecompressSync(corps), fs.readFileSync(path.join(PUB, 'app.js')))], ['br', 0]);
        r = await get('/api/banc/telephone/preparation.mjs'); await r.arrayBuffer();
        H.v('3. preparation.mjs est servi (liste fermée, un fichier de plus)', [r.status, r.headers.get('content-type')], [200, 'text/javascript; charset=utf-8']);
        // deux demandes simultanées ne compressent qu'une fois et rendent le même corps
        const [a, b] = await Promise.all([get(wasm, { 'accept-encoding': 'br' }), get(wasm, { 'accept-encoding': 'br' })]);
        H.v('3. deux demandes simultanées ⇒ même ETag, même taille', [a.headers.get('etag') === b.headers.get('etag'), (await a.arrayBuffer()).byteLength === (await b.arrayBuffer()).byteLength], [true, true]);
        await s.fermer();
    }

    // ═══ 4. le dépôt : l'objet `preparation` est une liste fermée ═══
    {
        const base = () => ({ v: 1, runId: '0123456789abcdef', modeleSha: 'a'.repeat(64), ua: 'Mozilla/5.0 (iPhone)', isole: true, coeurs: 6, gpuDispo: false, mesure: { moteur: 'wasm', verdict: 'IDENTIQUE', cosMin: 1 } });
        const prep = { etat: 'pret', auto: true, froid: true, cacheModele: 'manque', cacheWasm: 'manque', cacheEcriture: 'ok', sourceModele: 'reseau', sourceWasm: 'reseau', telechargementModeleMs: 4100, lectureCacheModeleMs: null, verifShaMs: 120, chargementMoteurMs: 40, wasmMs: 1800,
            wasmOctets: 14239897, wasmCompileMs: 380, creationSessionMs: 1100, ouvertureAPretMs: 5200, attenteAvantScanMs: 0, clicAPremierResultatMs: 1500, premierScanMs: 1100, scanSuivantMedianeMs: 900, scanSuivantP95Ms: 1000, nScans: 30, filsSession: 2, stockagePersistant: false, interrompueAvant: false };
        const avec = p => { const d = base(); d.mesure.preparation = p; return S.valider(d); };
        H.v('4. une préparation complète est acceptée', avec(prep).ok, true);
        H.v('4. une préparation vide ou nulle est acceptée (mesure sans préparation : GPU, ancienne page)', [avec(null).ok, avec({}).ok], [true, true]);
        H.v('4. champ inconnu refusé (liste fermée)', avec({ ...prep, secret: 1 }).detail, 'champ-inconnu:mesure.preparation.secret');
        H.v('4. état hors liste refusé', avec({ ...prep, etat: 'magie' }).detail, 'champ:mesure.preparation.etat');
        H.v('4. état du cache hors liste refusé', avec({ ...prep, cacheModele: 'oui' }).detail, 'champ:mesure.preparation.cacheModele');
        H.v('4. durée hors bornes refusée', avec({ ...prep, wasmMs: -1 }).detail, 'champ:mesure.preparation.wasmMs');
        H.v('4. une durée null est permise (mesure absente ≠ zéro)', avec({ ...prep, attenteAvantScanMs: null }).ok, true);
        H.v('4. un objet n\'est pas une chaîne : forme refusée', avec('x').detail, 'champ:mesure.preparation');
        H.v('4. le document le plus chargé reste sous 8 Ko', Buffer.byteLength(JSON.stringify((() => { const d = base(); d.mesure.preparation = prep; return d; })())) < 2000, true);
        // tour 1 : de quoi trancher la cause sur le prochain dépôt iPhone — octets transférés et encodage du .wasm, octets et débit du modèle, mémoire si le navigateur la donne
        const plus = { wasmTransfertOctets: 2700000, wasmCorpsOctets: 2688054, wasmEncodage: 'br', modeleOctets: 118202501, modeleDebitMoS: 27.2, memoireJsPicMo: 183.5, memoireUaMo: 412, raison: 'memoire-faible' };
        // tour 2 : la raison de la garde est déposée (un état « manuel » dit enfin pourquoi)
        H.v('4. la raison de la garde est acceptée (ok, demande, interrompue, echec, inconnu, data-economie, memoire-faible)', ['ok', 'demande', 'interrompue', 'echec', 'inconnu', 'data-economie', 'memoire-faible'].map(r => avec({ ...prep, raison: r }).ok), Array(7).fill(true));
        H.v('4. une raison hors liste ou libre est refusée', [avec({ ...prep, raison: 'parce que' }).detail, avec({ ...prep, raison: 12 }).detail], ['champ:mesure.preparation.raison', 'champ:mesure.preparation.raison']);
        H.v('4. les champs de diagnostic (transferSize, encodedBodySize, encodage du .wasm, octets et débit du modèle, mémoire) sont acceptés', avec({ ...prep, ...plus }).ok, true);
        H.v('4. encodage du .wasm hors liste refusé (br, gzip, identity, inconnu seulement)', avec({ ...prep, ...plus, wasmEncodage: 'zstd' }).detail, 'champ:mesure.preparation.wasmEncodage');
        H.v('4. débit négatif ou octets hors bornes refusés', [avec({ ...prep, modeleDebitMoS: -1 }).detail, avec({ ...prep, wasmTransfertOctets: -5 }).detail, avec({ ...prep, memoireUaMo: 1e9 }).detail], ['champ:mesure.preparation.modeleDebitMoS', 'champ:mesure.preparation.wasmTransfertOctets', 'champ:mesure.preparation.memoireUaMo']);
        H.v('4. ces champs peuvent être null (le navigateur ne donne ni transferSize ni mémoire : absent ≠ zéro)', avec({ ...prep, wasmTransfertOctets: null, wasmCorpsOctets: null, wasmEncodage: null, modeleDebitMoS: null, memoireJsPicMo: null, memoireUaMo: null }).ok, true);
        // la limite de 8 192 octets, avec le dépôt COMPLET d'un passage WebGPU (entrée + diagnostic des pixels + orientation + préparation + détection quand la base la porte) et les champs au plus long
        {
            const s1 = { n: 99999999, max: 255, somme: 99999999999, nDiff: 99999999, moy: 254.999999, pctDiff: 99.999999 };
            const d = base(); d.ua = 'U'.repeat(300); d.gpu = { vendor: 'v'.repeat(40), architecture: 'a'.repeat(40) }; d.reseau = { redirige: true, hoteFinal: 'h'.repeat(80), blocage: 'indetermine-isole' };
            d.modeleOctets = 118202501; d.telechargementMs = 12345678.9; d.verifShaMs = 12345.6; d.shaVerifie = true; d.memoireAppareilGo = 8;
            Object.assign(d.mesure, { moteurDemande: 'webgpu', webgpuDesactive: false, webgpuForce: true, optionsSession: 'o'.repeat(60), webgpuUtilise: true, gardeExtension: 'NON_EVALUEE', erreur: 'e'.repeat(200), jsHeapApresCreationMo: 99999.9, jsHeapFinMo: 99999.9, uaApresCreationMo: 99999, uaFinMo: 99999,
                fils: 4, filsDemandes: 4, creationSessionMs: 9999999.123, premiereMs: 9999999.123, medianeMs: 9999999.123, p95Ms: 9999999.123, pretraitementMedianeMs: 12345.123, nEmpreintes: 30, nVecteursRefuses: 0, cosMin: 0.9999999, cosMoy: 0.9999999, cosMinModeleSeul: 0.9999999, nModeleSeul: 12, cosMinContreWasm: 0.9999999, ecartChaineModele: 0.0000001,
                diagnosticPixels: { cause: 'indetermine', cartesDecodage: 2, cartesChaine: 12, decodage: s1, redimensionnement: s1, chaine: s1, bitmapSansConversion: s1, bitmapAvecConversion: s1, couleurCanvas: 'display-p3-xxxxxx'.slice(0, 20) },
                entree: { chemin: 'mixte', source: 's'.repeat(20), cartesRm: 30, cartesRepli: 0, refus: { FORMAT: 100, TROP_GRAND: 100, DECODAGE: 100, NON_SUPPORTE: 100, 'entree-invalide': 100, memoire: 100, autre: 100 }, identiqueAuBit: true, rgbIdentiquesPil: 12, rgbMesureesPil: 12, cartesComparees: 30, rgbIdentiquesNavigateur: 30, tenseursIdentiquesNavigateur: 30, ecartMaxNavigateur: 255, cosMinNavigateur: 0.9999999, msRmMediane: 99999.9, msNavigateurMediane: 99999.9, cartes640: 3, ms640: 99999.9, empreinte640: 'f'.repeat(12) },
                orientationNavigateur: { webp: 'indetermine', jpeg: 'indetermine' },
                preparation: { ...prep, ...plus, telechargementModeleMs: 12345678.9, lectureCacheModeleMs: 12345678.9, verifShaMs: 12345678.9, chargementMoteurMs: 12345678.9, wasmMs: 12345678.9, wasmCompileMs: 12345678.9, creationSessionMs: 12345678.9, ouvertureAPretMs: 12345678.9, attenteAvantScanMs: 12345678.9, clicAPremierResultatMs: 12345678.9, premierScanMs: 12345678.9, scanSuivantMedianeMs: 12345678.9, scanSuivantP95Ms: 12345678.9, wasmOctets: 2000000000, nScans: 100 } });
            if (S.MESURE.detection) d.mesure.detection = { version: 'v'.repeat(30), nImages: 100, nIdentiques: 100, nRgb640: 100, nQuads: 100, nCartes: 100, voieCanvas: 100, voiePillow: 100, ecarts: 'x'.repeat(200), empreinteLot: 'a'.repeat(64), msOpencv: 9999999.9, msMediane: 9999999.9, msTotal: 9999999.9, jsHeapMo: 99999.9, jsHeapApresMo: 99999.9, wasmHeapMo: 99999.9, erreur: 'e'.repeat(200) };
            const taille = Buffer.byteLength(JSON.stringify(d)), v = S.valider(d);
            H.v(`4. dépôt WebGPU COMPLET${S.MESURE.detection ? ' avec la détection' : ''}, tous champs au plus long (${taille} octets) : accepté, sous 8 192`, [v.ok, taille < S.OCTETS_MAX, v.detail || null], [true, true, null]);
        }
    }

    // ═══ 5. ce que le code de la page doit contenir ═══
    {
        const app = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8').replace(/\/\/.*$/gm, '');
        H.v('5. la page charge le modèle ET le moteur par le cache durable (chargerOctets), avec le moteur fourni à ORT en octets (wasmBinary)', [(app.match(/chargerOctets\(/g) || []).length >= 2, /wasmBinary/.test(app), /import \{[^}]*chargerOctets[^}]*\} from '\.\/preparation\.mjs'/.test(app)], [true, true, true]);
        H.v('5. la préparation se lance à l\'ouverture (peutPreparerSeul) et la page garde une trace d\'une préparation tuée (marqueur)', [/peutPreparerSeul\(/.test(app), /rm-banc-prep/.test(app)], [true, true]);
        H.v('5. un clic avant « prêt » ATTEND et le dit (attenteAvantScanMs), il ne cache pas l\'attente', [/attenteAvantScanMs/.test(app), /clicAPremierResultatMs/.test(app)], [true, true]);
        H.v('5. la session préparée est RÉUTILISÉE par la mesure suivante et libérée avant WebGPU', [/preparerWasm\(/.test(app), /libererSessionPreparee\(/.test(app)], [true, true]);
        H.v('5. une fois la page quittée (pagehide), aucun événement de visibilité ne ré-écrit « pret » ; un retour du cache de navigation (pageshow) le fait', [/quittee\s*=\s*true/.test(app), /if \(quittee\) return/.test(app), /addEventListener\('pageshow'/.test(app)], [true, true, true]);
        H.v('5. le verdict est celui d\'avant : jugerMesure appelé avec les mêmes quatre champs', /jugerMesure\(\{ nEmpreintes: m\.nEmpreintes, nVecteursRefuses: refuses, cos, cosModeleSeul: cosPx, shaVerifie: E\.shaVerifie \}\)/.test(app), true);
        // tour 2 : la LOGIQUE de B1 vit dans preparation.mjs (testée par comportement et par mutation, 1c) ; app.js ne fait que l'appeler — ce test-ci ne vérifie que le CÂBLAGE, et qu'app.js n'a pas gardé sa propre copie de la règle
        H.v('5. (B1, câblage) app.js appelle cleMoteur, verifierMoteur et apresEchecDeSession ; la version vient du bundle chargé ; aucune copie de la règle (sha comparé, clé, éviction) n\'est restée dans app.js', [/cleMoteur\(/.test(app), /verifierMoteur\(/.test(app), /apresEchecDeSession\(/.test(app), /ort\.env\.versions/.test(app), /\bh === sha\b/.test(app), /retirerEntrees\(/.test(app), /\?ort=/.test(app)], [true, true, true, true, false, false, false]);
        H.v('5. (P3-7) le commentaire d\'app.js ne répète plus « c\'était l\'essentiel des ~15 s » sans réserve (cause établie sur PC, hypothèse sur iPhone)', [/c'était l'essentiel des ~15 s/.test(fs.readFileSync(path.join(PUB, 'app.js'), 'utf8')), /HYPOTH/.test(fs.readFileSync(path.join(PUB, 'app.js'), 'utf8'))], [false, true]);
        H.v('5. la raison de la garde est déposée avec la préparation', /raison: E\.prep\.raison|raison: P\.raison/.test(app), true);
        // tour 2, P3-8 : --ref sans --vecs doit ÉCHOUER (code 3), jamais sortir en silence ; le chemin du modèle est faux exprès : l'ancien pilote s'arrêterait en erreur 1 sans rien lancer, le nouveau refuse tout de suite en 3
        {
            const r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'outils', 'banc-telephone', 'pilote-premier-scan.js'), '--ref=inexistant.bin', '--modele=Z:\\n-existe-pas.onnx'], { encoding: 'utf8', timeout: 60000 });
            H.v('5. (P3-8) le pilote refuse --ref sans --vecs : code 3 et un message qui le dit', [r.status, /--ref exige --vecs/.test(r.stdout || '')], [3, true]);
        }
        H.v('5. (B2) la garde reçoit saveData et deviceMemory', [/saveData/.test(app), /deviceMemory/.test(app)], [true, true]);
        H.v('5. (M2) l\'écriture du cache n\'est plus attendue avant la création de la session (attendreEcriture: false, finEcriture)', [/attendreEcriture:\s*false/.test(app), /finEcriture/.test(app)], [true, true]);
        H.v('5. aucun navigator.storage.persist() affiché comme garanti : la page DIT si le stockage est persistant ou non', /stockagePersistant/.test(app), true);
    }

    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
