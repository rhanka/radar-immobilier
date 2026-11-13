## Output

Read the ENTIRE municipal document supplied below in one call. No tools or external sources.
Extract ALL supported urban-planning acts, including distinct stages of the same bylaw.
Detection is independent of class: retain excluded acts too. Do not suppress individual permissions,
non-residential, restrictive, uncertain acts or acts only listed on an agenda.
Classify each detected act in the SAME response using the rules above.
Use this flat detection format instead of graph nodes and annotations.
Return ONLY JSON: {"acts":[{"id":"local unique id","target_number":null,"object":"specific act object",
"stage":"explicit stage, e.g. avis de motion, premier projet, second projet, adoption, consultation",
"page":1,"quote":"exact contiguous source passage, at most 300 characters",
"classe":"pertinent|a_surveiller|ecarte|non_classe","code":"registry code or UNCLASSIFIED",
"reason":"Step N: explanation in at most 40 words","ambiguous":false}]}.
Page numbers start at 1; form feed characters separate pages. Preserve ALL whitespace in quotes.
target_number is the target BYLAW number, never a parent bylaw, resolution or agenda-point number.
P codes map to pertinent, S codes to a_surveiller, N codes and V2-PRECEDENT to ecarte.
Use non_classe with UNCLASSIFIED only when classification is impossible. It remains visible.
Return an empty acts array when the document contains no supported urban-planning act.
Input contains no oracle acts, reference votes or reference classes.
