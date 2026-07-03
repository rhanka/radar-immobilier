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
target_id: community:1
graph_hash: 87782f734787a455c53e0f538d50ce40184a267f3f77dad5a4b41b5cea50c419
prompt_version: wiki-description-v1

label: Community 1
member_count: 5
evidence_refs: walkthrough-transcript.md

top_members:
- Règlement de zonage (règlement_zonage) degree=6
- Procès-verbal municipal (procès_verbal) degree=5
- Changement de zonage (zonage_change) degree=3
- Avis de motion (avis_de_motion) degree=2
- Avis public municipal (avis_public) degree=2

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

/home/antoinefa/src/radar-immobilier/docs/spec/input/walkthrough/.graphify/.graphify/wiki/descriptions/community-1.json
