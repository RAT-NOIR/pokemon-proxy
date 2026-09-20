// ============================================================
// LECTURE SÛRE — « un vide doit coûter une exception, pas un `|| []` »
// ============================================================
// 🔴 LE MOTIF DOMINANT DU CHANTIER, EN UNE PHRASE : une sonde qui ne trouve rien rend EXACTEMENT ce
// que rendrait un monde vide, et ce vide a l'air d'une découverte. Neuf occurrences sont au catalogue
// (§30, §33, §36, §39, §23…), dont CINQ sur le seul dossier du seuil d'images, le 2026-09-21, à
// quelques minutes d'intervalle. Aucune n'a levé d'erreur. Chacune rendait un tableau plausible.
//
// 🔑 ET LE BIAIS A UNE DIRECTION, CE QUI REND LA PARADE POSSIBLE : un repli sur le vide gonfle
// toujours ce qui MANQUE et rabote ce qu'on POSSÈDE. Il ne produit jamais un faux optimisme — il
// produit un faux CHANTIER, et on se met au travail dessus.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// CE QUE CE MODULE N'EST PAS, ET IL FAUT LE LIRE AVANT DE S'EN SERVIR
// ────────────────────────────────────────────────────────────────────────────────────────────────
// Ce n'est PAS « lever quand une requête rend 0 document ». Ce serait faux et ce serait contourné
// dans la journée (§25 : un contrôle qui crie sur un cas normal est contourné le jour où il a
// raison). Un set sans carte, une file sans unité en attente, un reste vide sont des zéros JUSTES,
// et ils sont fréquents.
//
// 🔑 CE QUI DISTINGUE LES CINQ VRAIS DÉFAUTS DES ZÉROS LÉGITIMES N'EST PAS LE RÉSULTAT, C'EST LE
// DÉNOMINATEUR. Les cinq ont tous la même forme : **une population non vide, et une intersection
// vide avec elle.** 552 documents dans `collecte_etat`, et ma clé en apparie 0. 42 sets refusés,
// et 0 portent le champ que je lis. Un export de module qui existe, et le nom que je demande n'y
// est pas. **Zéro sur zéro est normal ; zéro sur 552 est une clé fausse.**
//
// C'est la règle « TOUT OUTIL DE MESURE IMPRIME SON DÉNOMINATEUR » (§3) rendue MÉCANIQUE : le
// dénominateur ne s'imprime plus à côté du résultat en espérant que quelqu'un le lise, il est
// CALCULÉ et il LÈVE.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// L'ÉCHAPPATOIRE EST DÉLIBÉRÉE, ET ELLE DOIT RESTER BON MARCHÉ
// ────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ Toute fonction accepte `{ videAutorise: '<raison>' }`. Une garde sans sortie de secours se fait
// retirer, pas satisfaire — et le contournement qu'on choisit sous la pression est toujours pire que
// celui qu'on a prévu. Mais la raison est OBLIGATOIRE (une chaîne vide est refusée) et elle est
// IMPRIMÉE quand le vide survient : « 0 sur 552, vide autorisé parce que … ». Le coût du
// contournement n'est donc pas un effort, c'est une PHRASE qu'on doit pouvoir écrire — et c'est
// exactement le moment où l'on s'aperçoit qu'on n'en a pas.
const PREFIXE = '🔴 LECTURE VIDE';

const estVide = v => v == null || (Array.isArray(v) && !v.length) || (v instanceof Map && !v.size) || (v instanceof Set && !v.size);
const taille = v => v == null ? 0 : (Array.isArray(v) ? v.length : (v.size ?? 1));

function autoriser(videAutorise, quoi, n, sur) {
    if (videAutorise === undefined) return false;
    if (typeof videAutorise !== 'string' || !videAutorise.trim())
        throw new Error(`${PREFIXE} · \`videAutorise\` doit porter une RAISON écrite, pas \`true\`. ${quoi}`);
    console.warn(`   ⚪ vide autorisé — ${quoi} : ${n} sur ${sur}. Raison écrite : « ${videAutorise} »`);
    return true;
}

// ── 1. UN CHAMP D'OBJET ──────────────────────────────────────────────────────────────────────────
// L'occurrence : `require('./table-sets.js').TABLE_SETS` — l'export s'appelle `TABLE`. Le champ
// n'existe pas, `|| []` en fait un résultat plausible, le `catch {}` avalerait même l'erreur.
// « 152 expansions, 9 144 produits sans ligne » ; réel : 134 / 8 467. **Trois protections qui,
// ensemble, garantissent qu'aucune faute ne se voie.**
// 🔑 Ce que cette fonction ajoute à un accès nu : elle IMPRIME LES NOMS DISPONIBLES. C'est ce qui
// transforme « undefined » en « tu voulais TABLE ».
function champ(objet, nom, { de = 'objet', videAutorise } = {}) {
    if (objet == null) throw new Error(`${PREFIXE} · ${de} est ${objet} — on ne peut pas y lire \`${nom}\`.`);
    const v = objet[nom];
    if (v !== undefined && !estVide(v)) return v;
    const dispo = Object.keys(objet).slice(0, 40).join(', ') || '(aucune)';
    const quoi = `\`${nom}\` sur ${de}`;
    if (v === undefined) {
        if (autoriser(videAutorise, quoi, 'absent', `clés disponibles : ${dispo}`)) return v;
        throw new Error(`${PREFIXE} · \`${nom}\` N'EXISTE PAS sur ${de}.\n   clés disponibles : ${dispo}\n   → c'est le NOM qui est faux, pas la donnée qui manque.`);
    }
    if (autoriser(videAutorise, quoi, 0, 'le champ existe')) return v;
    throw new Error(`${PREFIXE} · \`${nom}\` existe sur ${de} mais est VIDE.\n   → si c'est normal, écrire \`videAutorise: '<raison>'\`.`);
}

// ── 2. UN CHAMP SUR UNE POPULATION DE DOCUMENTS ─────────────────────────────────────────────────
// Les occurrences 2 et 3 du dossier du seuil : `completImages.mesures` (le champ est `mesures`) puis
// `mesures` sur des sets Bulbapedia (leur champ est `infosListe`). Les deux ont rendu « 0 largeur
// mesurée » sur 42 documents bien présents.
// 🔑 LE DÉNOMINATEUR EST ICI LE NOMBRE DE DOCUMENTS, ET C'EST LUI QUI TRANCHE : 0 document sur 42
// porte le champ → c'est le nom. 7 sur 42 → c'est une population hétérogène, et c'est une
// INFORMATION, pas une panne. Le seuil est donc « strictement zéro », jamais un pourcentage : un
// taux demanderait un réglage, et un réglage se discute.
function champSur(documents, chemin, { collection = 'documents', videAutorise } = {}) {
    const docs = Array.isArray(documents) ? documents : [...documents];
    const lire = d => chemin.split('.').reduce((o, k) => (o == null ? o : o[k]), d);
    const porteurs = docs.filter(d => { const v = lire(d); return v !== undefined && !estVide(v); });
    if (porteurs.length) return porteurs;
    const quoi = `\`${chemin}\` sur ${collection}`;
    if (!docs.length) {
        if (autoriser(videAutorise, quoi, 0, '0 document')) return porteurs;
        throw new Error(`${PREFIXE} · ${collection} ne contient AUCUN document — la question sur \`${chemin}\` n'a pas de sens.`);
    }
    if (autoriser(videAutorise, quoi, 0, `${docs.length} documents`)) return porteurs;
    const dispo = [...new Set(docs.slice(0, 20).flatMap(d => Object.keys(d || {})))].slice(0, 40).join(', ');
    throw new Error(`${PREFIXE} · 0 des ${docs.length} documents de ${collection} portent \`${chemin}\`.\n   champs réellement présents : ${dispo}\n   → zéro sur ${docs.length}, ce n'est pas une population sans la donnée, c'est un NOM DE CHAMP faux.`);
}

// ── 3. UN APPARIEMENT ENTRE DEUX POPULATIONS ────────────────────────────────────────────────────
// La fonction la plus rentable des trois : elle aurait attrapé QUATRE des neuf occurrences.
//   · `file_images._id` (un CODE de set) apparié à un `slugSet` — deux collections sans clé commune,
//     tous les comptes de produits à 0 ;
//   · `collecte_etat._id` (un slugSet) cherché par CODE — « 0 collectées » sur 34 lignes dont 16
//     étaient faites ;
//   · la clé par le NOM sur les sets chinois — 0 paire sur 49, parce que les deux sources traduisent
//     chacune de leur côté (§39) ;
//   · le slug Cardmarket apparié au nom Bulbapedia sur les Trainer Kits — « 4 kits sans aucune carte
//     déclarante », alors que 10 sur 11 ont les leurs (§34).
// ⚠️ ET ELLE REND AUSSI LE TAUX, PARCE QUE LE DÉFAUT N'EST PAS TOUJOURS TOTAL. Une clé qui apparie
// 3 % n'est pas moins fausse qu'une clé qui apparie 0 % ; elle est seulement plus difficile à voir.
// `seuilBas` ne LÈVE pas — il AVERTIT : au-dessus de zéro, c'est un jugement, et un jugement qui
// s'arme tout seul devient un réglage qu'on baisse (§23).
function apparier(clesGauche, clesDroite, { gauche = 'gauche', droite = 'droite', cle = 'clé', seuilBas = 0.1, videAutorise } = {}) {
    const G = [...new Set([...clesGauche].map(String))];
    const D = new Set([...clesDroite].map(String));
    const trouvees = G.filter(k => D.has(k));
    const taux = G.length ? trouvees.length / G.length : 0;
    const quoi = `${gauche} → ${droite} par ${cle}`;
    if (!G.length || !D.size) {
        if (autoriser(videAutorise, quoi, 0, `${G.length} × ${D.size}`)) return { trouvees, taux, manquantes: G };
        throw new Error(`${PREFIXE} · appariement impossible : ${gauche} a ${G.length} clés, ${droite} en a ${D.size}.`);
    }
    if (!trouvees.length) {
        if (autoriser(videAutorise, quoi, 0, `${G.length} × ${D.size}`)) return { trouvees, taux, manquantes: G };
        throw new Error(`${PREFIXE} · 0 des ${G.length} clés de ${gauche} se retrouvent parmi les ${D.size} de ${droite} (par ${cle}).\n`
            + `   exemples à gauche : ${G.slice(0, 4).join(' · ')}\n`
            + `   exemples à droite : ${[...D].slice(0, 4).join(' · ')}\n`
            + `   → une intersection RIGOUREUSEMENT vide entre deux populations non vides est une CLÉ FAUSSE, pas une absence.`);
    }
    if (taux < seuilBas)
        console.warn(`   ⚠️ appariement FAIBLE — ${quoi} : ${trouvees.length}/${G.length} = ${(taux * 100).toFixed(1)} %. Une clé qui apparie peu est souvent une clé fausse qui a eu de la chance ; ouvrir trois paires avant de s'en servir (§22).`);
    return { trouvees, taux, manquantes: G.filter(k => !D.has(k)) };
}

// ── 4. UNE REQUÊTE MONGO ────────────────────────────────────────────────────────────────────────
// 🔑 LA SIGNATURE IMPOSE LE DÉNOMINATEUR : on ne peut pas appeler cette fonction sans dire sur quoi
// la requête restreint. Elle compte `sur` (la population AVANT filtre) et lève quand le filtre rend
// 0 sur une population non vide — c'est-à-dire quand c'est le FILTRE qui est faux.
// ⚠️ Un `countDocuments({})` de plus par lecture est le prix, et il est payé volontiers : les cinq
// vides du 2026-09-21 ont coûté plus d'une heure chacun.
async function lireMongo(collection, filtre, { nom, videAutorise, projection } = {}) {
    const etiquette = nom || collection.collectionName || 'collection';
    const docs = await collection.find(filtre, projection ? { projection } : {}).toArray();
    if (docs.length) return docs;
    const sur = await collection.countDocuments({});
    const quoi = `${etiquette} filtré par ${JSON.stringify(filtre).slice(0, 200)}`;
    if (!sur) {
        if (autoriser(videAutorise, quoi, 0, 'collection vide')) return docs;
        throw new Error(`${PREFIXE} · la collection ${etiquette} est ENTIÈREMENT VIDE (0 document). Ce n'est pas un résultat de filtre.`);
    }
    if (autoriser(videAutorise, quoi, 0, `${sur} documents`)) return docs;
    const echantillon = await collection.findOne({});
    throw new Error(`${PREFIXE} · 0 document sur ${sur} dans ${etiquette} passent le filtre ${JSON.stringify(filtre).slice(0, 200)}.\n`
        + `   champs d'un document réel : ${Object.keys(echantillon || {}).slice(0, 30).join(', ')}\n`
        + `   → zéro sur ${sur}, on ouvre le FILTRE avant de conclure à une absence.`);
}

module.exports = { champ, champSur, apparier, lireMongo, estVide, taille };
