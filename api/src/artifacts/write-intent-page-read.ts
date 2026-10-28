/** Served read/write composition. Every new gesture reads BASE's current state;
 * successful receipts are kept before a consistent state/search refresh.
 */
export const PW_PAGE_READ_SCRIPT = `
(() => {
  "use strict";
  var boot;
  try { boot=JSON.parse(document.querySelector("#pw-page-bootstrap").textContent); } catch (err) { return; }
  var targets=Object.create(null);
  var generation=0;
  function show(id,value) { var node=document.querySelector(id); if(node) node.textContent=JSON.stringify(value); }
  async function read(operation,params) {
    if(!boot.readGrant) throw new Error("Read authority unavailable");
    var controller=typeof AbortController!=="undefined"?new AbortController():null, timer, active=true;
    try {
      return await Promise.race([(async function() {
        // Renew only on a demanded read. Background-tab expiry recovers through
        // the same pinned P, with current authority checked by the reader host.
        var renewal=await fetch("/__reader/renew",{method:"POST",credentials:"same-origin",
          headers:{"x-preview-grant":boot.readGrant},signal:controller?.signal});
        if(renewal.status===401) renewal=await fetch("/__reader/renew",{method:"POST",credentials:"same-origin",
          headers:{},signal:controller?.signal});
        var renewed=await renewal.json();
        if(!active || !renewal.ok || typeof renewed.grant!=="string" || !renewed.grant || renewed.grant.length>4096) {
          throw new Error("Read authority unavailable");
        }
        boot.readGrant=renewed.grant;
        var response=await fetch("/__reader/api/baskets."+operation+".v1?"+new URLSearchParams(params),
          {credentials:"same-origin",headers:{"x-preview-grant":boot.readGrant},signal:controller?.signal});
        var data=await response.json();
        if(!response.ok || data.ok!==true || data.workspaceId!==boot.workspaceId ||
          !data.snapshot || !/^[a-f0-9]{64}$/.test(data.snapshot.baseToken)) throw new Error("Read unavailable");
        return data;
      })(),new Promise(function(resolve,reject) {
        timer=setTimeout(function(){active=false;reject(new Error("Read timed out"));if(controller) controller.abort();},15000);
      })]);
    } finally { active=false;clearTimeout(timer); }
  }
  function params(g) { return {workspaceId:boot.workspaceId,citySlug:g.target.citySlug,type:g.target.type,id:g.target.id,
    reveal:g.operation && (g.operation.indexOf(".restore.")!==-1 || g.operation.indexOf(".discard.")!==-1)?"true":"false"}; }
  async function state(g) {
    if(g.workspaceId!==boot.workspaceId) throw new Error("Workspace mismatch");
    var result=await read("state",params(g)), item=result.item;
    if(!item || !item.target || item.target.citySlug!==g.target.citySlug || item.target.type!==g.target.type ||
      item.target.id!==g.target.id || !/^[a-f0-9]{64}$/.test(item.displayedFingerprint) || !item.facets ||
      !item.facets.selection || !item.facets.archive) throw new Error("Target unavailable");
    return result;
  }
  window.__pwReadGesture=async function(g) {
    var owner=++generation;
    var result=await state(g), item=result.item, next=Object.assign({},g);
    if(owner!==generation) throw new Error("Target changed");
    next.displayedFingerprint=item.displayedFingerprint; next.expectedProjectionToken=result.snapshot.baseToken;
    var head=g.operation.indexOf(".workspace.")!==-1 ? item.facets.archive.workspace :
      (g.operation.indexOf(".select.")!==-1 || g.operation.indexOf(".deselect.")!==-1)
        ? item.facets.selection[g.basket] : item.facets.archive.personal;
    next.expectedHeadId=head?head.id:null;
    if(g.deselect!==undefined) {
      next.expectedSelectionHeads={};
      g.deselect.forEach(function(basket){next.expectedSelectionHeads[basket]=item.facets.selection[basket]?.id??null;});
    }
    show("#pw-live-state",item);
    return next;
  };
  window.__pwWritePrepared=function(id,g) { targets[id]={gesture:g,generation:generation}; };
  window.__pwWriteOnCommitted=async function(data,isCurrent) {
    var owner=targets[data.intentId];
    function current() { return (!isCurrent || isCurrent()) && (!owner || owner.generation===generation); }
    if(!current()) return;
    window.__pwWriteReceipt=data;
    show("#pw-page-receipt",data);
    if(!owner) throw new Error("Reopen the target to refresh");
    try {
      var target=owner.gesture, fresh=await state(target);
      if(!current()) return;
      var search=await read("search",{workspaceId:boot.workspaceId,citySlug:target.target.citySlug,limit:"20"});
      if(!current()) return;
      if(search.snapshot.baseToken!==fresh.snapshot.baseToken || !Array.isArray(search.items) || !search.counts) {
        throw new Error("Projection moved during refresh");
      }
      // Publish both views only for the current gesture and one authorized snapshot.
      show("#pw-live-state",fresh.item); show("#pw-live-cards",search.items); show("#pw-live-counts",search.counts);
    } catch(err) { if(current()) throw err; }
  };
})();
`;
