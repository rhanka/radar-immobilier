select(.metadata.name == "radar-s3-credentials")
| select(all(.data.S3_ACCESS_KEY, .data.S3_SECRET_KEY;
    type == "string" and length > 0))
| {apiVersion:"v1",kind:"Secret",
   metadata:{name:"radar-docs-prod-source-credentials",namespace:"radar-immobilier-preprod"},
   type:"Opaque",data:{
     PROD_S3_ACCESS_KEY:.data.S3_ACCESS_KEY,
     PROD_S3_SECRET_KEY:.data.S3_SECRET_KEY}}
