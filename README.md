# Curseur de décision – Hauteur & Sécurité

Petite appli web de vote anonyme pour la réunion d'associés.
Les associés rejoignent la séance avec un code ou un QR code, **sans compte**.
Stack identique à jury-cqp : React + Vite, Supabase, Vercel.

## Fonctionnement

- **Accueil** : rejoindre une séance avec son code, ou créer une séance (animateur).
- **Associés** (`/#/s/CODE`) : vote de 1 à 5 sur chaque décision, modifiable jusqu'à la clôture. La liste se met à jour toute seule (toutes les 3 secondes). Le niveau proposé n'apparaît qu'à la phase Résultats.
- **Animateur** (`/#/s/CODE/animateur?k=CLÉ`) : QR code et code à projeter, édition de la liste en direct, choix de la phase, compteur de votants, remise à zéro.
- **Anonymat réel** : aucun vote individuel ne sort de la base, seulement les totaux (tout passe par des fonctions SQL, RLS sans policy).

### Les trois phases d'une séance

| Phase | Associés | Animateur |
|---|---|---|
| **Préparation** | voient la liste se mettre à jour, sans pouvoir voter | ajoute, modifie, supprime, réordonne les décisions |
| **Vote ouvert** | votent | liste verrouillée, suit le compteur |
| **Résultats** | voient les résultats et les niveaux proposés | idem |

L'animateur peut revenir en arrière à tout moment (onglet **Séance**). En préparation, modifier le **libellé** d'une décision déjà votée, ou la supprimer, efface ses votes : l'appli prévient et demande confirmation. Changer le domaine, le niveau proposé, la case « atelier » ou l'ordre n'efface rien.

## Mise en place (environ 15 minutes)

### 1. Supabase
1. Ouvre ton projet Supabase. Tu peux réutiliser celui de jury-cqp : les tables sont préfixées `curseur_`, pas de conflit.
2. Va dans **SQL Editor**, colle le contenu de `supabase/schema.sql`, clique sur **Run**.
3. Dans **Project Settings > API**, note l'**URL** du projet et la clé **anon public**.

#### Mise à jour d'une installation existante
`schema.sql` décrit toujours l'état complet à jour. Si l'appli tourne déjà, n'exécute pas `schema.sql` : exécute dans l'ordre les fichiers de `supabase/migrations/` qui n'ont pas encore été passés, **puis** redéploie le front.

| Migration | Contenu |
|---|---|
| `001_decisions_par_seance.sql` | décisions stockées par séance, phases Préparation / Vote ouvert / Résultats. Les séances existantes passent en « Vote ouvert » (ou « Résultats » si elles étaient révélées) et gardent leurs votes. |

### 2. GitHub
1. Crée un dépôt vide, par exemple `curseur-decision`.
2. Dans le dossier du projet :
   ```bash
   git init
   git add .
   git commit -m "Curseur de décision"
   git branch -M main
   git remote add origin https://github.com/TON-COMPTE/curseur-decision.git
   git push -u origin main
   ```

### 3. Vercel
1. **Add New > Project**, importe le dépôt `curseur-decision` (Vercel détecte Vite tout seul).
2. Dans **Environment Variables**, ajoute :
   - `VITE_SUPABASE_URL` = l'URL du projet Supabase
   - `VITE_SUPABASE_ANON_KEY` = la clé anon public
3. **Deploy**. L'appli est en ligne sur `https://curseur-decision.vercel.app` (ou un nom proche).

### En local (facultatif)
```bash
cp .env.example .env   # puis remplis les deux valeurs
npm install
npm run dev
```

## Le jour de la réunion
1. Ouvre l'appli, clique sur **Créer une séance**. Tu arrives sur la page animateur : **garde ce lien** (il est aussi listé sur l'accueil de ton appareil). La séance démarre en **Préparation**, avec la liste par défaut.
2. Projette l'onglet **Séance** : les associés scannent le QR code ou saisissent le code.
3. Projette l'onglet **Décisions** et ajuste la liste avec les associés : ajouter, modifier (✎), supprimer (deux clics), monter ou descendre. Les niveaux proposés y sont masqués ; la case « Afficher les niveaux proposés » les montre, à ne cocher que sur ton écran.
4. Clique sur **Ouvrir le vote** (en bas de l'onglet Décisions, ou dans l'onglet Séance). Suis le compteur de votants.
5. Quand tout le monde a voté, passe en phase **Résultats** et projette l'onglet **Résultats**.

Astuce : fais une séance de test avant la réunion, puis crée une séance neuve pour le jour J.

## Modifier la liste par défaut
Chaque nouvelle séance est pré-remplie avec la liste de `src/decisions.js` (`DEFAULT_DECISIONS`) : libellés, niveau proposé (`prop`), décisions de l'atelier (`test: true`).
Modifier ce fichier ne change pas les séances déjà créées : pendant une séance, on passe par l'onglet **Décisions**.
