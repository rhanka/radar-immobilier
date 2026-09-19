import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSeatComparisons, buildReport, parseArgs, validateSeatObservations} from './cost-calculator.mjs';
const obs = [{arm:'sol-medium',provider:'chatgpt',status:'measured',method:'passive-window-delta',sourceStatus:'observed',basePlan:'pro-20x',windowMinutes:10080,quotaDeltaPercent:12,documents:207,tokens:6348891,apiEquivalentUsd:125.205332}];
const arm=(name,api)=>({arm:name,documents:100,attemptedDocuments:100,acceptedDocuments:100,totalTokens:100000,apiUsd:api*100});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
test('should allocate a heterogeneous seat by API price rather than equal document or token counts',()=>{
 const rows=buildSeatComparisons([arm('astra-low',.40724),arm('luna-high',.0199)],obs).rows.filter(r=>r.plan==='pro-20x');
 near(rows[0].discountFactor,200/(125.205332/.12*52/12));
 near(rows[0].discountFactor,rows[1].discountFactor);
 near(rows[0].seatUsdPerDocument/rows[1].seatUsdPerDocument,.40724/.0199);
 assert.ok(rows[1].seatUsdPerDocument<.001);
 near(rows[0].docsPerMonth*.40724,rows[1].docsPerMonth*.0199);
 assert.equal(rows[0].breakEvenDocuments,492);
 assert.equal(rows[1].breakEvenDocuments,10051);
 assert.ok(rows.every(r=>r.seatUsdPerDocument<r.apiUsdFor1000Documents/1000));
});
test('should recover the flat allocation for the exact single-arm measured population',()=>{
 const gemini={...obs[0],arm:'gemini-low',provider:'gemini',basePlan:'ai-pro',quotaDeltaPercent:7.58,documents:260,tokens:5635342,apiEquivalentUsd:9.2185845};
 const row=buildSeatComparisons([arm('gemini-low',9.2185845/260)],[gemini]).rows.find(r=>r.plan==='ai-pro');
 near(row.seatUsdPerDocument,19.99/(260/.0758*52/12));
 near(row.discountFactor,.03793111955194757);
});
test('should price more expensive Gemini efforts with the same provider calibration',()=>{
 const gemini={...obs[0],arm:'gemini-low',provider:'gemini',basePlan:'ai-pro',quotaDeltaPercent:7.58,apiEquivalentUsd:9.2185845};
 const rows=buildSeatComparisons([arm('gemini-low',.03764),arm('gemini-high',.1123)],[gemini]).rows.filter(r=>r.plan==='ai-pro');
 assert.equal(rows.length,2);near(rows[0].discountFactor,rows[1].discountFactor);
 assert.ok(rows[1].docsPerMonth<rows[0].docsPerMonth);
});
test('should leave an uncalibrated seat N-A and reject invalid API equivalents',()=>{
 const {apiEquivalentUsd,...missing}=obs[0];
 const row=buildSeatComparisons([arm('luna-high',.0199)],[missing]);
 assert.equal(row.arms[0].reason,'api-equivalent-source-gap');
 assert.ok(row.rows.every(r=>r.seatUsdPerDocument===null));
 for(const value of [-1,0,NaN,Infinity])assert.throws(()=>validateSeatObservations({schemaVersion:1,observations:[{...obs[0],apiEquivalentUsd:value}]}),/positive finite/);
});
test('should retain fixed charges at low utilization and flag unreachable break-even',()=>{
 const row=buildSeatComparisons([arm('astra-low',.4)],[{...obs[0],apiEquivalentUsd:.1}]).rows.find(r=>r.plan==='pro-20x');
 assert.equal(row.breakEvenReachable,false);
 assert.ok(row.discountFactor>1);
 assert.ok(row.seatUsdFor1000Documents>=row.monthlyUsd);
});
test('should use proportional calibration in the report subscription totals',()=>{
 const report=buildReport([{schemaVersion:2,arm:'luna-high',documentId:'d',requested:{modelId:'gpt-5.6-luna',transportProviderId:'codex'},actual:{usage:{inputTokens:10000,outputTokens:10000}},validation:{accepted:true}}],{seatObservations:obs,chatgptPlan:'pro-20x'});
 const a=report.arms[0];near(a.subscription.usd.min,a.apiUsd*report.seatComparison.rows.find(r=>r.plan==='pro-20x').discountFactor);
 near(a.per1000Documents.subscriptionUsd.min,1000*a.subscription.usd.min);
 assert.equal(parseArgs(['--campaign','v101b','--seat-mode','proportional']).seatMode,'proportional');
 assert.throws(()=>parseArgs(['--campaign','v101b','--seat-mode','flat']),/proportional/);
});
