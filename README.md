# Curseur de décision – Hauteur & Sécurité

Petite appli web de vote anonyme pour la réunion d'associés.
Les associés rejoignent la séance avec un code ou un QR code, **sans compte**.
Stack identique à jury-cqp : React + Vite, Supabase, Vercel.

## Fonctionnement

- **Accueil** : rejoindre une séance avec son code, ou créer une séance (animateur).
- **Associés** (`/#/s/CODE`) : vote de 1 à 5 sur chaque décision, modifiable jusqu'à la fin. Le niveau proposé n'apparaît pas pendant le vote.
- **Animateur** (`/#/s/CODE/animateur?k=CLÉ`) : QR code et code à projeter, compteur de votants en direct, révélation des résultats, remise à zéro.
- **Anonymat réel** : aucun vote individuel ne sort de la base, seulement les totaux (tout passe par des fonctions SQL, RLS sans policy).

## Mise en place (environ 15 minutes)

### 1. Supabase
1. Ouvre ton projet Supabase. Tu peux réutiliser celui de jury-cqp : les tables sont préfixées `curseur_`, pas de conflit.
2. Va dans **SQL Editor**, colle le contenu de `supabase/schema.sql`, clique sur **Run**.
3. Dans **Project Settings > API**, note l'**URL** du projet et la clé **anon public**.

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
1. Ouvre l'appli, clique sur **Créer une séance**. Tu arrives sur la page animateur : **garde ce lien** (il est aussi listé sur l'accueil de ton appareil).
2. Projette l'onglet **Séance** : les associés scannent le QR code ou saisissent le code.
3. Suis le compteur de votants. Quand tout le monde a voté, clique sur **Révéler les résultats à tous** et projette l'onglet **Résultats**.

Astuce : fais une séance de test avant la réunion, puis crée une séance neuve pour le jour J.

## Modifier les décisions
Tout est dans `src/decisions.js` : libellés, niveau proposé (`prop`), décisions de l'atelier (`test: true`).
Ne change pas l'`id` d'une décision pendant une séance en cours.
