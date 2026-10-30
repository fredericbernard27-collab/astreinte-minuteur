/* Règles d'astreinte : plages couvertes, jours fériés, jour/nuit, semaines.
   Fichier sans dépendance, utilisable dans le navigateur et dans Node (tests). */
(function (global) {
  'use strict';

  const DEBUT_JOUR_ASTREINTE = 9 * 60;   // 9h00 : une "journée d'astreinte" va de 9h00 à 9h00 le lendemain
  const MIDI_DEBUT = 12 * 60 + 30;       // 12h30
  const MIDI_FIN = 14 * 60;              // 14h00
  const SOIR_DEBUT = 17 * 60 + 30;       // 17h30
  const JOUR_DEBUT_H = 8;                // jour = 8h00–20h00, nuit = 20h00–8h00
  const JOUR_FIN_H = 20;

  const pad = (n) => String(n).padStart(2, '0');
  const cleJour = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const ajouterJours = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

  // Dimanche de Pâques (algorithme grégorien anonyme)
  function paques(annee) {
    const a = annee % 19, b = Math.floor(annee / 100), c = annee % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mois = Math.floor((h + l - 7 * m + 114) / 31);
    const jour = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(annee, mois - 1, jour);
  }

  const cacheFeries = {};
  // Jours fériés en France métropolitaine : { 'AAAA-MM-JJ': 'Nom' }
  function feries(annee) {
    if (cacheFeries[annee]) return cacheFeries[annee];
    const p = paques(annee);
    const liste = {};
    const fixe = [[1, 1, "Jour de l'an"], [5, 1, 'Fête du travail'], [5, 8, 'Victoire 1945'],
      [7, 14, 'Fête nationale'], [8, 15, 'Assomption'], [11, 1, 'Toussaint'],
      [11, 11, 'Armistice'], [12, 25, 'Noël']];
    fixe.forEach(([m, j, nom]) => { liste[cleJour(new Date(annee, m - 1, j))] = nom; });
    liste[cleJour(ajouterJours(p, 1))] = 'Lundi de Pâques';
    liste[cleJour(ajouterJours(p, 39))] = 'Ascension';
    liste[cleJour(ajouterJours(p, 50))] = 'Lundi de Pentecôte';
    cacheFeries[annee] = liste;
    return liste;
  }

  const nomFerie = (d) => feries(d.getFullYear())[cleJour(d)] || null;

  // Journée d'astreinte à laquelle appartient un instant (avant 9h00 → nuit de la veille)
  function jourAstreinte(ts) {
    const d = new Date(ts);
    const min = d.getHours() * 60 + d.getMinutes();
    let jour = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const matin = min < DEBUT_JOUR_ASTREINTE;
    if (matin) jour = ajouterJours(jour, -1);
    return { jour, matin, min };
  }

  // 'Semaine' | 'Samedi' | 'Dimanche' | 'Férié' selon la journée d'astreinte
  function typeJour(ts) {
    const { jour } = jourAstreinte(ts);
    if (nomFerie(jour)) return 'Férié';
    const j = jour.getDay();
    if (j === 6) return 'Samedi';
    if (j === 0) return 'Dimanche';
    return 'Semaine';
  }

  // Vrai si l'instant tombe dans une plage d'astreinte
  function estEnAstreinte(ts) {
    if (typeJour(ts) !== 'Semaine') return true;          // week-end et fériés : 9h → 9h
    const { matin, min } = jourAstreinte(ts);
    if (matin) return true;                               // nuit 17h30 → 9h00
    return (min >= MIDI_DEBUT && min < MIDI_FIN) || min >= SOIR_DEBUT;
  }

  const tranche = (ts) => {
    const h = new Date(ts).getHours();
    return h >= JOUR_DEBUT_H && h < JOUR_FIN_H ? 'Jour' : 'Nuit';
  };

  // Lundi (date) de la semaine d'astreinte contenant l'instant
  function lundiSemaine(ts) {
    const { jour } = jourAstreinte(ts);
    return ajouterJours(jour, -((jour.getDay() + 6) % 7));
  }
  const cleSemaine = (ts) => cleJour(lundiSemaine(ts));

  // Bornes [début, fin[ d'une semaine d'astreinte à partir de sa clé 'AAAA-MM-JJ'
  function bornesSemaine(cle) {
    const [a, m, j] = cle.split('-').map(Number);
    const debut = new Date(a, m - 1, j, 9, 0);
    const fin = new Date(a, m - 1, j + 7, 9, 0);
    return { debut: debut.getTime(), fin: fin.getTime() };
  }

  const decalerSemaine = (cle, n) => {
    const [a, m, j] = cle.split('-').map(Number);
    return cleJour(new Date(a, m - 1, j + 7 * n));
  };

  // Jours fériés compris dans une semaine d'astreinte
  function feriesDeLaSemaine(cle) {
    const [a, m, j] = cle.split('-').map(Number);
    const res = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(a, m - 1, j + i);
      const nom = nomFerie(d);
      if (nom) res.push({ date: d, nom });
    }
    return res;
  }

  // Un établissement sans antenne est traité comme une antenne unique portant son nom
  const antennesDe = (e) => (e.antennes && e.antennes.length ? e.antennes : [e.nom]);

  // Journée d'astreinte d'un horodatage (9 h 00 → 8 h 59 le lendemain), clé « AAAA-MM-JJ » du jour où elle commence
  const cleJournee = (ts) => cleJour(jourAstreinte(ts).jour);

  /* ---------- Dénomination patient : une seule règle (barres, Stats, Cumul) ----------
     Un patient = ANTENNE + NOM (3 premières lettres) + initiale du PRÉNOM.
     - NOM : accents, espaces, tirets et apostrophes ignorés (« Du Pont », « DUPOND » → DUP) ;
     - PRÉNOM : initiale seule, facultative (« JEAN », « JE » → J) ;
     - ANTENNE : obligatoire pour réunir deux barres ; antennes différentes = deux patients (homonymes) ;
     - d.homonyme (réponse « Non » à « Même patient ? ») sépare un homonyme du patient auquel il ressemble.
     Barres d'une même semaine : identiques (clePatient) → réunies d'office (regrouper) ; seulement compatibles
     (patientsCompatibles) → l'application demande « Même patient ? ». */
  const lettres = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
  const nom3De = (d) => lettres(d.nom3).slice(0, 3);
  const initialeDe = (d) => lettres(d.prenom2).slice(0, 1);
  const marqueHomonyme = (d) => (d.homonyme ? `#${d.homonyme}` : '');

  // Identité exacte (NOM et PRÉNOM tels que saisis, antenne) : '' sans NOM ou sans antenne
  const clePatient = (d) => {
    const nom = (d.nom3 || '').trim().toUpperCase();
    return nom && d.antenne ? `${nom}|${(d.prenom2 || '').trim().toUpperCase()}|${d.antenne}${marqueHomonyme(d)}` : '';
  };

  // Même NOM (3 lettres), initiales égales ou absente d'un côté, même marque d'homonyme (l'antenne est vérifiée à part)
  const patientsCompatibles = (a, b) => {
    const ia = initialeDe(a), ib = initialeDe(b);
    return !!nom3De(a) && nom3De(a) === nom3De(b) && (!ia || !ib || ia === ib) && marqueHomonyme(a) === marqueHomonyme(b);
  };

  /* Comptage des patients : Map id du dossier → clé du patient (dateDe(d) : date du dossier).
     1) NOM, initiale et antenne : ANTENNE|NOM|I ;
     2) sans prénom : rattaché au patient de même antenne et même NOM le plus proche dans le temps (sinon ANTENNE|NOM|) ;
     3) sans antenne : rattaché au patient de même NOM (et même initiale si saisie) le plus proche dans le temps ;
     4) sans NOM : le dossier compte seul. */
  function patients(dossiers, dateDe) {
    const res = new Map();
    const groupes = new Map();
    const groupe = (d, antenne, init) => {
      const cle = `${antenne || '?'}|${nom3De(d)}|${init}${marqueHomonyme(d)}`;
      if (!groupes.has(cle)) groupes.set(cle, { cle, antenne, nom: nom3De(d), init, marque: marqueHomonyme(d), dates: [] });
      return groupes.get(cle);
    };
    const placer = (d, g) => { res.set(d.id, g.cle); g.dates.push(dateDe(d)); };
    const leProche = (d, ok) => {
      let choix = null, ecart = Infinity;
      groupes.forEach((g) => {
        if (g.nom !== nom3De(d) || g.marque !== marqueHomonyme(d) || !ok(g)) return;
        const e = Math.min(...g.dates.map((t) => Math.abs(t - dateDe(d))));
        if (e < ecart) { ecart = e; choix = g; }
      });
      return choix;
    };
    const avecNom = dossiers.filter((d) => nom3De(d));
    dossiers.filter((d) => !nom3De(d)).forEach((d) => res.set(d.id, d.id));
    avecNom.filter((d) => d.antenne && initialeDe(d)).forEach((d) => placer(d, groupe(d, d.antenne, initialeDe(d))));
    avecNom.filter((d) => d.antenne && !initialeDe(d)).forEach((d) =>
      placer(d, leProche(d, (g) => g.antenne === d.antenne) || groupe(d, d.antenne, '')));
    avecNom.filter((d) => !d.antenne).forEach((d) => {
      const i = initialeDe(d);
      placer(d, leProche(d, (g) => !i || !g.init || g.init === i) || groupe(d, '', i));
    });
    return res;
  }

  // Réunit le dossier « verse » dans « garde » (interventions, champs manquants) ; « verse » est vidé
  function fusionner(garde, verse) {
    garde.segments.push(...verse.segments);
    // NOM et PRÉNOM : la saisie la plus complète l'emporte (« DUP » + « DUPONT » → DUPONT ; prénom vide complété)
    ['nom3', 'prenom2'].forEach((c) => { if ((verse[c] || '').trim().length > (garde[c] || '').trim().length) garde[c] = verse[c]; });
    ['etab', 'antenne', 'rpss'].forEach((c) => { if (!garde[c] && verse[c]) garde[c] = verse[c]; });
    garde.clos = false;
    verse.segments = [];
  }

  /* Un dossier = un patient (clePatient) sur une semaine d'astreinte (lundi 9 h 00 → lundi suivant 8 h 59).
     - Un dossier dont des interventions débutent sur plusieurs semaines est scindé : une intervention qui débute
       à partir du lundi 9 h 00 suivant ouvre un nouveau dossier (identité et antenne recopiées).
     - Deux dossiers du même patient dans la même semaine sont réunis dans le plus ancien ; l'autre est vidé
       (à supprimer par l'appelant). Même NOM + PR mais antennes différentes = deux patients distincts (homonymes).
     Modifie la liste en place. Renvoie { scindes: [dossiers créés], fusions: [{ garde, verse }] }. */
  /* Depuis la v1.11, Mémo et Commentaire appartiennent à chaque intervention (segment). Ceux d'un dossier
     (versions antérieures, ancienne sauvegarde ou synchronisation) passent sur son intervention la plus récente. */
  function notesVersInterventions(dossiers) {
    dossiers.filter((d) => !d.supprime && d.segments && d.segments.length).forEach((d) => {
      if (!d.memo && !d.commentaire) return;
      const s = d.segments.reduce((a, b) => (b.debut > a.debut ? b : a));
      ['memo', 'commentaire'].forEach((c) => {
        if (d[c] && d[c] !== s[c]) s[c] = [s[c], d[c]].filter(Boolean).join(' / ');
        d[c] = '';
      });
    });
  }

  function regrouper(dossiers, creerId) {
    notesVersInterventions(dossiers);
    const vivants = () => dossiers.filter((d) => !d.supprime && d.segments && d.segments.length);
    const debutDe = (d) => Math.min(...d.segments.map((s) => s.debut));
    const scindes = [];
    vivants().forEach((d) => {
      const parSemaine = new Map();
      d.segments.forEach((s) => {
        const k = cleSemaine(s.debut);
        if (!parSemaine.has(k)) parSemaine.set(k, []);
        parSemaine.get(k).push(s);
      });
      if (parSemaine.size < 2) return;
      const [premiere, ...suivantes] = [...parSemaine.keys()].sort();
      d.segments = parSemaine.get(premiere);
      suivantes.forEach((k) => {
        const segments = parSemaine.get(k);
        const n = {
          ...d, id: creerId(), creeLe: Math.min(...segments.map((s) => s.debut)), clos: false, segments,
          memo: '', commentaire: '',
        };
        dossiers.push(n);
        scindes.push(n);
      });
    });
    const fusions = [];
    const parPatient = new Map();
    vivants().filter((d) => clePatient(d)).sort((a, b) => a.creeLe - b.creeLe).forEach((d) => {
      const k = `${clePatient(d)}|${cleSemaine(debutDe(d))}`;
      const garde = parPatient.get(k);
      if (!garde) { parPatient.set(k, d); return; }
      fusionner(garde, d);
      fusions.push({ garde, verse: d });
    });
    return { scindes, fusions };
  }

  /* ---------- Plages continues et travail transversal ----------
     Intervalles [début, fin] en millisecondes. */
  // Réunion : triés, sans chevauchement (deux intervalles qui se touchent ou se recouvrent n'en font qu'un)
  function reunir(intervalles) {
    const res = [];
    intervalles.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]).forEach(([a, b]) => {
      const der = res[res.length - 1];
      if (der && a <= der[1]) der[1] = Math.max(der[1], b); else res.push([a, b]);
    });
    return res;
  }
  const longueur = (intervalles) => intervalles.reduce((t, [a, b]) => t + b - a, 0);
  const borner = (intervalles, a, b) => intervalles.map(([x, y]) => [Math.max(x, a), Math.min(y, b)]).filter(([x, y]) => y > x);

  /* Entre a et b : travail transversal = temps des plages déclarées « sans interruption » qu'aucune intervention ne
     couvre ; combine = temps couvert par les interventions ou par les plages, sans doublon.
     Ex. : plage 10 h → 12 h, intervention 10 h 30 → 11 h 30 : transversal 1 h, combine 2 h. */
  function tempsPlages(interventions, plages, a, b) {
    const i = reunir(borner(interventions, a, b));
    const combine = longueur(reunir([...i, ...borner(plages, a, b)]));
    return { transversal: combine - longueur(i), combine };
  }

  const Rules = {
    reunir, tempsPlages,
    antennesDe, cleJour, cleJournee, clePatient, patientsCompatibles, patients, fusionner, notesVersInterventions, regrouper, paques, feries, nomFerie, jourAstreinte, typeJour, estEnAstreinte,
    tranche, lundiSemaine, cleSemaine, bornesSemaine, decalerSemaine, feriesDeLaSemaine,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Rules;
  else global.Rules = Rules;
})(typeof window !== 'undefined' ? window : globalThis);
