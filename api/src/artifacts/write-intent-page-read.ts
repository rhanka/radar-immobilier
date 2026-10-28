/** Served read/write composition. Every new gesture reads BASE's current state;
 * successful receipts are kept before a consistent state/search refresh.
 */
export const PW_PAGE_READ_SCRIPT = `
(() => {
  "use strict";
  var boot;
  try { boot=JSON.parse(document.querySelector("#pw-page-bootstrap").textContent); } catch (err) { return; }
  var targets=Object.create(null);
  function show(id,value) { var node=document.querySelector(id); if(node) node.textContent=JSON.stringify(value); }
  async function read(operation,params) {
    if(!boot.readGrant) throw new Error("Read authority unavailable");
    var response=await fetch("/__reader/api/baskets."+operation+".v1?"+new URLSearchParams(params),
      {credentials:"same-origin",headers:{"x-preview-grant":boot.readGrant}});
    var data=await response.json();
    if(!response.ok || data.ok!==true || data.workspaceId!==boot.workspaceId ||
      !data.snapshot || !/^[a-f0-9]{64}$/.test(data.snapshot.baseToken)) throw new Error("Read unavailable");
    return data;
  }
  function params(g) { return {workspaceId:boot.workspaceId,citySlug:g.target.citySlug,type:g.target.type,id:g.target.id}; }
  async function state(g) {
    if(g.workspaceId!==boot.workspaceId) throw new Error("Workspace mismatch");
    var result=await read("state",params(g)), item=result.item;
    if(!item || !item.target || item.target.citySlug!==g.target.citySlug || item.target.type!==g.target.type ||
      item.target.id!==g.target.id || !/^[a-f0-9]{64}$/.test(item.displayedFingerprint) || !item.facets ||
      !item.facets.selection || !item.facets.archive) throw new Error("Target unavailable");
    return result;
  }
  window.__pwReadGesture=async function(g) {
    var result=await state(g), item=result.item, next=Object.assign({},g);
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
  window.__pwWritePrepared=function(id,g) { targets[id]=g; };
  window.__pwWriteOnCommitted=async function(data) {
    window.__pwWriteReceipt=data;
    show("#pw-page-receipt",data);
    var target=targets[data.intentId];
    if(!target) throw new Error("Reopen the target to refresh");
    var current=await state(target);
    var search=await read("search",{workspaceId:boot.workspaceId,citySlug:target.target.citySlug,limit:"20"});
    if(search.snapshot.baseToken!==current.snapshot.baseToken || !Array.isArray(search.items) || !search.counts) {
      throw new Error("Projection moved during refresh");
    }
    // Publish both views only when they describe the same authorized snapshot.
    show("#pw-live-state",current.item); show("#pw-live-cards",search.items); show("#pw-live-counts",search.counts);
  };
})();
`;
