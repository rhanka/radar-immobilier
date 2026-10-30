# Rehearsal criterion: PostgreSQL sessions <= 80 % of max_connections, from the receipt's
# `database` Job verdict. A missing or zero max_connections fails (never `0 <= 0`).
.jobs.database.verdict as $v
| ($v.maxConnections|type) == "number" and $v.maxConnections > 0
  and (($v.sessionsByDb // {} | [.[]] | add) // 0) <= 0.8 * $v.maxConnections
