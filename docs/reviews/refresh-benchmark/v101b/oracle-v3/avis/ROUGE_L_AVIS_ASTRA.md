# Avis contradictoire — Astra (gpt-6-astra, effort high)

**Recommandation ferme — privilégier les positions dans le texte source ; refuser la fusion automatique par ROUGE-L seul.**  
L’hypothèse du conducteur est étayée : à [Sainte-Barbe, u04], v1 commence par « Il est proposé par : Élodie Tricoire. », tandis que v2 conserve « accepte la demande de PIIA 2026-0055 tel que recommandé par le Comité consultatif d’urbanisme » ; les votes se divisent entre ces versions emboîtées.  
Mais reconnaître une même unité et approuver sa description sont deux décisions différentes : regrouper les variantes ne doit pas transformer un désaccord de fond en unanimité.  
Je recommande une colonne exploratoire séparée, intitulée « appariement par passage source », sans présenter tout gain comme une reformulation correcte.

**Formule retenue — coefficient de recouvrement des intervalles.**  
Pour deux occurrences exactement localisées, \(I=[a,b)\) et \(J=[c,d)\), sur une même page du même texte normalisé : \(C(I,J)=\frac{\max(0,\min(b,d)-\max(a,c))}{\min(b-a,d-c)}\).  
Une inclusion donne \(C=1\), même avec des découpages de longueurs différentes ; deux passages disjoints donnent zéro malgré des formulations identiques. Ce coefficient propose un rapprochement, sans prouver l’identité de l’acte.  
ROUGE-L conserve l’ordre des jetons, mais peut aligner des formules rituelles éloignées ; le F1 de jetons ignore leur ordre ; Jaccard sur n-grammes dépend du choix de \(n\) et des coupures ; la distance d’édition pénalise les extensions pourtant légitimes. Aucun ne localise la preuve.  
BLEU-4 standard est mal adapté ici ; un BLEU de phrase lissé à ordre effectif réduit serait défendable comme diagnostic lexical, mais conserverait l’asymétrie et la pénalité de brièveté, sans résoudre l’identité juridique.

**Conditions d’application — ajouter une identité d’acte, pas seulement une adresse.**  
À [Valcourt, u01/u02], « 1070, RUE BISSONNETTE - PIIA BOISÉ DU RUISSEAU - LOTISSEMENT » et le PIIA de construction de deux bâtiments concernent la même adresse et la même étape, mais deux points distincts.  
Exiger donc même document gelé, objet canonique exact, étape vérifiée, procédure, opération et statut compatibles — prévu, accordé, refusé — ainsi qu’un rattachement au même dossier ou point de décision ; une occurrence ambiguë impose une revue. Avis de motion et adoption sont déjà séparés si leurs étapes sont correctement étiquetées.  
Dans l’oracle, conserver les versions et les motifs ; seul un désaccord limité au découpage peut être regroupé. Un vote « absent » motivé par le périmètre ou une divergence sur une contrainte demeure à arbitrer.  
Dans la notation, empêcher le double crédit d’une unité et préserver les règles des nœuds groupés ; ne pas fusionner transitivement A–B–C sur la seule base de recouvrements successifs.  
Je confirme les interdits : aucun assouplissement de l’ancrage ni des identifiants ; seuls des alias déterministes documentés sont admissibles. Les documents refusés restent des échecs dans les deux colonnes.

**Risques restants et seuil — les 36 unités ne constituent pas une validation suffisante.**  
À [Saint-Barthélemy, u07], deux versions ont exactement la même citation, mais seule la seconde explicite « aménagements permanents interdits sauf travaux de correction majeurs de la pente » : même un score maximal ne valide pas le libellé.  
Les intervalles manquent aussi les preuves équivalentes éloignées : [B158] possède des sites aux pages 2 et 14 ; traiter ces sites par équivalences explicitement validées.  
La calibration doit porter sur des **paires annotées comme identiques ou distinctes**, avec négatifs difficiles. L’[oracle manuel] contient 31 citations sur 36 dépassant 200 caractères, 17 unités d’un seul document et un corrigé Waterloo partiel : ses citations ne reproduisent pas directement le format v3.  
Fixer préalablement une tolérance de faux appariements, choisir le seuil sur un lot de calibration, puis le tester sur des documents réservés, sans consulter les classements des modèles ; publier paires, normalisation, seuil, précision/rappel, intervalles d’incertitude et courbe des correspondances.  
À titre illustratif, zéro erreur sur 36 décisions indépendantes laisserait une borne supérieure unilatérale à 95 % de \(1-0{,}05^{1/36}\approx8\,\%\) ; ici, les unités ne sont même pas 36 décisions d’appariement indépendantes. La courbe seule ne justifie donc aucun seuil.

**Paragraphe proposé pour le rapport — à employer tant que cette validation reste à faire.**  
« Nous proposons, en complément du score exact, une analyse exploratoire des différences de découpage entre citations retrouvées exactement dans le document source. Le rapprochement reposera sur leur recouvrement positionnel et sur la vérification qu’elles décrivent le même acte, avec le même objet, la même étape et les mêmes conditions. Il ne corrigera ni une citation absente du document, ni un identifiant erroné, ni un désaccord de fond. Le seuil devra être validé sur des paires annotées et des documents réservés ; les cinq documents manuels ne suffisent pas à démontrer sa fiabilité. Les gains seront publiés séparément, avec les erreurs d’appariement observées, les ambiguïtés et les exclusions non résolues ; ils ne modifieront pas le score principal. »
