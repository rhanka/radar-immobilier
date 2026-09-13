# Refresh benchmark preflight

Frozen before candidate calls on September 13, 2026. Requested `normal` is the
explicit `medium` effort for these transports; it is not a provider default.

| Case | Requested native model | Transport | Actual effort payload | State |
|---|---|---|---|---|
| Codex 5.3 normal | `gpt-5.3-codex` | Codex subscription | `medium` | Unsupported: absent from live enrolled catalog and officially deprecated |
| Codex 5.3 high | `gpt-5.3-codex` | Codex subscription | `high` | Unsupported for the same reason; Spark is not a substitute |
| Gemini 3.8 normal | `gemini-3.8-flash` | Cloud Code/AGY | `MEDIUM` | Blocked: no owner-scoped Cloud Code enrollment; native catalog unverified |
| Gemini 3.8 high | `gemini-3.8-flash` | Cloud Code/AGY | `HIGH` | Blocked: no owner-scoped Cloud Code enrollment; native catalog unverified |
| Codex Luna normal | `gpt-5.6-luna` | Codex subscription | `medium` | Qualified by live catalog and exact Codex request mapping |
| Codex Luna high | `gpt-5.6-luna` | Codex subscription | `high` | Qualified by live catalog and exact Codex request mapping |
| Sol normal | `gpt-5.6-sol` | Codex subscription | `medium` | Qualified by live catalog and exact Codex request mapping |
| Sol high | `gpt-5.6-sol` | Codex subscription | `high` | Qualified by live catalog and exact Codex request mapping |
| Judge Sol xhigh | `gpt-5.6-sol` | Codex subscription | `xhigh` | Qualified by exact Codex request mapping |
| Judge Fable 5 xhigh | `claude-fable-5` | faithful native route required | native `xhigh` required | Unsupported/blocked: no faithful enrollment; Cloud Code alias is Gemini and collapses xhigh to HIGH |

The only enrolled owner-scoped account is pseudonym `acct-c015cb459d`, owner
scope `cli:antoinefa-ROG-Flow-Z13-GZ302EA-GZ302EA`, transport `codex`. No
Cloud Code/AGY account was present. Runs must stop if more than one eligible
account appears because this pilot does not permit hidden pool rotation.

Static alias inspection is not native identity proof. In particular,
`claude-fable-5` may fall back to Astra or Gemini, which is forbidden here.
Historical grounding scripts name `claude-sonnet-4-6` without an effort flag;
the historical Sonnet effort is therefore `unknown`.

The live Codex catalog contains Luna and Sol but not `gpt-5.3-codex`. The
official Codex models page also marks 5.3 Codex deprecated. No model is silently
substituted. Quota receipt: `candidate-before-20260913T163147Z`.
