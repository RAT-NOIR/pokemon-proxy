// ==UserScript==
// @name         Rat-Market — Apprentissage passif PikaQian
// @namespace    rat-market
// @version      2.3
// @description  Bouton « Apprendre cette page » sur les pages de set que TU ouvres. Au clic seulement, envoie la page puis les images déjà affichées au récepteur LOCAL (127.0.0.1). Ne navigue jamais, ne défile jamais.
// @match        https://pikaqian.com/sets/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      images.pikaqian.com
// @run-at       document-idle
// @noframes
// ==/UserScript==

// ============================================================
// 2.3 — PASSIF PAR CONSTRUCTION. Au chargement, ce script n'ajoute qu'un panneau à la page (style du script Cardmarket : fond noir, or, barre de progression) : aucune requête ne part.
// Au clic seulement, et seulement sur /sets/<code> : (1) l'adresse de la page et son HTML au récepteur local ; (2) pour chaque tuile dont l'image est DÉJÀ chargée, ses octets, par lots
// de LOT_IMAGES_MAX images au plus. Aucune navigation, aucun défilement : les tuiles dont l'image n'est pas chargée sont comptées et dites, jamais forcées.
// TROIS VOIES pour lire les octets d'une image, dans cet ordre : 1. canvas (les pixels affichés, aucune requête ; refusé pour une image d'une autre origine non CORS) ;
// 2. cache (fetch en force-cache depuis la page, anonyme, redirection refusée) ; 3. navigateur (GM_xmlhttpRequest anonyme vers l'adresse de la tuile). Au plus 2 requêtes par image,
// cache puis navigateur, jamais les deux en même temps pour une même image, et seulement vers images.pikaqian.com. L'URL FINALE de chaque réponse doit être l'hôte exact des images
// et le même chemin que la tuile. La voie cache est abandonnée après deux échecs de suite.
// CADENCE : les images prêtes se lisent par paquets de CONCURRENCE en parallèle ; une pause de PAUSE_MS sépare deux paquets quand le précédent a émis au moins une requête (aucune pause
// après le dernier paquet, aucune quand tout se lit au canvas). Quand le canvas est refusé, le premier paquet peut émettre jusqu'à 2 × CONCURRENCE requêtes (CONCURRENCE caches, puis
// CONCURRENCE navigateurs) avant que la voie cache soit abandonnée.
// ARRÊT PARTAGÉ lecture.arret : posé au premier 403, 429 ou 5xx, à la troisième réponse 404 de suite, ou à une URL finale qui n'est pas celle de la tuile (une redirection arrête comme un 403). Ensuite aucune requête
// nouvelle ne part (au plus CONCURRENCE − 1 sont déjà en vol), les images déjà lues du paquet sont envoyées au récepteur, puis le panneau affiche l'arrêt.
// Le récepteur est joint en 127.0.0.1 seulement ; le refus d'une page affiche le diagnostic que le récepteur a fabriqué (lignesDeDiagnostic).
// ============================================================
(function () {
    'use strict';
    // LE PORT du récepteur : la valeur de `--port` de recepteur-pikaqian.js (défaut 8765).
    var PORT = 8765;
    var RECEPTEUR = 'http://127.0.0.1:' + PORT + '/apprendre';
    var RECEPTEUR_IMAGES = 'http://127.0.0.1:' + PORT + '/images';
    var CODE_DE_SET = '[a-z0-9][a-z0-9.-]{0,30}';
    var PAGE_DE_SET = new RegExp('^/sets/' + CODE_DE_SET + '$');
    var HOTE_IMAGES = 'images.pikaqian.com';
    var IMAGE_MAX_OCTETS = 2 * 1024 * 1024;
    var LOT_IMAGES_MAX = 10;
    var LOT_B64_MAX = 1500000;
    var UUID = /^\/cards\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
    var CONCURRENCE = 8;  // images lues en même temps (une page en charge des dizaines à la fois ; 2.2 : 4)
    var PAUSE_MS = 150;   // pause entre deux paquets (2.0 : 500 ms par image, 2.1 : 300 ms par image)

    var CODE = (location.pathname.match(/^\/sets\/([^/]+)$/) || [])[1] || '?';

    // ===== UI (style du script Cardmarket) =====
    var panneau = document.createElement('div');
    panneau.style.cssText =
        'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#0d0d10;color:#eee;' +
        'font:13px system-ui,sans-serif;padding:12px 14px;border:1px solid #D4AF37;border-radius:10px;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.4);width:290px';
    panneau.innerHTML =
        '<div style="font-weight:600;margin-bottom:2px">🐀 Apprendre cette page</div>' +
        '<div id="rm-sous" style="color:#888;font-size:11px;margin-bottom:8px"></div>' +
        '<button id="rm-go" style="width:100%;padding:7px;background:#0c0c0e;color:#D4AF37;' +
        'border:1px solid #D4AF37;border-radius:6px;cursor:pointer;font-weight:600">Apprendre</button>' +
        '<div id="rm-barwrap" style="display:none;height:6px;background:#333;border-radius:3px;margin-top:10px;overflow:hidden">' +
        '<div id="rm-bar" style="height:100%;width:0;background:#D4AF37;transition:width .2s"></div></div>' +
        '<div id="rm-msg" style="margin-top:8px;min-height:16px;color:#bbb;line-height:1.4;white-space:pre-wrap"></div>';
    document.body.appendChild(panneau);
    var bouton = panneau.querySelector('#rm-go');
    var sous = panneau.querySelector('#rm-sous');
    var barwrap = panneau.querySelector('#rm-barwrap');
    var bar = panneau.querySelector('#rm-bar');
    var msg = panneau.querySelector('#rm-msg');
    function dire(texte, couleur) { msg.style.color = couleur || '#bbb'; msg.textContent = texte; }

    // ===== Envoi au récepteur local =====
    function poster(adresse, objet) {
        return new Promise(function (resoudre, rejeter) {
            GM_xmlhttpRequest({
                method: 'POST',
                url: adresse,
                headers: { 'Content-Type': 'application/json', 'X-Rat-Market': 'rat-market-passif' },
                data: JSON.stringify(objet),
                anonymous: true,
                timeout: 30000,
                redirect: 'error',
                onload: function (r) {
                    var j = null;
                    try { j = JSON.parse(r.responseText); } catch (e) { j = null; }
                    resoudre({ status: r.status, json: j });
                },
                onerror: function () { rejeter({ reseau: 'erreur' }); },
                ontimeout: function () { rejeter({ reseau: 'delai' }); }
            });
        });
    }

    // Le DIAGNOSTIC d'une page refusée (lot PQ-PROMO) : les lignes que le récepteur a fabriquées (codes lus, dossiers des images, titre, annonce du nombre de cartes), AFFICHÉES telles quelles.
    // Rien n'est interprété ni renvoyé : seules des chaînes sont montrées, 8 lignes au plus, 300 caractères chacune. Aucune requête.
    function lignesDeDiagnostic(j) {
        var l = j && j.diagnostic && j.diagnostic.lignes, sortie = '';
        if (!Array.isArray(l)) return '';
        var gardees = l.filter(function (x) { return typeof x === 'string'; }).slice(0, 8);
        for (var i = 0; i < gardees.length; i++) sortie += '\n' + gardees[i].slice(0, 300);
        return sortie ? '\n— ce que la page portait —' + sortie : '';
    }

    function normaliser(t) { return String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); }

    // Les tuiles telles que la page les affiche
    function lireTuilesDuDom() {
        var sortie = [];
        var ancres = document.querySelectorAll('a[href^="/cards/"]');
        for (var i = 0; i < ancres.length; i++) {
            var a = ancres[i];
            var m = UUID.exec(a.getAttribute('href') || '');
            if (!m) continue;
            var img = a.querySelector('img'), h2 = a.querySelector('h2'), p = a.querySelector('p');
            var ref = p ? String(p.textContent || '').split('·') : [];
            sortie.push({
                id: m[1],
                nom: h2 ? normaliser(h2.textContent) : '',
                numero: ref.length > 1 ? String(ref[1]).trim() : '',
                img: img || null,
                src: img ? (img.currentSrc || img.src || '') : '',
                chargee: !!(img && img.complete && img.naturalWidth > 0)
            });
        }
        return sortie;
    }

    function adresseAutorisee(src) {
        try { var u = new URL(src); return u.protocol === 'https:' && u.hostname === HOTE_IMAGES && !u.username && !u.password && !u.search && !u.hash; } catch (e) { return false; }
    }
    function enBase64(buffer) {
        var o = new Uint8Array(buffer), s = '';
        for (var i = 0; i < o.length; i += 0x8000) s += String.fromCharCode.apply(null, o.subarray(i, i + 0x8000));
        return btoa(s);
    }
    var B64_MAX = Math.ceil(IMAGE_MAX_OCTETS * 4 / 3) + 4;

    // voie 1 : canvas (aucune requête)
    function depuisCanvas(img) {
        try {
            var c = document.createElement('canvas');
            c.width = img.naturalWidth; c.height = img.naturalHeight;
            c.getContext('2d').drawImage(img, 0, 0);
            var u = c.toDataURL('image/png');
            var b64 = u.slice(u.indexOf(',') + 1);
            return b64 && b64.length <= B64_MAX ? b64 : null;
        } catch (e) { return null; }
    }

    // ===== Cadence et arrêt =====
    var lecture = { emises: 0, cacheTentatives: 0, navigateurRequetes: 0, cacheEchecs: 0, cacheMorte: false, suite404: 0, arret: null };
    function pause(ms) { return new Promise(function (resoudre) { setTimeout(resoudre, ms); }); }
    function estArret(statut) { return statut === 403 || statut === 429 || statut >= 500; }
    function urlFinaleOk(finale, src) {
        try { var u = new URL(finale), s = new URL(src); return u.protocol === 'https:' && u.hostname === HOTE_IMAGES && u.pathname === s.pathname && !u.search && !u.hash && !u.port && !u.username && !u.password; } catch (e) { return false; }
    }
    var SUITE_404_MAX = 3;
    function arretDe(res, voie, src) {
        if (res.redirige) {
            var ar = { motif: 'redirection vers « ' + res.finale + ' »', voie: voie, src: src };
            if (!lecture.arret) lecture.arret = ar;
            return ar;
        }
        if (res.b64) lecture.suite404 = 0;
        else if (res.statut === 404) lecture.suite404++;
        else if (res.statut > 0) lecture.suite404 = 0;
        var a = null;
        if (lecture.suite404 >= SUITE_404_MAX) a = { motif: 'trois réponses 404 de suite', voie: voie, src: src };
        else if (estArret(res.statut)) a = { statut: res.statut, voie: voie, src: src };
        if (a && !lecture.arret) lecture.arret = a;   // arrêt partagé : plus aucune requête nouvelle, quel que soit le paquet
        return a;
    }
    // la cadence est tenue par la boucle (pause entre paquets) ; ici on refuse toute requête après un arrêt
    function avantRequete() {
        if (lecture.arret) return Promise.reject({ arret: lecture.arret });
        lecture.emises++;
        return Promise.resolve();
    }
    // voie 2 : cache HTTP de la page
    function depuisLeCache(src) {
        return avantRequete().then(function () {
            lecture.cacheTentatives++;
            return fetch(src, { method: 'GET', mode: 'cors', cache: 'force-cache', credentials: 'omit', redirect: 'error' }).then(function (r) {
                if (!urlFinaleOk(r.url, src)) return { redirige: true, finale: String(r.url) };
                if (!r.ok) return { echec: true, statut: r.status };
                return r.arrayBuffer().then(function (ab) { return ab.byteLength > 0 && ab.byteLength <= IMAGE_MAX_OCTETS ? { b64: enBase64(ab) } : { echec: true, statut: 0 }; });
            }).catch(function () { return { echec: true, statut: 0 }; });
        });
    }
    // voie 3 : le navigateur (anonyme, adresse de la tuile seulement)
    function depuisLeNavigateur(src) {
        return avantRequete().then(function () {
            lecture.navigateurRequetes++;
            return new Promise(function (resoudre) {
                GM_xmlhttpRequest({
                    method: 'GET', url: src, responseType: 'arraybuffer', anonymous: true, timeout: 30000, redirect: 'error',
                    onload: function (r) {
                        var ab = r.response;
                        if (!urlFinaleOk(r.finalUrl, src)) resoudre({ redirige: true, finale: String(r.finalUrl) });
                        else if (r.status === 200 && ab && ab.byteLength > 0 && ab.byteLength <= IMAGE_MAX_OCTETS) resoudre({ b64: enBase64(ab) });
                        else resoudre({ echec: true, statut: r.status });
                    },
                    onerror: function () { resoudre({ echec: true, statut: 0 }); },
                    ontimeout: function () { resoudre({ echec: true, statut: 0 }); }
                });
            });
        });
    }
    function lireImage(t) {
        if (!adresseAutorisee(t.src)) return Promise.resolve(null);
        var b = depuisCanvas(t.img);
        if (b) return Promise.resolve({ b64: b, voie: 'canvas' });
        var etapeCache = lecture.cacheMorte ? Promise.resolve({ echec: true, statut: 0 }) : depuisLeCache(t.src);
        return etapeCache.then(function (c) {
            if (c.b64) { lecture.cacheEchecs = 0; lecture.suite404 = 0; return { b64: c.b64, voie: 'cache' }; }
            if (!lecture.cacheMorte && ++lecture.cacheEchecs >= 2) lecture.cacheMorte = true;
            var ac = arretDe(c, 'cache', t.src);
            if (ac) throw { arret: ac };
            if (lecture.arret) throw { arret: lecture.arret };
            return depuisLeNavigateur(t.src).then(function (n) {
                var an = arretDe(n, 'navigateur', t.src);
                if (an) throw { arret: an };
                if (n.b64) return { b64: n.b64, voie: 'navigateur' };
                return null;
            });
        });
    }

    // ===== Sous-titre : où en est la page (rafraîchi au survol) =====
    function majSousTitre() {
        var tuiles = lireTuilesDuDom();
        var pretes = tuiles.filter(function (t) { return t.chargee && adresseAutorisee(t.src); }).length;
        var secondes = Math.max(5, Math.round(Math.ceil(pretes / CONCURRENCE) * (PAUSE_MS + 350) / 1000));
        var duree = secondes < 90 ? secondes + ' s' : Math.round(secondes / 60) + ' min';
        sous.textContent = CODE + ' · ' + pretes + '/' + tuiles.length + ' images chargées' +
            (pretes < tuiles.length ? ' — fais défiler jusqu\'en bas' : ' · ≈ ' + duree + ' de lecture');
    }
    majSousTitre();
    dire('Rien n\'est envoyé avant ton clic. Un seul clic, puis attends la fin.');
    panneau.addEventListener('mouseover', function () { if (!bouton.disabled) majSousTitre(); });

    // ===== Le clic =====
    async function apprendre() {
        var url = location.origin + location.pathname;
        var html = document.documentElement.outerHTML;
        lecture = { emises: 0, cacheTentatives: 0, navigateurRequetes: 0, cacheEchecs: 0, cacheMorte: false, suite404: 0, arret: null };
        var tuiles = lireTuilesDuDom();
        bar.style.width = '0';
        barwrap.style.display = 'block';
        dire('Envoi de la page au récepteur local…');

        var rep = await poster(RECEPTEUR, { url: url, html: html });
        var j = rep.json;
        if (!(j && j.ok)) {
            dire('❌ Refusé (HTTP ' + rep.status + ') : ' + ((j && j.motif) || 'réponse illisible du récepteur') + lignesDeDiagnostic(j), '#f56c6c');
            return;
        }
        var avertissement = j.anomalie ? '\n⚠️ ' + j.anomalie : '';
        var pretes = tuiles.filter(function (t) { return t.chargee; });
        var sansImage = tuiles.length - pretes.length;
        var voies = { canvas: 0, cache: 0, navigateur: 0 }, illisibles = 0, recues = 0, refusees = 0, premierMotif = '', lot = [], tailleLot = 0, faites = 0;

        async function envoyerLot() {
            if (!lot.length) return;
            var corps = { fichier: j.fichier, images: lot, sansImage: sansImage };
            lot = []; tailleLot = 0;
            var r = await poster(RECEPTEUR_IMAGES, corps);
            if (!(r.json && r.json.ok)) throw { refus: 'HTTP ' + r.status + ' : ' + ((r.json && r.json.motif) || 'réponse illisible du récepteur') };
            recues += r.json.recues; refusees += r.json.refusees.length;
            if (r.json.refusees.length && !premierMotif) premierMotif = r.json.refusees[0].motif;
        }

        if (!pretes.length) {
            bar.style.width = '100%';
            dire('✅ Page apprise (' + j.tuilesLues + ' tuiles), mais aucune image chargée : fais défiler la page jusqu\'en bas, puis reclique.' + avertissement, '#e6a23c');
            return;
        }

        try {
            for (var i = 0; i < pretes.length; i += CONCURRENCE) {
                var paquet = pretes.slice(i, i + CONCURRENCE);
                var emisesAvant = lecture.emises;
                // le paquet est lu en parallèle ; on garde toutes ses images lues, même si une autre déclenche l'arrêt
                var issues = await Promise.all(paquet.map(function (t) {
                    return lireImage(t).then(function (v) { return { ok: v }; }, function (e) { return { err: e }; });
                }));
                var erreur = null;
                for (var k = 0; k < paquet.length; k++) {
                    var t = paquet[k], is = issues[k];
                    if (is.err) { if (!erreur) erreur = is.err; continue; }
                    var lue = is.ok;
                    faites++;
                    if (!lue) { illisibles++; continue; }
                    voies[lue.voie]++;
                    lot.push({ id: t.id, src: t.src, nom: t.nom, numero: t.numero, voie: lue.voie, b64: lue.b64 });
                    tailleLot += lue.b64.length;
                    if (lot.length >= LOT_IMAGES_MAX || tailleLot >= LOT_B64_MAX) await envoyerLot();
                }
                if (lecture.arret) throw { arret: lecture.arret };
                if (erreur) throw erreur;
                bar.style.width = Math.round((faites / pretes.length) * 100) + '%';
                dire('Lecture ' + faites + '/' + pretes.length + ' · reçues ' + recues + (illisibles ? ' · illisibles ' + illisibles : '') + avertissement);
                if (lecture.emises > emisesAvant && i + CONCURRENCE < pretes.length) await pause(PAUSE_MS);
            }
            await envoyerLot();
            bar.style.width = '100%';
            var fin = '✅ ' + j.code + ' terminé : ' + recues + ' image(s) reçue(s)' +
                (refusees ? ' · ' + refusees + ' refusée(s) (« ' + premierMotif + ' »)' : '') +
                (illisibles ? ' · ' + illisibles + ' illisible(s)' : '') +
                (sansImage ? '\n⚠️ ' + sansImage + ' tuile(s) sans image chargée : fais défiler jusqu\'en bas, puis reclique.' : '\n→ Page suivante de la liste.') +
                avertissement;
            dire(fin, sansImage || refusees || illisibles ? '#e6a23c' : '#67c23a');
        } catch (e) {
            if (e && e.arret) {
                try { await envoyerLot(); } catch (e2) { /* récepteur muet */ }
                dire('⛔ ARRÊT : ' + (e.arret.motif || 'HTTP ' + e.arret.statut) + ' (voie ' + e.arret.voie + '). Plus aucune requête, aucun réessai. Reçues : ' + recues + '.\nArrête la séance et préviens.', '#f56c6c');
            }
            else if (e && e.refus) dire('❌ Le récepteur a refusé un lot d\'images (' + e.refus + ') : arrêt.', '#f56c6c');
            else if (e && e.reseau) dire('❌ Le récepteur ne répond plus (' + e.reseau + ') : arrêt.', '#f56c6c');
            else throw e;
        }
    }

    bouton.addEventListener('click', function () {
        if (!PAGE_DE_SET.test(location.pathname)) {
            dire('Cette page n\'est pas la page d\'un set (/sets/<code>) : rien n\'est envoyé.', '#e6a23c');
            return;
        }
        bouton.disabled = true; bouton.style.opacity = '.6';
        apprendre().then(function () { bouton.disabled = false; bouton.style.opacity = '1'; }, function (e) {
            bouton.disabled = false; bouton.style.opacity = '1';
            if (e && e.reseau) dire(e.reseau === 'delai'
                ? '❌ Le récepteur ne répond pas (délai dépassé) : vérifie qu\'il tourne, puis recommence.'
                : '❌ Le récepteur ne répond pas : lance-le (node recepteur-pikaqian.js), puis recommence.', '#f56c6c');
            else dire('Erreur du script : ' + (e && e.message ? e.message : String(e)), '#f56c6c');
        });
    });
})();
