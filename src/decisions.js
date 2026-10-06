// =====================================================================
// Contenu du curseur : niveaux, domaines et liste de décisions par défaut.
// Les décisions sont stockées en base, séance par séance : la liste
// ci-dessous sert seulement à pré-remplir chaque NOUVELLE séance.
// Pendant une séance, l'animateur modifie la liste depuis l'appli
// (onglet Décisions). Modifier ce fichier ne change pas les séances déjà créées.
// =====================================================================

// Niveaux par défaut. L'animateur peut les reformuler pour une séance
// (onglet Les 5 niveaux, en préparation, tant qu'aucun vote n'est enregistré).
export const LEVELS = [
  { n: 1, who: 'Directeur', title: 'Décide seul',
    text: 'Gestion courante, dans le cadre déjà voté : budget, plan de formation, grille tarifaire.' },
  { n: 2, who: 'Directeur', title: 'Décide, puis informe',
    text: 'Les associés sont informés dans le reporting périodique (tableau de bord mensuel ou trimestriel).' },
  { n: 3, who: 'Président', title: 'Décide, informe et explique',
    text: 'Information rapide et motivée des associés après la décision : ce qui a été décidé, et pourquoi.' },
  { n: 4, who: 'Président', title: 'Consulte avant de décider',
    text: 'Les associés donnent leur avis avant la décision, sans vote. Le Président tranche.' },
  { n: 5, who: 'Associés', title: 'Votent',
    text: "Décision collective, en réunion d'associés ou en AG." },
]

export const DOMAINS = [
  { id: 'activite', name: 'Activité et production' },
  { id: 'commercial', name: 'Commercial' },
  { id: 'rh', name: 'Ressources humaines' },
  { id: 'finances', name: 'Finances et investissements' },
  { id: 'strategie', name: 'Stratégie et structure' },
]

// id = identifiant stable (lettres, chiffres, - et _ ; 60 caractères au plus)
// prop = niveau proposé (affiché aux associés seulement dans les résultats)
// test = fait partie des décisions de l'atelier
export const DEFAULT_DECISIONS = [
  // Décisions de l'atelier
  { id: 'rh-cdi', domain: 'rh', prop: 2, test: true, label: 'Embaucher en CDI sur un poste prévu au budget' },
  { id: 'rh-rupture', domain: 'rh', prop: 3, test: true, label: 'Licencier ou signer une rupture conventionnelle' },
  { id: 'fin-15k', domain: 'finances', prop: 3, test: true, label: 'Engager une dépense non budgétée de 15 k€' },
  { id: 'act-domaine', domain: 'activite', prop: 4, test: true, label: 'Lancer un nouveau domaine de formation (nouvelle certification, nouveau public)' },
  { id: 'fin-emprunt40', domain: 'finances', prop: 4, test: true, label: 'Souscrire un emprunt de 40 k€' },
  { id: 'com-grille', domain: 'commercial', prop: 3, test: true, label: 'Fixer la grille tarifaire annuelle' },

  // Activité et production
  { id: 'act-planning', domain: 'activite', prop: 1, label: 'Établir le planning des sessions et affecter les formateurs' },
  { id: 'act-interv', domain: 'activite', prop: 1, label: 'Faire appel à un intervenant extérieur déjà référencé' },
  { id: 'act-qualiopi', domain: 'activite', prop: 1, label: 'Mener les démarches Qualiopi courantes et préparer les audits' },
  { id: 'act-nouvinterv', domain: 'activite', prop: 2, label: 'Référencer un nouvel intervenant extérieur' },
  { id: 'act-soustrait', domain: 'activite', prop: 2, label: 'Sous-traiter une session à un autre organisme' },
  { id: 'act-formation', domain: 'activite', prop: 2, label: 'Créer une nouvelle formation dans un domaine déjà couvert' },

  // Commercial
  { id: 'com-remise', domain: 'commercial', prop: 1, label: 'Accorder une remise dans la fourchette validée' },
  { id: 'com-horsfourch', domain: 'commercial', prop: 2, label: 'Accorder une remise hors fourchette ou des conditions particulières à un gros client' },
  { id: 'com-ao', domain: 'commercial', prop: 3, label: "Répondre à un appel d'offres important (plus de 50 k€ ou mobilisant fortement les équipes)" },
  { id: 'com-partenariat', domain: 'commercial', prop: 4, label: 'Signer un partenariat structurant ou une convention-cadre pluriannuelle' },

  // Ressources humaines
  { id: 'rh-cdd', domain: 'rh', prop: 2, label: "Recourir à un CDD, à l'intérim ou à un remplacement" },
  { id: 'rh-poste', domain: 'rh', prop: 4, label: 'Créer un poste non prévu au budget' },
  { id: 'rh-sanction', domain: 'rh', prop: 3, label: 'Prononcer une sanction disciplinaire' },
  { id: 'rh-primes', domain: 'rh', prop: 2, label: "Attribuer des primes individuelles dans l'enveloppe votée" },
  { id: 'rh-politique', domain: 'rh', prop: 4, label: "Définir la politique de rémunération, la grille salariale et l'enveloppe de primes" },
  { id: 'rh-remuPD', domain: 'rh', prop: 4, label: 'Toute décision concernant la rémunération ou les conditions du Président-directeur' },

  // Finances et investissements
  { id: 'fin-budgete', domain: 'finances', prop: 1, label: 'Engager une dépense prévue au budget' },
  { id: 'fin-5k', domain: 'finances', prop: 2, label: 'Engager une dépense non budgétée de moins de 5 k€' },
  { id: 'fin-invest', domain: 'finances', prop: 4, label: 'Réaliser un investissement de plus de 20 k€' },
  { id: 'fin-emprunt50', domain: 'finances', prop: 5, label: 'Souscrire un emprunt de 50 k€ ou plus' },
  { id: 'fin-banque', domain: 'finances', prop: 2, label: 'Choisir la banque, les assurances, les fournisseurs récurrents' },
  { id: 'fin-budget', domain: 'finances', prop: 5, label: 'Adopter le budget prévisionnel annuel' },

  // Stratégie et structure
  { id: 'str-com', domain: 'strategie', prop: 2, label: 'Piloter la communication externe (site, réseaux)' },
  { id: 'str-plan', domain: 'strategie', prop: 5, label: 'Adopter le plan stratégique pluriannuel' },
  { id: 'str-site', domain: 'strategie', prop: 5, label: 'Ouvrir ou fermer un site' },
  { id: 'str-immo', domain: 'strategie', prop: 5, label: 'Réaliser une acquisition immobilière (bâtiment de Creissels)' },
  { id: 'str-filiale', domain: 'strategie', prop: 5, label: 'Créer une filiale ou prendre une participation' },
]
