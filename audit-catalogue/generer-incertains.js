'use strict';
// node audit-catalogue/generer-incertains.js — LA PAGE DES 53 INCERTAINS, pour le testeur (24/10).
// Entrées : S8\AUDIT\audit-produits.json (classeVisuel === 'INCERTAIN', compte attendu 53) et S8\AUDIT\etat-produits.json (clé R2 de notre vignette).
// Sorties, dans S8\AUDIT\incertains\ seulement : incertains-53.json et incertains.html (autonome, sans réseau).
// LECTURE SEULE : aucune requête réseau, aucune écriture en base. Aucune copie des vignettes Cardmarket : elles sont référencées par file:/// sur leur chemin disque.
// Notre vignette : S8\AUDIT\cache-nos-vignettes\<sha1(cleR2)>.webp, même règle que lancer-livrable.js (cheminNous), SANS son téléchargement :
// un fichier absent arrête le script, il n'est jamais récupéré ici.
// La copie Cardmarket : indexerDisque() de collecte-cartes/staff-detect-io.js (racine CARDMARKET IMAGE, lecture seule).
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL, fileURLToPath } = require('url');
const { sortie, ecrireJson, lireJson } = require('./ecrire');
const { indexerDisque } = require('../collecte-cartes/staff-detect-io');

const ATTENDU = 53;
const PAGE = 'incertains-53';
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const urlFichier = p => pathToFileURL(p).href;
const virgule = x => x.toFixed(3).replace('.', ',');

const CLIENT = `
(function () {
  var D = window.DONNEES || [], N = D.length, CLE = 'incertains-53-v1', rep = {}, cur = 0;
  try { rep = JSON.parse(localStorage.getItem(CLE) || '{}') || {}; } catch (e) { rep = {}; }
  function sauve() { try { localStorage.setItem(CLE, JSON.stringify(rep)); } catch (e) {} }
  var L = document.getElementById('liste'), Z = document.getElementById('zoom'), ZI = Z.querySelector('img');
  function zoom(src) { ZI.src = src; Z.style.display = 'block'; }
  Z.onclick = function () { Z.style.display = 'none'; };
  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function figure(titre, src, alt) {
    var f = el('figure', 'fig');
    f.appendChild(el('figcaption', 'mut', titre));
    var img = el('img'); img.src = src; img.alt = alt; img.loading = 'lazy';
    img.onclick = function () { zoom(src); };
    f.appendChild(img);
    return f;
  }
  var boutons = [['bon', 'Bon visuel (B)'], ['faux', 'Faux (F)'], ['nsp', 'Je ne sais pas (N)']];
  function poser(i, verdict) {
    rep[D[i].idProduct] = { verdict: verdict, le: new Date().toISOString() };
    sauve(); cur = i; rendre();
    if (i + 1 < N) aller(i + 1);
  }
  D.forEach(function (d, i) {
    var r = el('section', 'cas'); r.id = 'c' + i;
    var entete = el('header', 'entete');
    entete.appendChild(el('span', 'rang', d.rang + ' / ' + N));
    entete.appendChild(el('b', 'idp', 'idProduct ' + d.idProduct));
    entete.appendChild(el('span', 'nom', d.nom));
    entete.appendChild(el('span', 'mut', d.set + ' · distance d = ' + d.distanceAff));
    r.appendChild(entete);
    var visuels = el('div', 'visuels');
    visuels.appendChild(figure('notre visuel', d.nous, 'notre visuel de ' + d.idProduct));
    visuels.appendChild(figure('vignette Cardmarket (copie locale)', d.cm, 'vignette Cardmarket de ' + d.idProduct));
    r.appendChild(visuels);
    var ligne = el('div', 'rep');
    boutons.forEach(function (b) {
      var bt = el('button', null, b[1]); bt.dataset.v = b[0];
      bt.onclick = function () { poser(i, b[0]); };
      ligne.appendChild(bt);
    });
    r.appendChild(ligne);
    L.appendChild(r);
  });
  function rendre() {
    var n = 0;
    D.forEach(function (d, i) {
      var r = document.getElementById('c' + i), x = rep[d.idProduct];
      r.classList.toggle('cur', i === cur);
      if (x) n++;
      r.querySelectorAll('button').forEach(function (bt) { bt.classList.toggle('on', !!x && x.verdict === bt.dataset.v); });
    });
    document.getElementById('compteur').textContent = n + ' / ' + N + ' étiquetés';
  }
  function aller(i) {
    if (!N) return;
    cur = Math.max(0, Math.min(N - 1, i)); rendre();
    document.getElementById('c' + cur).scrollIntoView({ block: 'start' });
  }
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (Z.style.display === 'block') { if (e.key === 'Escape') Z.style.display = 'none'; return; }
    var k = e.key.toLowerCase();
    if (k === 'b') poser(cur, 'bon');
    else if (k === 'f') poser(cur, 'faux');
    else if (k === 'n') poser(cur, 'nsp');
    else if (e.key === 'ArrowDown') { e.preventDefault(); aller(cur + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); aller(cur - 1); }
  });
  document.getElementById('enreg').onclick = function () {
    var reponses = {};
    D.forEach(function (d) { if (rep[d.idProduct]) reponses[String(d.idProduct)] = rep[d.idProduct]; });
    var exp = { page: PAGE, exporteLe: new Date().toISOString(), reponses: reponses };
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(exp, null, 1)], { type: 'application/json' }));
    a.download = 'incertains-53.json'; document.body.appendChild(a); a.click(); a.remove();
    document.getElementById('msg').textContent = Object.keys(reponses).length + ' réponses enregistrées (dossier Téléchargements)';
  };
  var premier = D.findIndex(function (d) { return !rep[d.idProduct]; });
  cur = premier < 0 ? 0 : premier; rendre(); if (N) aller(cur);
})();
`;

const STYLE = `
:root{--bg:#fff;--fg:#1a1a1a;--mut:#666;--bd:#ccc;--ok:#1b7f3b;--ko:#b3261e;--nsp:#8a6d00;--cur:#e8f0fe}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#161616;--fg:#eee;--mut:#aaa;--bd:#444;--ok:#5fd187;--ko:#f28b82;--nsp:#e6c35c;--cur:#223049}}
:root[data-theme="dark"]{--bg:#161616;--fg:#eee;--mut:#aaa;--bd:#444;--ok:#5fd187;--ko:#f28b82;--nsp:#e6c35c;--cur:#223049}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.4 system-ui,sans-serif}
header.haut{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--bd);padding:8px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;z-index:5}
#compteur{font-weight:700}
.mut{color:var(--mut)}
button{font:inherit;padding:6px 12px;border:1px solid var(--bd);background:var(--bg);color:var(--fg);border-radius:6px;cursor:pointer}
button[data-v="bon"].on{background:var(--ok);color:#fff;border-color:var(--ok)}
button[data-v="faux"].on{background:var(--ko);color:#fff;border-color:var(--ko)}
button[data-v="nsp"].on{background:var(--nsp);color:#fff;border-color:var(--nsp)}
.cas{padding:12px 16px;border-bottom:1px solid var(--bd)}
.cas.cur{background:var(--cur)}
.entete{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;margin-bottom:8px}
.rang{font-weight:700}
.visuels{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
figure{margin:0}
figure img{display:block;width:min(44vw,360px);height:auto;border:1px solid var(--bd);cursor:zoom-in;background:#808080}
.rep{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
#zoom{display:none;position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:20;overflow:auto;cursor:zoom-out}
#zoom img{display:block;margin:0 auto;max-width:none;width:min(1400px,96vw)}
`;

function html(lignes) {
    const donnees = lignes.map(d => ({ rang: d.rang, idProduct: d.idProduct, nom: d.nom, set: d.set || '—', distanceAff: virgule(d.distance), nous: urlFichier(d.notreVignette), cm: urlFichier(d.copieCardmarket) }));
    const json = JSON.stringify(donnees).replace(/</g, '\\u003c');
    return '<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n'
        + '<title>53 incertains</title>\n<style>' + STYLE + '</style></head><body>\n'
        + '<header class="haut"><span id="compteur">0 / ' + lignes.length + ' étiquetés</span>'
        + '<span class="mut">B = bon visuel · F = faux · N = je ne sais pas · flèches = naviguer · clic sur une image = agrandir · Échap ferme</span>'
        + '<button id="enreg">Enregistrer le JSON</button><span id="msg" class="mut"></span></header>\n'
        + '<main id="liste"></main><div id="zoom"><img alt=""></div>\n'
        + '<script>window.DONNEES = ' + json + ';</script>\n'
        + '<script>' + CLIENT + '</script>\n</body></html>\n';
}

(function main() {
    const audit = lireJson('audit-produits.json');
    const incertains = audit.filter(p => p.classeVisuel === 'INCERTAIN');
    if (incertains.length !== ATTENDU) throw new Error(`INCERTAIN : ${incertains.length} produits, ${ATTENDU} attendus. Arrêt : les seuils ou l'audit ont bougé.`);
    console.log(`INCERTAIN : ${incertains.length} produits (attendu ${ATTENDU})`);

    const etat = lireJson('etat-produits.json');
    const cleDe = new Map(etat.filter(p => p.visuel && p.visuel.entree).map(p => [p.idProduct, p.visuel.entree.vignette && p.visuel.entree.vignette.cle]));
    const idx = indexerDisque();

    const cas = incertains
        .slice()
        .sort((a, b) => a.distance - b.distance || a.idProduct - b.idProduct)
        .map((p, i) => {
            const cle = cleDe.get(p.idProduct) || null;
            if (!Number.isFinite(p.distance)) throw new Error(`produit ${p.idProduct} : distance absente`);
            return {
                rang: i + 1, idProduct: p.idProduct, nom: p.nom, set: p.set, distance: p.distance,
                notreVignette: cle ? sortie(`cache-nos-vignettes/${sha1(cle)}.webp`) : null,
                copieCardmarket: idx.get(p.idProduct) || null,
            };
        });

    const manque = [];
    for (const c of cas) {
        if (!c.notreVignette || !fs.existsSync(c.notreVignette)) manque.push(`${c.idProduct} : notre vignette absente du cache (non récupérée ici)`);
        if (!c.copieCardmarket || !fs.existsSync(c.copieCardmarket)) manque.push(`${c.idProduct} : copie Cardmarket introuvable`);
    }
    if (manque.length) throw new Error(`chemins d'image manquants (${manque.length}) :\n   ` + manque.join('\n   '));

    ecrireJson('incertains/incertains-53.json', cas.map(c => ({ idProduct: c.idProduct, nom: c.nom, set: c.set, distance: c.distance, notreVignette: c.notreVignette, copieCardmarket: c.copieCardmarket })), { indent: 1 });
    const htmlChemin = sortie('incertains', 'incertains.html');
    fs.mkdirSync(require('path').dirname(htmlChemin), { recursive: true });
    fs.writeFileSync(htmlChemin, html(cas), 'utf8');
    console.log(`écrit : ${htmlChemin}`);

    // contrôle relu dans le fichier livré : chaque chemin d'image référencé par la page doit exister
    const page = fs.readFileSync(htmlChemin, 'utf8');
    // un emplacement d'image = une référence ; deux produits peuvent légitimement partager un fichier, donc on compte les emplacements, pas les chemins distincts
    const refs = [...page.matchAll(/file:\/\/\/[^"]+/g)].map(m => m[0]);
    const distincts = new Set(refs).size;
    const existent = refs.filter(u => fs.existsSync(fileURLToPath(u)));
    console.log(`contrôle HTML : ${refs.length} emplacements d'image référencés (${distincts} chemins distincts), ${existent.length} existent sur disque`);
    if (existent.length !== refs.length) throw new Error('des images référencées par la page n\'existent pas');
    if (refs.length !== 2 * ATTENDU) throw new Error(`${refs.length} emplacements référencés, ${2 * ATTENDU} attendus`);
}());
