# Sales Opportunity Smart Entry Rules

Use these rules to turn the current opportunity facts plus `rawText` into a structured field update result.

## Global rules

- Treat query results as the current opportunity baseline.
- Treat `rawText` as the incremental change instruction for the current opportunity.
- Do not generate `summary`, `adviceText`, or `nextActions`.
- Final output must contain only:
  - `opportunityId`
  - `salesScene`
  - `data`
- `data` must contain only base fields plus the current `salesScene` fields defined by the prompt and schema.
- Never invent customers, contacts, dates, budget details, bid details, competitors, or integrator information.

## Field update rules

- If `rawText` clearly modifies a field, output the updated value.
- If `rawText` does not mention a field, keep the current value from the query result.
- If the current value is empty and `rawText` does not provide a stable value, leave the field empty.
- If `rawText` conflicts with the current value, prefer the value explicitly updated in `rawText`.
- If `rawText` is ambiguous, keep the current value instead of guessing.

## Scene rules

- Determine `salesScene` from the current opportunity facts first.
- Do not rely on the user to manually provide the scene.
- After `salesScene` is identified, only output the fields allowed for that scene.
- If the current scene has no configured exclusive fields, output only the base fields.

## Type and format rules

- JSON keys must use table field names, not Chinese labels.
- Keep date fields in explicit date form such as `YYYY-MM-DD` when the value can be determined.
- Keep `smartContacts` as a JSON array string if a contact result is produced.
- Preserve `opportunityId` exactly as received.
- Preserve field shape as much as possible according to the current field value and dictionary description.

## Safety rules

- Do not output fields outside the schema.
- Do not mix fields from other scenes.
- Do not output explanatory prose, markdown, or reasoning.
- Return only the structured payload content.
