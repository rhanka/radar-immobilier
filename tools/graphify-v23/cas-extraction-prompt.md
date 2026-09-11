Extract residential densification and municipal land-use signals from the document below.

Return a finding only when the quoted document text explicitly supports a municipal decision,
regulatory step, or property-development signal involving zoning, a planning program, PPCMOI,
minor variance, conditional use, PIIA, demolition, subdivision, CPTAQ, housing, multi-unit
construction, land disposition, or another concrete residential-development opportunity.

For every finding:

- `label`: concise French label for the explicit event.
- `description`: one or two factual French sentences based only on the document.
- `kind` and `category`: concise snake_case classifications.
- `etape`: one allowed regulatory stage from the JSON schema; use `inconnu` when not stated.
- `date`: ISO `YYYY-MM-DD` only when explicit, otherwise an empty string.
- `citation`: an exact, self-contained excerpt from the document.
- `page`: source page when visible, otherwise 1.
- `zone_ref`, `no_lot`, `reglement_number`, `resolution`, `outcome`: omit unless explicit.

Do not infer a project, decision, date, address, lot, zone, regulation number, or outcome.
Do not emit routine contracts, payroll, invoices, road maintenance, recreation, or governance.
Do not include natural-person names. Return `{"findings":[]}` when no qualifying evidence exists.
Use the structured JSON output only and do not call tools.
