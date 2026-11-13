export const classes=['pertinent','a_surveiller','ecarte','non_classe'];
export const shown=x=>x==='pertinent'||x==='a_surveiller';
export function wilson(k,n){
 if(!n) return {low:null,high:null};
 const z=1.959963984540054,p=k/n,d=1+z*z/n;
 const centre=(p+z*z/(2*n))/d,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
 return {low:Math.max(0,centre-half),high:Math.min(1,centre+half)};
}
export function metrics(rows){
 const matrix=classes.map(()=>classes.map(()=>0));
 let positives=0,predicted=0,tp=0,detected=0,absent=0,invalid=0;
 for(const r of rows){
  const ref=r.ref==='non_pertinent'?'ecarte':r.ref;
  const pred=classes.includes(r.pred)?r.pred:'non_classe';
  matrix[classes.indexOf(ref)][classes.indexOf(pred)]++;
  if(shown(ref)) positives++;
  if(shown(pred)) predicted++;
  if(shown(ref)&&shown(pred)) tp++;
  if(r.detected) detected++;
  if(r.absent) absent++;
  if(r.invalid) invalid++;
 }
 const acts=rows.filter(r=>r.kind!=='pv');
 return {units:rows.length,refShown:positives,predShown:predicted,trueShown:tp,misses:positives-tp,
 recall:positives?tp/positives:null,recallWilson95:wilson(tp,positives),
 precision:predicted?tp/predicted:null,precisionWilson95:wilson(tp,predicted),
 detectionRecall:acts.length?acts.filter(r=>r.detected).length/acts.length:null,
 referenceActs:acts.length,detectedActs:acts.filter(r=>r.detected).length,detectedUnits:detected,absent,invalid,
 matrix:{order:classes,rows:matrix},D4:positives===tp?'pass':'fail'};
}
export function annotation(a){
 if(!a||!classes.includes(a.classe)||typeof a.reason!=='string'||!a.reason.trim()) return null;
 const mapped=a.reasonCode?.startsWith('P-')?'pertinent':a.reasonCode?.startsWith('S-')?'a_surveiller'
  :a.reasonCode==='UNCLASSIFIED'?'non_classe':/^(N-|V2-PRECEDENT$)/.test(a.reasonCode??'')?'ecarte':null;
 return mapped===a.classe?a:null;
}
