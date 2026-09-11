# Production refresh CronJobs
PR: https://github.com/rhanka/radar-immobilier/pull/675
- Adds the `refresh-cronjobs-prod` overlay with the promoted image pin and both CronJobs active.
- Adds the gated `promote-prod` CD step after production image promotion.
- Adds the additive production CronJob RBAC grant and the five-line operations runbook.
- Keeps the proven production SCW environment, 03:17/04:30 UTC schedules, and graphify boundary unchanged.
- Merge alone changes nothing on the cluster.
Owner remaining:
1. Arm `REFRESH_CRONJOB_PROD_ENABLED` with value `true`.
2. Publish the next `v*` tag to apply the production CronJobs through CD.
