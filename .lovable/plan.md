# Reprise complète de Skills4mation

## Objectif
Reprendre fidèlement l’application du dépôt `ludovic-jpg/s4mfinal` dans Lovable, en conservant ses 19 écrans, sa navigation, sa charte visuelle et son noyau métier. Remplacer progressivement l’ancien serveur local par Lovable Cloud, sans changer les règles Qualiopi ni les droits des trois rôles.

## Étapes
1. **Importer le socle existant**
   - Reprendre les écrans, composants, styles, navigation, types métier, gabarits et tests utiles depuis la branche `v7`.
   - Adapter uniquement l’entrée et les routes à l’architecture TanStack Start du projet.
   - Conserver l’ancien serveur comme référence, sans l’exécuter.

2. **Mettre en place l’application visible**
   - Reproduire les pages publiques : connexion, inscription, invitation, positionnement et formulaires.
   - Reproduire le cadre connecté et les menus propres aux rôles admin, formateur et apprenant.
   - Conserver la palette ivoire, vert profond et jaune, ainsi que la mise en page mobile.

3. **Activer Lovable Cloud et poser le socle sécurisé**
   - Ajouter l’authentification, la base, le stockage privé et les fonctions serveur.
   - Appliquer les migrations de référence dans l’ordre, avec les droits d’accès et l’isolation par organisme.
   - Ne jamais exposer de clé sensible dans l’interface.

4. **Porter les fonctions par lots, dans l’ordre prévu par le dépôt**
   - Lot 1 : connexion, session et profil.
   - Lot 2 : organisme, formations, outils, coffres et répertoire.
   - Lot 3 : candidatures, réglages et courriers.
   - Lot 4 : dossiers et pipeline de validation.
   - Lot 5 : pièces, signatures, émargement et formulaires apprenant.
   - Lot 6 : positionnement public.
   - Lot 7 : espace pédagogique, IA, supports et ZIP.
   - Lot 8 : BPF, archives, sauvegarde et suppression de compte.
   - Tester chaque lot avec les rôles concernés avant de poursuivre.

5. **Recette finale**
   - Vérifier les parcours croisés admin, formateur et apprenant.
   - Vérifier les droits, les états chargement/erreur/vide, le clavier et l’affichage dès 390 px.
   - Comparer les parcours et rendus à l’application source, puis corriger les écarts.

## Contraintes à préserver
- Trois rôles uniquement : admin, formateur, apprenant.
- Les écrans existants restent la référence ; pas de refonte visuelle.
- Le pipeline ne change jamais directement depuis le navigateur.
- Signatures, empreintes, pièces, courriers, IA et opérations sensibles restent côté serveur.
- Une donnée cloisonnée absente retourne « introuvable », jamais une information sur son existence.
- Les données de démonstration restent réservées à l’environnement de test.

## Détails techniques
- TanStack Start reste le cadre de l’application Lovable ; les routes existantes seront transposées en fichiers de routes.
- Le noyau `src/domaine` reste pur et constitue la seule source des règles métier.
- Les appels des écrans continuent de passer par un client unique, porté progressivement vers Lovable Cloud.
- Les fonctions anciennes incompatibles avec l’hébergement moderne seront remplacées par des fonctions serveur compatibles, sans modifier leur contrat métier.
