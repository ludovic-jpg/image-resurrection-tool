# Recette racontée : une semaine dans la vie d'un organisme de formation Qualiopi

Ce scénario fait passer par **toutes** les fonctionnalités de la plateforme, dans l'ordre où un organisme les vit.
Chaque étape donne **ce que tu fais**, **ce que tu dois voir**, puis une lecture **Qualiopi** : les avantages pour
l'OF, et les limites ou vigilances. Compte **1 h 30 à 2 h** pour tout dérouler.

> **Avant de commencer.** Lance l'application sur une base neuve (voir `GUIDE_LANCEMENT.md`, §3). Deux personnages
> principaux : **Ludovic**, formateur (compte `ludoalbisser@gmail.com` / `1234ludo`, vide au départ), et **l'OF**
> (compte `admin@demo.example` / `demonstration-s4m`). La formatrice de démonstration **Sophie**
> (`formatrice@demo.example`) a déjà un historique complet : utile pour comparer.
>
> Les numéros d'indicateurs renvoient au **Référentiel national qualité** (Qualiopi, 32 indicateurs). Ce sont des
> repères pour préparer un audit, pas un avis d'auditeur : vérifie-les avec ton certificateur.

Coche chaque ligne. Une ligne qui ne se passe pas comme prévu devient un ticket en une phrase : « je fais X, j'attends
Y, j'obtiens Z ».

---

## Lundi matin — Ludovic arrive sur la plateforme

**☐ 1. Connexion et menu.** Connecte-toi avec `ludoalbisser@gmail.com` / `1234ludo`.
*Attendu :* « Bonjour Ludovic », trois cartes (Espace pédagogique, Espace apprenant, Espace formation) ; dans le rail
latéral, en plus : « Coffre-fort pédagogique », « Positionnements », et le groupe « Mon espace » (profil, archives).

**☐ 2. Profil et candidature.** « Mon profil et candidature » → onglet *Mon profil* : choisis ton statut juridique
(liste), coche tes domaines (*Commercial, vente et prospection*…), zones, langues, tarif journalier, RC Pro ;
enregistre. Onglet *Justificatifs* : ajoute une attestation URSSAF avec une date de validité **passée**.
*Attendu :* bandeau orange « Justificatif(s) à renouveler ». Nom et prénom sont grisés (compte déjà validé).

> **Qualiopi.** ✅ Avantage : le profil documente la compétence des intervenants (**ind. 21**) et le suivi des
> sous-traitants, avec l'échéance de leurs attestations (**ind. 27**, organisme qui porte des formateurs
> indépendants). ⚠️ Limite : l'alerte d'échéance s'affiche au formateur ; l'OF ne reçoit pas encore de relevé
> global des attestations échues (voir `SUITE_ET_TODO.md`).

## Lundi après-midi — concevoir le parcours

**☐ 3. Générer le parcours.** *Mes formations → Nouvelle formation.* Saisis seulement : intitulé « Améliorer ma
prospection », niveau *Débutant* (liste), 14 heures, 2 jours, **3 modules** (liste), tarif 1 400 €. Moteur *Trame
pédagogique automatique*. Clique **Générer le parcours**.
*Attendu :* l'onglet *2. Parcours* s'ouvre avec 3 modules ; « Somme des modules : 14 h / durée totale 14 h » ;
objectifs et programme déjà rédigés.

**☐ 4. Aménager puis enregistrer.** Renomme le module 1 en « Cibler ses prospects », ajoute un point de contenu,
descends le module 2, puis **Réécrire objectifs et programme depuis les modules**. Change une durée pour que la somme
ne tombe plus juste, et **Enregistrer**.
*Attendu :* refus clair « La somme des durées des modules … doit égaler la durée totale ». Corrige, enregistre : la
fiche s'ouvre, avec « Parcours enregistré » à droite.

**☐ 5. Enregistrer à tout moment.** Modifie le tarif sans enregistrer, puis **ferme l'onglet du navigateur**.
Rouvre la fiche. *Attendu :* bandeau « Un brouillon non enregistré … a été retrouvé » → *Reprendre le brouillon*.

**☐ 6. Champs de convention.** Onglet *3. Convention* : mode de financement *OPCO*, financeur *OPCO EP* (liste des
11 OPCO + FAF), effectifs 2 à 8, coût horaire formateur 60 €. Onglet *4. Qualiopi* : public visé (suggestions), délai
d'accès *Sous 2 semaines*, sanction, **« Insérer une mention type »** pour l'accessibilité. Enregistre. Mets
volontairement l'effectif minimum au-dessus du maximum : refus.

**☐ 7. Historique.** Bouton **Historique** : chaque enregistrement précédent est listé ; **Restaurer** une version
ancienne, puis constate que l'état « d'avant restauration » est lui aussi dans l'historique.

> **Qualiopi.** ✅ Avantages : objectifs **opérationnels et évaluables**, formulés avec des verbes d'action, par module
> (**ind. 5**) ; contenus, méthodes, mise en pratique et évaluation décrits (**ind. 6**) ; délai d'accès, tarifs,
> accessibilité, modalités publiés dans le programme (**ind. 1**, **ind. 26**) ; l'historique trace l'évolution des
> programmes (preuve d'amélioration, **ind. 32**). ⚠️ Limites : la **trame** structure, elle ne connaît pas le
> métier : un auditeur attend un contenu propre à la formation — le formateur **doit** réécrire les contenus.
> L'IA rédige un contenu réel, mais reste un brouillon à relire (erreurs possibles, sources à vérifier).

## Mardi — le kit pédagogique

**☐ 8. Test de positionnement.** Fiche formation → *Kit pédagogique* → **Générer le test de positionnement** →
*10 questions*, moteur *Trame* → **Générer le brouillon**. Aménage une question, **Enregistrer le modèle**.
*Attendu :* le test apparaît sous « Questionnaires rattachés ».

**☐ 9. Évaluation des acquis.** Même geste avec **Générer l'évaluation des acquis**. Ajoute à la main deux questions
de connaissances (bonne réponse cochée).

**☐ 10. Supports PPTX.** **Produire les supports PPTX** → module 1 → **Préparer le plan du module**.
*Attendu :* 20 diapositives (titre, objectifs, amorce, notions, schéma, exemple, point d'étape, atelier : consigne et
critères, débriefing, vigilance, synthèse, quiz). Ouvre la diapositive 14, modifie la consigne, puis **Produire le
PPTX**. Recommence avec **Produire tous les modules d'un coup**.
*Attendu :* message « … est dans le coffre-fort » ; ouvre le PPTX dans PowerPoint : 20 diapositives, notes du
formateur dans le mode présentateur, un cadre « Visuel suggéré » où placer ton image.

> **Qualiopi.** ✅ Avantages : positionnement à l'entrée (**ind. 8**) et évaluation de l'atteinte des objectifs
> (**ind. 11**) directement dérivés des objectifs du parcours, donc cohérents entre eux (l'auditeur vérifie ce fil
> rouge) ; supports conçus avec des temps de pratique et de vérification (**ind. 6**, **ind. 19**). ⚠️ Limites :
> la trame propose un **auto-positionnement** — accepté pour situer un niveau de départ, mais **insuffisant seul pour
> évaluer des acquis** : complète l'évaluation finale par des questions de connaissances ou une mise en situation. Les
> PPTX n'embarquent pas d'images : le cadre « visuel suggéré » est à remplacer.

## Mercredi matin — le coffre-fort pédagogique

**☐ 11. Le coffre du parcours.** Menu **Coffre-fort pédagogique** → carte « Améliorer ma prospection ».
*Attendu :* onglet *Pédagogique* déjà rempli : supports PPTX générés, programme (PDF), tests (vierge / corrigé).

**☐ 12. Déposer.** **Déposer un document** : un PDF d'exercices, rubrique *Exercice / cas pratique*, partagé. Puis un
« Règlement intérieur », rubrique *Document qualité* (privé par défaut). *Attendu :* le premier dans *Mes supports
déposés*, le second dans l'onglet *Administratif*.

**☐ 13. Corbeille.** Mets un fichier à la corbeille, onglet *Corbeille* → **Restaurer**. Puis *Supprimer
définitivement* (confirmation demandée). **Tout télécharger (ZIP)** : l'archive est rangée par rubrique.

> **Qualiopi.** ✅ Avantages : un point unique où retrouver, par parcours, les ressources mises à disposition
> (**ind. 19**), les documents d'information (règlement, livret : **ind. 9**) et les preuves ; le ZIP sert de
> dossier de preuves pour l'audit. La corbeille évite les pertes de preuves par erreur. ⚠️ Limites : le partage vers
> l'apprenant s'ouvre seulement à l'accord de financement (règle RG-08) ; l'OF consulte mais ne dépose pas dans le
> coffre d'un formateur.

## Mercredi après-midi — un nouvel apprenant et son positionnement

**☐ 14. Apprenant + entreprise en un geste.** *Apprenants et entreprises → Nouvelle fiche apprenant* : Julie Test,
e-mail, puis dans « Entreprise de rattachement » : **+ Créer une nouvelle entreprise…** → raison sociale, SIRET,
**OPCO** (liste), représentant. Enregistre. *Attendu :* Julie apparaît avec son entreprise ; l'entreprise est dans
l'onglet *Entreprises*.

**☐ 15. Inviter à se positionner.** Sur la ligne de Julie : **Positionner** → parcours « Améliorer ma prospection »,
message personnel → **Envoyer l'invitation**. *Attendu :* « Invitation envoyée … le lien est aussi copié ».
*Boîte d'envoi* : l'e-mail « Votre positionnement — Améliorer ma prospection ».

**☐ 16. Côté apprenant.** Ouvre le lien de l'e-mail dans une **fenêtre privée** (ou sur ton téléphone). *Attendu :*
page « Mon positionnement », nom et e-mail de Julie grisés, partie **A** (recueil), partie **B** (test), date du jour,
« Fait à », zone de signature. Réponds à moitié, **Enregistrer et reprendre plus tard**, ferme ; rouvre le lien :
les réponses sont là. Termine, signe au doigt ou à la souris, coche la certification, **Signer et envoyer**.
*Attendu :* « Votre positionnement est complet et signé » + **Télécharger mon positionnement (PDF)**.

**☐ 17. Tout le monde a le PDF.** Côté Ludovic : *Positionnements* → « Complet et signé », score, **PDF signé** ; le
coffre du parcours (onglet *Administratif*) le montre aussi ; la boîte d'envoi contient l'e-mail « Positionnement
complété » avec le PDF joint. Côté OF (`admin@demo.example`) : *Positionnements* → même PDF. Ouvre le PDF : réponses,
score, signature, horodatage, empreinte.

**☐ 18. Relance et archive.** Invite un second apprenant sans répondre ; **Relancer** (un nouveau lien part, l'ancien
cesse de fonctionner) ; **Archiver** puis restaurer depuis l'onglet *Archivés*.

> **Qualiopi.** ✅ Avantages : **analyse du besoin** (**ind. 4**) et **positionnement** (**ind. 8**) réalisés
> **avant** l'entrée en formation, signés, datés, archivés, retrouvables en un clic — c'est souvent là que les audits
> relèvent des non-conformités ; la prise en compte du handicap est posée dès le recueil (**ind. 26**). Pas de compte
> à créer : moins d'abandons. ⚠️ Limites : le lien personnel **vaut identification** — s'il est transféré, un tiers
> peut répondre (signature électronique **simple**) ; pas encore de relance automatique à J+3 / J+7.

## Jeudi — le dossier et la convention

**☐ 19. Créer le dossier.** *Générateur de conventions* : Julie → son entreprise (proposée d'office) → « Améliorer ma
prospection » (modalité et financement repris du catalogue) → **Créer le dossier**.
*Attendu :* dans le dossier, **Recueil des besoins** et **Test de positionnement** déjà **Validés** (repris du
positionnement signé : aucune ressaisie) ; financeur = l'OPCO de l'entreprise.

**☐ 20. Partie financière.** Dans le dossier : intitulé, niveau, modalité, heures présentiel/distanciel, SIRET du lieu,
public, prérequis, et le cadre **« Partie financière de la convention »** (mode, financeur, prix, coût formateur,
lieu de signature). Ajoute dates et séances, enregistre. **Demander la validation à l'organisme**.

**☐ 21. Validation par l'OF.** Connecte-toi en `admin@demo.example` → le dossier « En cours de validation » →
**Valider le dossier**. *Attendu :* convention, planning, **programme** générés ; e-mail à l'entreprise avec les pièces.
Aperçu de la convention : compare avec `exemple-convention.pdf` (même structure, tes valeurs).

**☐ 22. Coffre, partie administrative.** Retourne dans le coffre du parcours → *Administratif* → le dossier apparaît,
avec la progression de ses pièces et leurs téléchargements.

**☐ 23. Suite du parcours apprenant** (déjà testée le 23/09) : signature de la convention, « J'affirme avoir déposé »,
accord, ODM, émargement, évaluations, attestation — voir `RECETTE_23-09.md`, §3.

> **Qualiopi.** ✅ Avantages : conventions **exactes** (aucune IA sur les pièces contractuelles), cohérentes avec le
> programme annexé ; dossier constitué seulement si recueil + positionnement existent (RG-02) ; chaque pièce tracée
> dans le journal. ⚠️ Limites : la convention reste signée **par l'apprenant** dans l'application alors qu'elle engage
> l'entreprise (hypothèse n° 11, à trancher avant la production).

## Vendredi — archives, sauvegarde, et contrôle

**☐ 24. Archives et sauvegarde.** *Mon espace → Archives et sauvegarde* : tout ce que tu as archivé ou mis à la
corbeille cette semaine est là → **Restaurer**. **Télécharger ma sauvegarde** (fichier JSON). Archive une formation,
puis **Restaurer depuis une sauvegarde** : une copie « (restaurée) » réapparaît, avec son parcours.

**☐ 25. Admin : vue d'ensemble.** En `admin@demo.example` : *Coffres-forts pédagogiques* (tous les formateurs, en
lecture), *Positionnements* (tous), *Candidatures* (le profil étendu de chaque formateur), *BPF*.

**☐ 26. Téléphone.** Refais les étapes 16 et 11 sur un téléphone (ou une fenêtre de 375 px) : rien ne déborde.

> **Qualiopi.** ✅ Avantages : conservation et restitution des preuves (**ind. 32**, et obligations de conservation) ;
> l'OF garde la main sur tous les coffres et positionnements de ses formateurs (**ind. 17**, **ind. 27**).
> ⚠️ Limites : la sauvegarde JSON couvre l'espace **pédagogique** d'un formateur, pas les fichiers du coffre ni les
> dossiers ; la sauvegarde **complète** reste la copie de `donnees/` (base + archive), à automatiser en production.

---

## Synthèse pour un OF Qualiopi

| Fonctionnalité | Indicateurs servis | Avantage principal | Vigilance principale |
|---|---|---|---|
| Générateur de parcours (trame / IA) | 5, 6, 1 | Programme structuré en minutes, cohérent avec les évaluations | La trame doit être réécrite avec l'expertise métier |
| Tests générés depuis le parcours | 8, 11 | Fil rouge objectifs → positionnement → acquis | Auto-évaluation insuffisante seule pour les acquis |
| Supports PPTX 20 diapositives / module | 6, 19 | Supports homogènes, pédagogie active intégrée | Visuels à ajouter ; contenu IA à vérifier |
| Coffre-fort par parcours | 9, 19, 32 | Toutes les preuves au même endroit, ZIP d'audit | Partage apprenant seulement après l'accord |
| Positionnement avant dossier (signé, PDF) | 4, 8, 26 | Preuves datées et signées avant l'entrée | Lien personnel = identification simple |
| Champs de convention complets | 1, contractuel | Conventions exactes, sans ressaisie | Signataire de la convention à trancher (H11) |
| Profil + justificatifs à échéance | 21, 27 | Suivi des formateurs sous-traitants | Pas encore de tableau de bord OF des échéances |
| Archives, corbeille, versions, sauvegarde | 32 | Rien ne se perd, tout se retrouve | Sauvegarde complète = copie de `donnees/` |
