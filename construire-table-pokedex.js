// ============================================================
// CONSTRUCTION DE LA TABLE nom de carte -> numéro(s) de Pokédex
// ============================================================
// À LANCER UNE FOIS. Le résultat est versionné (pokedex-dexids.json) : la correspondance
// espèce -> numéro national ne change qu'à chaque nouvelle génération, soit tous les trois
// ans. Une requête réseau au démarrage du serveur pour une donnée aussi stable serait un
// point de panne gratuit.
//
// POURQUOI CETTE TABLE PLUTÔT QUE LE CHAMP `dexId` DE TCGDEX. Les deux existent, et on se
// sert des deux. `dexId` est déjà dans la charge utile d'une carte trouvée — gratuit, mais
// disponible TROP TARD : la règle doit s'appliquer AVANT que le numéro serve de clé de
// recherche, donc avant d'avoir la moindre carte. D'où la table locale.
//
// CE QU'ELLE CONTIENT. /v2/en/dex-ids/{n} rend toutes les cartes portant ce numéro, avec
// leur nom COMPLET : « Ditto », mais aussi « Koga's Ditto », « Ditto V », « Ditto ◇ ».
// La table porte donc les noms de dresseur sans qu'on ait à isoler l'espèce — c'est
// exactement ce qu'il faut pour « Koga's Ditto » lu au n°132.
//
// USAGE : node construire-table-pokedex.js

const fs = require('fs');
const axios = require('axios');
const { normaliserNomPourComparaison } = require('./scoring');

const SORTIE = 'pokedex-dexids.json';

(async () => {
    const ids = (await axios.get('https://api.tcgdex.net/v2/en/dex-ids', { timeout: 20000 })).data;
    console.log(`${ids.length} numéros de Pokédex à parcourir.`);

    const table = new Map();
    // Par lots de 20 : ~70 ms par appel, l'ensemble tient en une dizaine de secondes sans
    // ouvrir 1025 connexions d'un coup.
    for (let i = 0; i < ids.length; i += 20) {
        await Promise.all(ids.slice(i, i + 20).map(async n => {
            try {
                const r = await axios.get(`https://api.tcgdex.net/v2/en/dex-ids/${n}`, { timeout: 20000 });
                for (const c of (r.data?.cards || [])) {
                    const k = normaliserNomPourComparaison(String(c.name).split('[')[0]);
                    if (!k) continue;
                    if (!table.has(k)) table.set(k, new Set());
                    table.get(k).add(n);
                }
            } catch (e) {
                console.warn(`⚠️ dexId ${n} : ${e.message}`);
            }
        }));
        process.stdout.write(`   ${Math.min(i + 20, ids.length)}/${ids.length}\r`);
    }

    const objet = Object.fromEntries([...table].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [k, [...v].sort((x, y) => x - y)]));
    fs.writeFileSync(SORTIE, JSON.stringify(objet, null, 0), 'utf8');
    const octets = fs.statSync(SORTIE).size;
    console.log(`\n${SORTIE} écrit : ${table.size} noms, ${(octets / 1024).toFixed(0)} Ko.`);

    // Contrôle sur les cas qui ont motivé la table — pris sur des annonces réelles.
    for (const [nom, attendu] of [['Raichu', 26], ["Koga's Ditto", 132], ['Tangela', 114],
    ['Jigglypuff', 39], ['Dragonite', 149], ['Light Jolteon', 135], ['Mew', 151]]) {
        const v = objet[normaliserNomPourComparaison(nom)];
        console.log(`   ${nom.padEnd(15)} -> ${v ? v.join('/') : 'ABSENT'}   ${v && v.includes(attendu) ? '✅' : '❌ attendu ' + attendu}`);
    }
})().catch(e => { console.error('ERREUR', e.message); process.exit(1); });
