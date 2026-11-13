/* global require, process */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { setTimeout } = require('node:timers/promises');
const { S3Client, CreateBucketCommand, HeadBucketCommand, PutBucketCorsCommand, PutObjectCommand } = require('/workspace/node_modules/@aws-sdk/client-s3');
async function main() {
  const client = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: 'us-east-1', forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
    maxAttempts: 1, requestHandler: { requestTimeout: 2000, connectionTimeout: 1000 } });
  try {
    for (const Bucket of ['radar-immobilier-raw', 'radar-immobilier-docs', 'radar-immobilier-artifacts']) {
      let ready = false;
      for (let attempt = 0; attempt < 15; attempt++) {
        try {
          await client.send(new CreateBucketCommand({ Bucket })); ready = true; break;
        } catch (error) {
          if (error.name === 'BucketAlreadyOwnedByYou' || error.name === 'BucketAlreadyExists') {
            await client.send(new HeadBucketCommand({ Bucket })); ready = true; break;
          }
          await setTimeout(1000);
        }
      }
      if (!ready) throw Error();
      await client.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: [{
        AllowedOrigins: ['https://recette.localhost:15321'], AllowedMethods: ['GET', 'HEAD', 'PUT'],
        AllowedHeaders: ['*'], ExposeHeaders: ['ETag'],
      }] } }));
    }
    // Optional private fixtures. No fetch to production or municipal services.
    const manifest = '/private-input/documents.json';
    let imported = 0;
    if (fs.existsSync(manifest)) {
      for (const item of JSON.parse(fs.readFileSync(manifest, 'utf8'))) {
        if (!['radar-immobilier-docs', 'radar-immobilier-raw'].includes(item.bucket)
          || !/^(raw|graph)\/[a-zA-Z0-9_./-]+$/.test(item.key) || item.key.includes('..')
          || !/^[a-f0-9]{64}$/.test(item.sha256) || !/^[a-zA-Z0-9_.-]+$/.test(item.file)
          || item.file.startsWith('.env')) throw Error();
        const file = path.join('/private-input/documents', item.file);
        if (fs.lstatSync(file).isSymbolicLink()) throw Error();
        const Body = fs.readFileSync(file);
        if (createHash('sha256').update(Body).digest('hex') !== item.sha256) throw Error();
        await client.send(new PutObjectCommand({ Bucket: item.bucket, Key: item.key, Body })); imported++;
      }
    }
    process.stdout.write(JSON.stringify({ buckets: 3, imported, remoteFetch: false }) + '\n');
  } finally { client.destroy(); }
}
main().catch(() => { process.stderr.write('local_storage_setup_failed\n'); process.exitCode = 1; });
