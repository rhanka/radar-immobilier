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
target_id: règlement_3835
graph_hash: 87782f734787a455c53e0f538d50ce40184a267f3f77dad5a4b41b5cea50c419
prompt_version: wiki-description-v1

label: Règlement 3835
degree: 3
node_type: unknown
community: 2 (Community 2)
evidence_refs: walkthrough-transcript.md

neighbors (up to 12):
- [applique_à] Zone 201 (zone_201) [walkthrough-transcript.md]
- [autorise] Habitation multifamiliale (habitation_multifamiliale) [walkthrough-transcript.md]
- [est_un] Règlement de zonage (règlement_zonage) [walkthrough-transcript.md]

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

/home/antoinefa/src/radar-immobilier/docs/spec/input/walkthrough/.graphify/.graphify/wiki/descriptions/r-glement_3835.json
