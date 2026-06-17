# SPEC INTENT — DS-aligned map selection buckets

> Status: intent clarification for the redesign.
> Date: 2026-06-17.
> Scope: Design System alignment, map selection buckets, zone/lot display, data quality view, and admin validation.

## 1. Owner brief, verbatim

The following French brief is intentionally preserved verbatim so the product intent remains traceable.

> 1 - l'alignement DS
>
> 2.- travailler sur une UX de "bucket de sélection".
> comme sur graphify, il faut pouvoir sélectionner/déselectionner des objets sur la arte (ville, zone lot). Ce qui est sélectionné est en pleine couleur là ou ce qui ne l'est pas est rendu 50% plus transparent. le pane de droite sert aux sélcetion (villes, zones, lots) comme dans graphify. La difféence entre le pane de gauche et le pane de droit n'est que le statut de selection, mais la représntation est la même. comme dans graphify, on replie la selection par groupe (ville, signal, zones, lots)
> - chaque ville, signal, zone, lot est un éléments dépliable. ville > (signaux > lise signaux) + (zones > liste zones > liste lots).
> - Le contenu détaillé (fiche) n'est pas accessible à gauche, seulement à droite. A droite on a les catégories: villes, signaux, zones, lots (accordéon dépliable) et pour chacune on déplie une fiche à l'intérieur avec les éléments de description (pour zones et lots: les éléments de la "carte de steve", je suppose. Et pour les signaux, il faut la citation + le pdf (qui quand cliqué s'ouvre en surimpression/ de la carte, pas vraiment un modal mais il faut afficher le pdf, si possible avec en jaune la sélection de la citation, ou un bbox).
>
> 3. incorporer les zones et lots déjà obtenus (affichages dans le même style que la "carte de steve").
> objectif: parmis les 33 pouvoir afficher au moins un poignée ou l'on a zones et lots. On sait qu'on n'a pas toutes les zones en geojson, mais à la rigueur si on a dans les lot leur zone d'appartenance en métadonnée, on peut peut être au moins les représenter par groupe de couleur (l'union des lots fait la zone, en fallback)
>
> 4. vue data: il faut avoir une vue par ville de la qualité des données (pv+youtube, ontologie, zones, lots)
>
> 5. vue admin: il faut pouvoir gérer la validation des utilisateurs

## 2. Normalized intent

The redesign should turn the map into the primary work surface. Left and right panes represent the same object model; the difference is selection state and detail depth.

- The left pane is for discovery and grouping, without detailed cards.
- The right pane is the selection bucket and is the only place where detailed cards open.
- Map objects can be selected and deselected directly: municipality, signal, zone, lot.
- Selected map objects render at full opacity; non-selected objects render about 50% more transparent.
- Grouping follows Graphify-like collapsible buckets: municipalities, signals, zones, lots.
- Hierarchy is not linear. The left tree is:
  `municipality -> { signals[], zones[] }` and `zone -> lots[]`.
  Signals may link to zones and lots through graph relations, but zones are
  not children of signals in the discovery tree.
- The right selection bucket remains grouped by object category:
  municipalities, signals, zones, lots. Selection state, focus state, and
  expansion state are separate concepts.

## 3. Detail model

Each object type is expandable in both panes, but detailed content is right-pane only.

- Municipality details: city coverage, relevant signal counts, data freshness, and source maturity.
- Signal details: description, citation, source PDF link, source date, stage/category, confidence, and linked zone/lot context when available.
- Zone details: zone code, permitted uses, density, heights/floors, grille PDF, provenance, geometry quality, and Steve-map style counters.
- Lot details: lot number, area, address when available, zone membership, role/valuation fields when available, TOD/environment flags, notes and prospect status.

Source document opening is an overlay above the map surface, not a full page escape. For signals, clicking the citation/PDF should open the PDF with the citation highlighted when text spans or bounding boxes are available; otherwise it should open the document with the best available page/source anchor.

Graphify signal cards have a mandatory evidence contract:

- This UI contract depends on `SPEC_INTENT_GRAPHIFY_V23_EVIDENCE.md`. v2.3 is the graphify refresh expected to provide exhaustive descriptions, citations, and PDF/raw links for priority cards.
- Graphify extraction must request textual descriptions by default for `Signal` and `DesignationEvent` nodes.
- The right-pane signal card must display the graphify description, a citation excerpt, and a source PDF link together.
- `properties.description` is a valid input description when graphify stores the description under node `properties`; API/UI code must not require only a top-level `description` field.
- `refs[]` should carry the structured citation when available: document SHA, excerpt, page or bounding box, source URL or raw object reference.
- If description, citation, or PDF link is missing, the card must show an explicit incomplete-source state rather than silently hiding the missing evidence.

The source document link must be resolved by the API, not assembled in the
browser from a private storage key. The UI uses, in order:

1. a public `sourceUrl` when graphify or the document projection has one;
2. an API-controlled document route when only a private `rawRef` or `docSha`
   is available;
3. an explicit missing-document state when neither can be resolved.

Signal cards must label dates by meaning:

- `Published` / `Publié`: source listing or manifest `publishedAt`.
- `Meeting` / `Séance`: `meetingDate` extracted from the PV body when known.
- `Stage` / `Étape`: `etape_date`.
- `Ingested` / `Ingestion`: DB projection time, diagnostic only.

## 4. Data incorporation target

The immediate demo goal is not full province-wide zone geometry. It is to show, among the 33 priority `z|m|p` detections, at least a handful where zones and lots can be displayed credibly.

Display order:

1. Use official zone GeoJSON when available.
2. If zone geometry is missing but lots carry zone membership metadata, render the zone as a colored lot group; the union of those lots is the fallback zone representation.
3. If only textual zone/lot mentions exist, show them in the selection bucket with an explicit geometry-missing state.

The visual style for zones and lots should follow the Steve-map integration spec: colored lots, clear zone labels, compact counters, and honest badges for simulated/partial/unavailable data.

## 5. DS alignment constraint

The redesign is a Design System alignment task, not a new bespoke shell.

- Header, left rail, right rail, accordions, buttons, search, badges, drawers/overlays, tabs, tables, empty states, and loading states should use `@sentropic/design-system-svelte` primitives where they exist.
- Any local component kept because the DS has no equivalent must be listed as a DS gap with a tracked request.
- The deployed header must align with the DS AppShell/Header contract: no custom visual gap, no bespoke chrome styling where a DS primitive exists.
- "0 bespoke" means zero bespoke implementation for UI primitives already
  covered by the DS. Domain-specific map components may remain local only
  when the DS has no published equivalent, and each case must be tracked as
  a DS gap.
- DS requests should be routed to the Codex design-system lane via h2a, not to a Claude-only design-system lane.

## 6. Data quality view

Add a per-city data quality view. It should make coverage and trust visible before the user interprets a signal.

Minimum dimensions:

- Council minutes coverage: collected, parsed, graphified, date window.
- YouTube/session coverage: available, transcribed, graphified, date window.
- Ontology coverage: graph version, model/run provenance, projection freshness, stale-node risk.
- Zone coverage: official GeoJSON, PDF-only, inferred/fallback, missing.
- Lot coverage: cadastre geometry, role/valuation enrichment, zone membership, source freshness.

## 7. Admin view

The admin view must support user validation. At minimum:

- See pending users.
- Approve a user.
- Reject or suspend a user.
- See current validation status.
- Only an admin role may change validation status.
- Status transitions must be auditable with actor, timestamp, target user,
  previous status, new status, and optional reason.
- Revoking or suspending a user must be enforced on existing sessions, not
  only on the next login.

## 8. Implementation lanes

The redesign should be split into independent implementation lanes so the
graphify v2.3 wait does not block product UI work:

1. DS shell and rails: App shell, header, left rail, right rail, common
   rail states, and tracked DS gaps.
2. Selection bucket UX: shared selection model, map opacity rules, left
   discovery tree, right detail bucket, and document overlay fallback states.
3. Zones and lots incorporation: official geometry first, lot-group fallback
   second, text-only or missing geometry states when data is not available.
4. Data quality and admin: per-city data-quality summary plus user
   validation, suspension, and session enforcement.

## 9. Acceptance criteria

- The spec is discoverable from `docs/spec/`.
- Track contains work items for DS alignment and selection buckets.
- The first implementation branch can be scoped without inventing additional product intent.
- Critical demo data remains protected: the 33 priority `z|m|p` detections must not be silently reduced by projection cleanup or deterministic replacement.
- Signal cards show description + citation + PDF link for graphify-backed signals whenever the graph provides them, with explicit missing-evidence states otherwise.
- Clicking a signal citation opens a map-surface document overlay. The overlay
  navigates to the cited page when available and highlights the provided bbox
  when available; when bbox is absent it still opens the best known page or
  document link without fabricating coordinates.
