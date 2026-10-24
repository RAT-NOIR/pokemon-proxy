'use strict';
// node audit-catalogue\generer-liste-nouveaux.js — S8\NOUVEAUX\LISTE.html : les 29 pages Cardmarket à ouvrir pour les 231 produits nouveaux,
// avec, pour chaque page, combien de produits restent à apprendre et combien sont déjà appris en base.
// Entrées : S8\NOUVEAUX\PAGES-UTILES-NOUVEAUX.json (pages, cibles) et S8\NOUVEAUX\LISTE-NOUVEAUX.json (les 231 produits).
// LECTURE SEULE : base `test`, collection `numeros_cartes`, par MONGODB_LECTURE_URI (utilisateur de lecture). Aucune écriture en base,
// aucune requête réseau hors de cette base. N'imprime jamais d'URI.
// Un produit est APPRIS quand numeros_cartes porte son idProduct avec un slug. Une page est RELEVÉE quand tous ses produits à apprendre sont appris.
const fs = require('fs');
const path = require('path');
const { autoriser } = require('../collecte-cartes/garde-ecriture');
const { lireMongo } = require('../collecte-cartes/lecture-sure');

const RACINE = 'C:\\Users\\Yung\\Desktop\\pokemon-proxy';
require(path.join(RACINE, 'node_modules', 'dotenv')).config({ path: path.join(RACINE, '.env'), quiet: true });
const { MongoClient } = require(path.join(RACINE, 'node_modules', 'mongodb'));

const DOSSIER = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S8\\NOUVEAUX';
const ATTENDU_PAGES = 29, ATTENDU_PRODUITS = 231, COUPURE_SESSION_1 = 20;
const BASE = 'test', COLLECTION = 'numeros_cartes';
const CARDMARKET = 'https://www.cardmarket.com';
const LIEU_COMMANDE = 'node audit-catalogue\\generer-liste-nouveaux.js';

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const lire = f => JSON.parse(fs.readFileSync(path.join(DOSSIER, f), 'utf8'));

// ── le HTML : la page et son petit script de clics (localStorage, try/catch) ────────────────
const STYLE = `
:root{--bg:#fff;--fg:#1a1a1a;--mut:#666;--bd:#ccc;--lien:#0b57d0;--ok:#1b7f3b;--avis:#fff7d6}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#161616;--fg:#eee;--mut:#aaa;--bd:#444;--lien:#8ab4f8;--ok:#5fd187;--avis:#2b2610}}
:root[data-theme="dark"]{--bg:#161616;--fg:#eee;--mut:#aaa;--bd:#444;--lien:#8ab4f8;--ok:#5fd187;--avis:#2b2610}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 8px}
h2{font-size:16px;margin:20px 0 6px;border-bottom:1px solid var(--bd);padding-bottom:4px}
.compteur{font-weight:700;margin:0 0 10px}
.mut{color:var(--mut)}
.avis{background:var(--avis);border:1px solid var(--bd);border-radius:6px;padding:8px 12px;margin:10px 0}
.avis ul{margin:4px 0 0 18px;padding:0}
ol{margin:0;padding-left:0;list-style:none}
li{padding:6px 0;border-bottom:1px solid var(--bd);display:flex;gap:8px;flex-wrap:wrap;align-items:baseline}
li a{color:var(--lien);text-decoration:none}
li a:hover{text-decoration:underline}
li .cpt{color:var(--mut);font-size:13px}
li.releve .texte{text-decoration:line-through;opacity:.6}
li.releve .cpt{text-decoration:line-through;opacity:.6}
li.releve .etat{color:var(--ok);font-weight:700;font-size:13px}
li.ouvert a{color:var(--mut)}
.bouton{font:inherit;padding:6px 12px;border:1px solid var(--bd);background:var(--bg);color:var(--fg);border-radius:6px;cursor:pointer;margin-top:10px}
footer{margin-top:24px;color:var(--mut);font-size:13px}
code{font-size:13px}
`;

const CLIENT = `
(function () {
  var CLE = 'liste-nouveaux-ouverts-v1', ouverts = {};
  try { ouverts = JSON.parse(localStorage.getItem(CLE) || '{}') || {}; } catch (e) { ouverts = {}; }
  function sauve() { try { localStorage.setItem(CLE, JSON.stringify(ouverts)); } catch (e) {} }
  function appliquer() {
    document.querySelectorAll('li[data-ordre]').forEach(function (li) {
      li.classList.toggle('ouvert', !!ouverts[li.dataset.ordre] && !li.classList.contains('releve'));
    });
  }
  document.querySelectorAll('a[data-ordre]').forEach(function (a) {
    a.addEventListener('click', function () { ouverts[a.dataset.ordre] = new Date().toISOString(); sauve(); appliquer(); });
  });
  var r = document.getElementById('reinit');
  if (r) r.addEventListener('click', function () { ouverts = {}; sauve(); appliquer(); });
  appliquer();
})();
`;

function ligne(p) {
    const classes = [p.releve ? 'releve' : ''].filter(Boolean).join(' ');
    const etiquette = p.code || p.slugSet
        ? `${p.idExpansion} ${esc(p.code || '')} ${esc(p.slugSet || '')}`.replace(/\s+/g, ' ').trim()
        : `${p.idExpansion} (expansion nouvelle, page du filtre)`;
    const sens = p.tri === 'name_desc' ? '↓ ' : '';
    const texte = `${p.ordre}. ${etiquette} — ${sens}page ${p.site || 1}`;
    return `<li data-ordre="${p.ordre}" class="${classes}"><a href="${esc(CARDMARKET + p.url)}" target="_blank" rel="noopener" data-ordre="${p.ordre}"><span class="texte">${esc(texte)}</span></a>`
        + ` <span class="cpt">${p.nCibles} à apprendre · ${p.nApris} déjà appris</span>`
        + (p.releve ? ` <span class="etat">relevée</span>` : '')
        + `</li>`;
}

function html({ pages, releves, appris, total, genere, sessions }) {
    const bloc = (titre, xs) => `<h2>${esc(titre)}</h2>\n<ol>\n${xs.map(ligne).join('\n')}\n</ol>`;
    return '<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n'
        + '<title>Pages à ouvrir — 231 produits</title>\n<style>' + STYLE + '</style></head><body>\n'
        + '<h1>Pages Cardmarket à ouvrir — 231 produits nouveaux</h1>\n'
        + `<p class="compteur">pages relevées ${releves} / ${pages.length} · produits appris ${appris} / ${total} · généré le ${esc(genere)}</p>\n`
        + '<div class="avis"><b>À savoir</b><ul>'
        + '<li>Ouvre chaque lien, attends l\'envoi (panneau du userscript), passe au suivant. Lien gris = ouvert chez toi, pas prouvé en base ; lien barré = prouvé en base.</li>'
        + '<li>Page vide : ne pas insister, le dire. Les 104 produits de 6922 n\'ont aucune offre au guide du 24/10 : ces 4 pages peuvent être vides.</li>'
        + '<li>« Page déjà apprise » dans le panneau : clique « Apprendre cette page », sinon rien ne part et les produits nouveaux ne sont pas lus.</li>'
        + '<li>Si une page n\'a pas le produit attendu, regarde la page d\'à côté dans le même tri (la page calculée se trompe d\'une page environ 7 % du temps).</li>'
        + '</ul></div>\n'
        + bloc(sessions[0].titre, sessions[0].pages)
        + '\n' + bloc(sessions[1].titre, sessions[1].pages)
        + '\n<button id="reinit" class="bouton">réinitialiser les clics</button>\n'
        + `<footer>Régénérer : <code>${LIEU_COMMANDE}</code>, depuis le worktree <code>C:\\Users\\Yung\\rat-market-travail\\catalogue\\c-audit</code>. Lecture seule de la base de test.</footer>\n`
        + '<script>' + CLIENT + '</script>\n</body></html>\n';
}

(async function main() {
    // ── 1. les fichiers de la passe : 29 pages, 231 produits, et les cibles de chaque page
    const pagesJson = lire('PAGES-UTILES-NOUVEAUX.json'), listeJson = lire('LISTE-NOUVEAUX.json');
    if (pagesJson.pages.length !== ATTENDU_PAGES) throw new Error(`PAGES-UTILES-NOUVEAUX.json : ${pagesJson.pages.length} pages, ${ATTENDU_PAGES} attendues`);
    const produits = listeJson.pourTaPasse.produits;
    if (produits.length !== ATTENDU_PRODUITS) throw new Error(`LISTE-NOUVEAUX.json : ${produits.length} produits, ${ATTENDU_PRODUITS} attendus`);
    const cadre = new Set(produits.map(p => Number(p.idProduct)));
    const union = new Set();
    for (const pg of pagesJson.pages) for (const c of pg.cibles) {
        const id = Number(c.idProduct);
        if (!cadre.has(id)) throw new Error(`cible ${id} (page ${pg.ordre}) absente de LISTE-NOUVEAUX.json`);
        union.add(id);
    }
    if (union.size !== ATTENDU_PRODUITS) throw new Error(`les cibles des pages couvrent ${union.size} produits, ${ATTENDU_PRODUITS} attendus`);
    console.log(`passe : ${pagesJson.pages.length} pages · ${union.size} produits couverts par les cibles`);

    // ── 2. la base, en lecture seule : quels produits sont appris (idProduct + slug présent)
    const uri = process.env.MONGODB_LECTURE_URI;
    if (!uri) throw new Error('MONGODB_LECTURE_URI absente du .env');
    const client = new MongoClient(uri);
    let apris;
    try {
        await client.connect();
        const coll = client.db(BASE).collection(COLLECTION);
        const sur = await coll.estimatedDocumentCount();
        if (!sur) throw new Error(`${COLLECTION} est VIDE dans la base ${BASE} : grappe ou base fausse, arrêt`);
        const ids = [...union];
        // idProduct est lu en nombre ET en texte : la collection n'a pas à être homogène
        const filtre = { idProduct: { $in: [...ids, ...ids.map(String)] }, slug: { $nin: [null, ''] } };
        const docs = await lireMongo(coll, filtre, {
            nom: COLLECTION, projection: { _id: 0, idProduct: 1 },
            videAutorise: 'produits jamais appris par le générateur : zéro document attendu quand rien n\'est encore appris, le compte reste exact',
        });
        apris = new Set(docs.map(d => Number(d.idProduct)));
    } finally {
        await client.close().catch(() => {});
    }

    // ── 3. les pages, avec leurs comptes et leur état
    const pages = pagesJson.pages.map(pg => {
        const cibles = pg.cibles.map(c => Number(c.idProduct));
        const nApris = cibles.filter(id => apris.has(id)).length;
        return { ...pg, nCibles: cibles.length, nApris, releve: cibles.length > 0 && nApris === cibles.length };
    }).sort((a, b) => a.ordre - b.ordre);
    const sessions = [
        { titre: '', pages: pages.filter(p => p.ordre <= COUPURE_SESSION_1) },
        { titre: '', pages: pages.filter(p => p.ordre > COUPURE_SESSION_1) },
    ];
    const compte = xs => { const s = new Set(); for (const p of xs) for (const c of pagesJson.pages.find(q => q.ordre === p.ordre).cibles) s.add(Number(c.idProduct)); return s.size; };
    const s1 = compte(sessions[0].pages), s2 = compte(sessions[1].pages);
    sessions[0].titre = `Session 1 — ${sessions[0].pages.length} pages, ${s1} produits (expansions 6922 puis 6328)`;
    sessions[1].titre = `Session 2 — ${sessions[1].pages.length} pages, ${s2} produits (les autres expansions)`;
    console.log(`session 1 : ${sessions[0].pages.length} pages, ${s1} produits · session 2 : ${sessions[1].pages.length} pages, ${s2} produits`);
    if (s1 !== 217 || s2 !== 14) throw new Error(`sessions : ${s1} et ${s2} produits, 217 et 14 attendus (le .md)`);

    const releves = pages.filter(p => p.releve).length;
    const appris = [...union].filter(id => apris.has(id)).length;
    const genere = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    for (const p of pages) console.log(`  ${String(p.ordre).padStart(2)} · ${p.idExpansion} · site ${p.site || 1}${p.tri === 'name_desc' ? ' ↓' : ''} · ${p.nCibles} à apprendre · ${p.nApris} appris${p.releve ? ' · RELEVÉE' : ''}`);
    console.log(`pages relevées ${releves} / ${pages.length} · produits appris ${appris} / ${ATTENDU_PRODUITS} · généré le ${genere}`);

    // ── 4. l'écriture : une seule, LISTE.html, dans S8\NOUVEAUX
    const sortie = autoriser(path.join(DOSSIER, 'LISTE.html'), [DOSSIER]);
    fs.writeFileSync(sortie, html({ pages, releves, appris, total: ATTENDU_PRODUITS, genere, sessions }), 'utf8');
    console.log(`écrit : ${sortie}`);
})().catch(e => { console.error(String(e && e.message || e)); process.exit(1); });
