/* Valeurs par défaut des listes (modifiables ensuite dans l'onglet « Plus › Paramètres »). */
window.CONFIG_DEFAUT = {
  etablissements: [
    { nom: 'NICE', antennes: ['Menton', 'Nice Est', 'Nice Ouest', 'St Martin', 'Villeneuve'] },
    { nom: 'SSV', antennes: ['Brignoles', 'La Garde', 'La Londe Hyères', 'La Seyne', 'St Maximin', 'Toulon'] },
    { nom: 'SSBDR', antennes: ['Arles'] },   // une seule antenne
    { nom: 'Autre', antennes: ['Autre'] },   // toujours en fin de liste
  ],
  medecins: [],
};

/* Types d'intervention */
window.TYPES_SEGMENT = [
  { id: 'Appel reçu', icone: '📞' },
  { id: 'Reprise', icone: '▶' },          // bouton ▶ Reprise d'une barre : compté en temps, pas en sollicitation
  { id: 'Appel passé', icone: '↗️' },
  { id: 'Rédaction', icone: '📝' },
  { id: 'Mail', icone: '✉️' },
  { id: 'Autre', icone: '⋯' },
];
// Anciens noms → nouveaux (données déjà saisies, sauvegardes et CSV importés)
window.RENOMMAGES_ETAB = { 'HAD NICE': 'NICE', 'HAD SSV': 'SSV' };
window.RENOMMAGES_ANTENNES = { SSBDR: 'Arles' };
// Abréviations affichées dans la liste Antenne des barres (le nom complet reste enregistré, exporté et dans les stats)
window.ABREVIATIONS_ANTENNES = {
  'Nice Est': 'Nice E', 'Nice Ouest': 'Nice W', 'St Martin': 'StMart', 'Villeneuve': 'Villen',
  'Brignoles': 'Brigno', 'La Garde': 'LaGard', 'La Londe Hyères': 'LaLonH', 'La Seyne': 'LaSeyn', 'St Maximin': 'StMaxi',
};
window.DUREE_CONSERVATION_JOURS = 31;
