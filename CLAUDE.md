# Curseur de décision – Hauteur & Sécurité

Appli web de vote anonyme pour les réunions d'associés de la SCOP Hauteur & Sécurité.
Chaque associé place un curseur de 1 à 5 sur des décisions, pour définir qui décide quoi :
1 = directeur seul, 2 = directeur + information, 3 = Président + information motivée,
4 = Président après consultation des associés, 5 = vote des associés.

## Stack
- React 18 + Vite, sans router (routage par hash : `#/`, `#/s/CODE`, `#/s/CODE/animateur?k=CLÉ`)
- Supabase : tables et fonctions préfixées `curseur_` (le projet Supabase est partagé avec une autre appli)
- Déploiement Vercel (variables VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY)

## Règles de sécurité (ne pas casser)
- RLS activée sans aucune policy : aucun accès direct aux tables depuis le front.
- Tout passe par des fonctions RPC `security definer` avec `set search_path = public`.
- Les actions animateur sont protégées par `admin_key` vérifiée côté SQL.
- Aucun vote individuel ne doit jamais sortir de la base : seulement des totaux agrégés.
- Toute nouvelle fonction : `grant execute ... to anon, authenticated`.

## Conventions
- Sous-composants React toujours définis HORS de `App` (sinon perte de focus au re-rendu).
- Textes de l'interface en français, ton direct, phrases courtes.
- Charte : orange #E95A0C, anthracite #444749, polices Barlow et Barlow Condensed.
- Les migrations SQL vont dans `supabase/migrations/` (fichiers numérotés), `schema.sql` reste l'état complet à jour.
- Livrer des fichiers complets plutôt que des extraits quand on me montre du code.
- Avant tout `git push`, me demander confirmation.

## Tests
- Tester les fonctions SQL sur un PostgreSQL local avant de livrer (créer les rôles `anon` et `authenticated` pour que les `grant` passent).
- `npm run build` doit passer.
