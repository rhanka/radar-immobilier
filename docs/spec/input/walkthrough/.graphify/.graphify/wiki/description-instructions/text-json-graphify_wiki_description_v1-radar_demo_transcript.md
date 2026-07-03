# Text JSON Generation: graphify_wiki_description_v1

Graphify is running in assistant mode. Do not call an external provider from Graphify runtime.

## Prompt

You are graphify. Generate a short source-grounded wiki description.

Constraints:
- 3 to 6 sentences.
- No speculation.
- No marketing language.
- Only use the context below.

target_kind: node
target_id: radar_demo_transcript
graph_hash: 87782f734787a455c53e0f538d50ce40184a267f3f77dad5a4b41b5cea50c419
prompt_version: wiki-description-v1

label: Walkthrough démo radar-immobilier — transcript
degree: 13
node_type: unknown
community: 0 (Community 0)
evidence_refs: walkthrough-transcript.md

neighbors (up to 12):
- [contient] rad-ar i-mmo dmo - 2026_06_09 17_49 EDT - Recording.mp4 (rad_ar_i_mmo_dmo_recording) [walkthrough-transcript.md]
- [discute] Changement de zonage (zonage_change) [walkthrough-transcript.md]
- [discute] Règlement de zonage (règlement_zonage) [walkthrough-transcript.md]
- [mentionne] Avis public municipal (avis_public) [walkthrough-transcript.md]
- [mentionne] Carte interactive de zonage (carte_interactive_zonage) [walkthrough-transcript.md]
- [mentionne] Dérogation mineure (dérogation_mineure) [walkthrough-transcript.md]
- [mentionne] MRC de la Matapédia (mrc_matapedia) [walkthrough-transcript.md]
- [mentionne] Procès-verbal municipal (procès_verbal) [walkthrough-transcript.md]
- [mentionne] Transcription YouTube (youtube_transcript) [walkthrough-transcript.md]
- [mentionne] Vidéo de réunion municipale (vidéo_meeting_municipal) [walkthrough-transcript.md]
- [mentionne] Ville de Saint-Damase (ville_saint_damase) [walkthrough-transcript.md]
- [propose] Scraper de procès-verbaux (scraper_procès_verbal) [walkthrough-transcript.md]

Output:
Return JSON fields that Graphify will wrap into graphify_wiki_description_v1:
{
  "status": "generated",
  "description": "...", 
  "evidence_refs": ["src/file.ts"],
  "confidence": 0.79
}

If confident context is insufficient, use status "insufficient_evidence",
with description: null, evidence_refs: [] and confidence: null.

## Expected Output

/home/antoinefa/src/radar-immobilier/docs/spec/input/walkthrough/.graphify/.graphify/wiki/descriptions/radar_demo_transcript.json
