# Text JSON Generation: graphify_wiki_description_v1

Graphify is running in assistant mode. Do not call an external provider from Graphify runtime.

## Prompt

You are graphify. Generate a short source-grounded wiki description.

Constraints:
- 3 to 6 sentences.
- No speculation.
- No marketing language.
- Only use the context below.

target_kind: community
target_id: community:0
graph_hash: 87782f734787a455c53e0f538d50ce40184a267f3f77dad5a4b41b5cea50c419
prompt_version: wiki-description-v1

label: Community 0
member_count: 7
evidence_refs: walkthrough-transcript.md

top_members:
- Walkthrough démo radar-immobilier — transcript (radar_demo_transcript) degree=13
- Carte interactive de zonage (carte_interactive_zonage) degree=1
- rad-ar i-mmo dmo - 2026_06_09 17_49 EDT - Recording.mp4 (rad_ar_i_mmo_dmo_recording) degree=1
- Scraper de procès-verbaux (scraper_procès_verbal) degree=1
- Vidéo de réunion municipale (vidéo_meeting_municipal) degree=1
- Mistral Voxtral (voxtral-mini-latest) (voxtral_mini_latest) degree=1
- Transcription YouTube (youtube_transcript) degree=1

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

/home/antoinefa/src/radar-immobilier/docs/spec/input/walkthrough/.graphify/.graphify/wiki/descriptions/community-0.json
