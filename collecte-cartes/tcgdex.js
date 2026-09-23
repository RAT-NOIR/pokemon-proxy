// ============================================================
// LE CLIENT TCGdex — cadence, réessai borné, garde FERMÉE sur le verrou global (2026-09-23)
// ============================================================
// Une source externe a une cadence et une reprise, SANS EXCEPTION (§38) : le collecteur de logos français a tiré 270
// requêtes d'affilée sur api.tcgdex.net et TCGdex a répondu « no available server » sur 94 sets. Ce module est le
// SEUL chemin vers TCGdex pour le collecteur d'images et pour les illustrateurs.
//   · CADENCE : une file de promesses, `CADENCE_MS` entre deux départs — deux appelants concurrents ne doublent pas le
//     débit, ils attendent leur tour (tenue dans la FILE, jamais dans une boucle d'appelant).
//   · RÉESSAI BORNÉ : un seul, après `REESSAI_MS` ; le second échec LÈVE — une panne longue doit rester visible (§29).
//     Un 404 n'est pas une panne : `null`, sans réessai.
//   · GARDE FERMÉE : aucune requête sans un verrou global LIÉ, tenu et non perdu (`tcgdex/__collecteur__`, propre à
//     cet hôte : ce ne sont ni les serveurs de Bulbagarden ni ceux d'artofpkm, §17). « Pas de verrou » n'est jamais
//     « personne d'autre ne frappe » : ça bloque, et ça le dit.
// ⚠️ 2 s et non 5 : TCGdex est une API faite pour être interrogée, servie par un CDN ; 0,5 requête/s reste loin de ce
// qui l'a fait tomber (270 requêtes en rafale). Le budget de chaque outil se calcule AVANT, et s'imprime.
const axios = require('axios');

const VERROU_GLOBAL = 'tcgdex/__collecteur__';
const VERROU_GLOBAL_MS = 3 * 60 * 1000;
const CADENCE_MS = 2000;
const REESSAI_MS = 5000;
const PAGE = 100;              // TCGdex plafonne la pagination GraphQL à 100
const PAGES_MAX = 30;          // 3 000 cartes : aucun set n'en a autant — au-delà, c'est une boucle, pas un set
const API = 'https://api.tcgdex.net/v2';

const transportAxios = {
    async get(url, { binaire = false } = {}) {
        try { return (await axios.get(url, { timeout: 30000, responseType: binaire ? 'arraybuffer' : 'json', headers: { 'User-Agent': 'rat-market-catalogue/1.0' } })).data; }
        catch (e) { throw Object.assign(new Error(`${e.response?.status ?? e.code} ${url}`), { status: e.response?.status }); }
    },
    async post(url, corps) {
        try { return (await axios.post(url, corps, { timeout: 60000, headers: { 'Content-Type': 'application/json', 'User-Agent': 'rat-market-catalogue/1.0' } })).data; }
        catch (e) { throw Object.assign(new Error(`${e.response?.status ?? e.code} ${url}`), { status: e.response?.status }); }
    }
};

// ⚠️ LE GRAPHQL EST PLUS LOURD QU'UN FICHIER : une page de 100 cartes filtrées « contient » coûte au serveur. Mesuré le
// 2026-09-23 : 503 sur le GraphQL après ~45 requêtes à 2 s (témoin : REST et GraphQL répondaient de nouveau 20 s plus
// tard — une surcharge passagère, pas une panne). Le GraphQL prend donc 5 s, les fichiers du CDN restent à 2 s.
const CADENCE_GRAPHQL_MS = 5000;

function fabriquerClient({ transport = transportAxios, cadenceMs = CADENCE_MS, cadenceGraphqlMs = CADENCE_GRAPHQL_MS, reessaiMs = REESSAI_MS, verrou = null } = {}) {
    let lie = verrou, file = Promise.resolve(), dernierDepart = 0, compte = 0;
    const pause = ms => new Promise(r => setTimeout(r, ms));

    function garde() {
        if (!lie) throw new Error(`TCGdex : aucun verrou global lié (${VERROU_GLOBAL}) — pas de requête sans verrou`);
        if (lie.perdu || !lie.tenu) throw new Error(`TCGdex : verrou global ${lie.perdu ? 'PERDU' : 'non tenu'} — pas de requête sans verrou`);
    }
    function enFile(appel, cadence = cadenceMs) {
        const p = file.then(async () => {
            garde();
            const attente = dernierDepart + cadence - Date.now();
            if (attente > 0) await pause(attente);
            garde();                                       // le verrou a pu être perdu pendant l'attente
            dernierDepart = Date.now(); compte++;
            try { return await appel(); }
            catch (e) {
                if (e.status === 404) return null;
                await pause(reessaiMs);
                garde();
                dernierDepart = Date.now(); compte++;
                try { return await appel(); } catch (e2) { if (e2.status === 404) return null; throw e2; }
            }
        });
        file = p.catch(() => { });
        return p;
    }
    const getJSON = url => enFile(() => transport.get(url));
    const telecharger = url => enFile(() => transport.get(url, { binaire: true })).then(b => b == null ? null : Buffer.from(b));
    const graphql = query => enFile(() => transport.post(`${API}/graphql`, { query }), Math.max(cadenceMs, cadenceGraphqlMs));

    /** Toutes les cartes d'un set anglais, ILLUSTRATEUR COMPRIS : la liste d'un set ne le porte pas, `cards(filters)` si. */
    async function cartesDuSet(id) {
        if (!/^[\w.]+$/.test(id)) throw new Error(`identifiant de set TCGdex inattendu : « ${id} »`);
        const toutes = [];
        for (let p = 1; ; p++) {
            if (p > PAGES_MAX) throw new Error(`${id} : plus de ${PAGES_MAX} pages — une boucle, pas un set`);
            const r = await graphql(`{ cards(filters: { id: "${id}-" }, pagination: { page: ${p}, count: ${PAGE} }) { id localId name illustrator image rarity } }`);
            if (r?.errors?.length) throw new Error(`${id} : GraphQL ${JSON.stringify(r.errors).slice(0, 200)}`);
            const lot = r?.data?.cards || [];
            toutes.push(...lot.filter(c => String(c.id).startsWith(`${id}-`)));   // le filtre est un « contient » : on garde le set exact
            if (lot.length < PAGE) break;
        }
        return toutes;
    }

    return {
        lier(v) { lie = v; },
        getJSON, telecharger, graphql, cartesDuSet,
        setsEn: () => getJSON(`${API}/en/sets`),
        compteRequetes: () => compte
    };
}

module.exports = { fabriquerClient, VERROU_GLOBAL, VERROU_GLOBAL_MS, CADENCE_MS, CADENCE_GRAPHQL_MS, API };
