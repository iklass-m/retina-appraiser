"use strict";
/* Retina Appraiser — standalone. PubMed (NCBI E-utilities) + Europe PMC full text + optional Gemini.
   No server: everything runs in the browser; the library lives in IndexedDB on this device. */

const TOPICS=["nAMD","GA / dry AMD","DMO","Diabetic retinopathy","RVO","Inherited retinal disease","Uveitis","Imaging & AI","Systemic drugs & the eye","Other retina"];
const VERDICTS={change:"Changes practice",support:"Supports current practice",know:"Worth knowing",notready:"Not ready yet",low:"Low value"};
const VERDICT_HELP={change:"Valid, important and applicable — I will do something differently.",support:"Confirms what we already do; no change needed.",know:"Interesting or useful background, but not enough to act on.",notready:"Promising, but needs better, larger or longer evidence first.",low:"Too biased, too small or not relevant to act on."};
const LEVELS={"1":"Systematic review of the best studies","2":"Randomised trial or equivalent","3":"Non-randomised cohort / follow-up","4":"Case series / case-control / historical controls","5":"Mechanism, lab, modelling or expert opinion"};
const $=s=>document.querySelector(s);
const el=(tag,attrs={},...kids)=>{const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==="class")n.className=v;else if(k==="text")n.textContent=v;else if(k.startsWith("on"))n.addEventListener(k.slice(2),v);else if(v!=null&&v!==false)n.setAttribute(k,v===true?"":v)}for(const c of kids.flat())if(c!=null&&c!==false)n.append(c.nodeType?c:String(c));return n};
const arr=x=>Array.isArray(x)?x.filter(Boolean):(x?[x]:[]);
const lines=s=>String(s||"").split(/\n+/).map(x=>x.replace(/^[-•*+]\s*/,"").trim()).filter(Boolean);
function toast(msg){const t=el("div",{class:"toast",role:"status",text:msg});document.body.append(t);setTimeout(()=>t.remove(),3200)}
const store={get(k,d){try{const v=localStorage.getItem("ra:"+k);return v==null?d:JSON.parse(v)}catch{return d}},set(k,v){try{localStorage.setItem("ra:"+k,JSON.stringify(v))}catch{}}};

/* ---------- library storage (IndexedDB) ---------- */
let idb=null;
function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open("retina-appraiser",1);r.onupgradeneeded=()=>r.result.createObjectStore("papers",{keyPath:"id"});r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function tx(mode,fn){return new Promise((res,rej)=>{const t=idb.transaction("papers",mode);const s=t.objectStore("papers");const out=fn(s);t.oncomplete=()=>res(out&&out.result!==undefined?out.result:out);t.onerror=()=>rej(t.error)})}
const dbAll=()=>tx("readonly",s=>s.getAll());
const dbPut=doc=>tx("readwrite",s=>{s.put(doc)});
const dbDel=id=>tx("readwrite",s=>{s.delete(id)});

let papers=[],view="find",lastList="find",openId=null,vfilter="";
async function reload(){papers=(await dbAll()).sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));$("#stamp").textContent=papers.length+" papers appraised";$("#libcount").textContent=papers.length+" papers on this device."}
async function savePaper(doc){doc.id=doc.id||(doc.pmid?"pm"+doc.pmid:"u"+Date.now().toString(36));await dbPut(doc);await reload();return doc.id}
async function patch(id,data){const p=papers.find(x=>x.id===id);if(!p)return;Object.assign(p,data);await dbPut(p)}

/* ---------- tabs ---------- */
const isList=v=>v==="library"||v==="uveitis"||v==="starred";
function show(v){
  view=v;
  for(const t of ["find","library","uveitis","starred"])$("#t-"+t).setAttribute("aria-selected",String(t===v||((v==="detail"||v==="manual")&&t===lastList)));
  $("#t-settings").setAttribute("aria-pressed",String(v==="settings"));
  $("#v-find").hidden=v!=="find";$("#v-library").hidden=!isList(v);$("#v-detail").hidden=v!=="detail";$("#v-manual").hidden=v!=="manual";$("#v-settings").hidden=v!=="settings";
  $("#topic").hidden=v==="uveitis";
  if(isList(v)){lastList=v;renderList()}
  if(v==="find"){lastList="find";renderResults()}
  window.scrollTo(0,0);
  saveState();
}
/* Phones reload the page after the screen goes off: remember where she was so it comes back. */
let manualArticle=null,restoring=false;
function saveState(){if(restoring)return;store.set("state",{view,lastList,openId,manual:view==="manual"&&manualArticle?{...manualArticle,fullText:""}:null,
  fq:$("#fq").value,preset,ftype:$("#ftype").value,fdate:$("#fdate").value,fsort:$("#fsort").value,fjournals:$("#fjournals").checked,q:$("#q").value,topic:$("#topic").value,vfilter,at:Date.now()})}
$("#t-find").onclick=()=>{show("find");if(!searched)runSearch()};
$("#t-library").onclick=()=>show("library");
$("#t-uveitis").onclick=()=>show("uveitis");
$("#t-starred").onclick=()=>show("starred");
$("#t-settings").onclick=()=>show(view==="settings"?lastList:"settings");

/* ---------- library list ---------- */
for(const t of TOPICS)$("#topic").append(el("option",{value:t,text:t}));
$("#topic").onchange=renderList;$("#q").oninput=renderList;
function renderChips(){const c=$("#vchips");c.replaceChildren();const add=(k,l)=>c.append(el("button",{class:"chip","aria-pressed":String(vfilter===k),onclick:()=>{vfilter=vfilter===k?"":k;renderChips();renderList()}},l));add("","All");add("unread","Unread");for(const[k,v]of Object.entries(VERDICTS))add(k,v)}
renderChips();
function levelSeal(p){const l=String(p.level||"?");return el("div",{class:"lvl l"+l,title:LEVELS[l]||"Evidence level"},el("b",{text:l}),el("i",{text:"level"}))}
function verdictPill(p){return p.verdict?el("span",{class:"pill v-"+p.verdict,text:VERDICTS[p.verdict]||p.verdict}):null}
function renderList(){
  const list=$("#list");list.replaceChildren();
  const q=$("#q").value.trim().toLowerCase(),tp=$("#topic").value;
  let rows=papers.filter(p=>view==="starred"?p.starred:view==="uveitis"?p.topic==="Uveitis":p.topic!=="Uveitis");
  if(tp&&view!=="uveitis")rows=rows.filter(p=>p.topic===tp);
  if(vfilter==="unread")rows=rows.filter(p=>!p.read);else if(vfilter)rows=rows.filter(p=>p.verdict===vfilter);
  if(q)rows=rows.filter(p=>JSON.stringify([p.title,p.journal,p.bottomLine,p.summary,p.intervention,p.topic,p.authors]).toLowerCase().includes(q));
  $("#count").textContent=`${rows.length} paper${rows.length===1?"":"s"}`;
  if(!rows.length){list.append(el("div",{class:"empty"},el("h3",{text:view==="uveitis"?"No uveitis papers yet":view==="starred"?"No starred papers yet":papers.length?"Nothing matches":"Your library is empty"}),el("p",{text:view==="starred"?"Tap ☆ Star on any appraisal to keep it here.":papers.length&&(q||vfilter||tp)?"Clear the search or filters.":"Find a paper and tap AI appraise or Appraise myself."})));return}
  for(const p of rows)list.append(el("div",{class:"card"+(p.read?"":" unread"),role:"button",tabindex:"0",onclick:()=>openPaper(p.id),onkeydown:e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openPaper(p.id)}}},levelSeal(p),el("div",{class:"body"},
    el("div",{class:"row"},p.topic?el("span",{class:"pill topic",text:p.topic}):null,verdictPill(p)),
    el("h3",{text:p.title||"Untitled"}),el("div",{class:"meta",text:[p.authors,p.journal,p.year].filter(Boolean).join(" · ")}),
    p.bottomLine?el("p",{class:"bl",text:p.bottomLine}):null),starButton(p,renderList)));
}
/* one star control used on cards, results and the appraisal sheet */
function starButton(p,after){
  const b=el("button",{class:"starbtn",type:"button","aria-pressed":String(!!p.starred),"aria-label":p.starred?"Remove star":"Star this paper",title:p.starred?"Starred — tap to remove":"Star this paper"},p.starred?"★":"☆");
  b.onclick=async e=>{e.stopPropagation();await patch(p.id,{starred:!p.starred});toast(p.starred?"Starred — find it in the Starred tab":"Star removed");if(after)after();else{b.textContent=p.starred?"★":"☆";b.setAttribute("aria-pressed",String(!!p.starred))}};
  return b;
}

/* ---------- appraisal sheet ---------- */
function sec(title,...kids){return el("div",{class:"sec"},el("h4",{text:title}),...kids)}
function ul(items,cls){const a=arr(items);return a.length?el("ul",{class:cls||""},a.map(x=>el("li",{text:x}))):el("p",{class:"note",text:"Not recorded."})}
const pubmedURL=pmid=>"https://pubmed.ncbi.nlm.nih.gov/"+encodeURIComponent(pmid)+"/",pmcURL=pmc=>"https://pmc.ncbi.nlm.nih.gov/articles/"+encodeURIComponent(pmc)+"/";
/* the papers behind each checklist tool, as a row of PubMed (and free PMC) links */
function refLinks(refs){return refs.length?el("div",{class:"links"},refs.flatMap(r=>[el("a",{href:pubmedURL(r.pmid),target:"_blank",rel:"noopener",text:r.label}),r.pmc?el("a",{href:pmcURL(r.pmc),target:"_blank",rel:"noopener",text:"free full text"}):null])):null}
function links(p){const out=[];
  if(p.pmid)out.push(el("a",{href:pubmedURL(p.pmid),target:"_blank",rel:"noopener",text:"PubMed"}));
  if(p.pmc)out.push(el("a",{href:pmcURL(p.pmc),target:"_blank",rel:"noopener",text:"Free full text"}));
  if(p.doi)out.push(el("a",{href:"https://doi.org/"+p.doi,target:"_blank",rel:"noopener",text:"Journal"}));
  return el("div",{class:"links"},out)}
const ENGINE={gemini:"Gemini",claude:"Claude",manual:"you (no AI)"};
function openPaper(id){
  const p=papers.find(x=>x.id===id);if(!p)return;openId=id;manualArticle=null;
  if(!p.read)patch(id,{read:true});
  const v=$("#v-detail");v.replaceChildren();
  const l=String(p.level||"?"),c=p.counselling||{},script=c.script||"";
  const bq=el("blockquote",{text:script||"No counselling script."});
  const copyBtn=el("button",{class:"btn ghost",type:"button",onclick:async()=>{try{await navigator.clipboard.writeText(script);toast("Copied")}catch{const r=document.createRange();r.selectNodeContents(bq);const s=getSelection();s.removeAllRanges();s.addRange(r);toast("Selected — copy it from the menu")}}},"Copy what to say");
  const delBtn=el("button",{class:"btn ghost",type:"button",onclick:async()=>{if(delBtn.dataset.sure){await dbDel(id);await reload();toast("Removed from library");show(lastList==="find"?"library":lastList)}else{delBtn.dataset.sure="1";delBtn.textContent="Tap again to remove"}}},"Remove");
  v.append(el("div",{class:"topbar"},el("button",{class:"back",onclick:()=>show(lastList)},lastList==="find"?"← Back to search":"← Back to library"),starButton(p)),
    el("article",{class:"sheet"},
      el("div",{class:"row"},p.topic?el("span",{class:"pill topic",text:p.topic}):null,verdictPill(p),p.source?el("span",{class:"pill type",text:"from "+p.source}):null),
      el("h2",{text:p.title}),
      el("div",{class:"cite"},[p.authors,p.journal,p.year].filter(Boolean).join(" · ")," ",links(p)),
      p.bottomLine?el("div",{class:"bottomline",text:p.bottomLine}):null,
      sec("Evidence level",el("div",{class:"evid"},levelSeal(p),el("div",{},
        el("div",{style:"font-weight:600",text:(LEVELS[l]||"Unclassified")+" — Oxford CEBM level "+l}),
        el("div",{class:"ladder"},[1,2,3,4,5].map(n=>el("span",{class:n>=Number(l)?"on":""}))),
        p.levelWhy?el("div",{class:"note",style:"margin-top:6px",text:p.levelWhy}):null,
        p.grade?el("div",{class:"note",style:"margin-top:6px",text:"GRADE certainty: "+p.grade+(p.gradeWhy?" — "+p.gradeWhy:"")}):null))),
      sec("Summary",el("dl",{class:"facts"},[["Design",p.design],["Population",p.population],["Patients / eyes",p.n],["Follow-up",p.followUp],["Intervention",p.intervention],["Comparator",p.comparator],["Primary outcome",p.primaryOutcome],["Funding",p.funding]].filter(x=>x[1]).map(([k,val])=>el("div",{},el("dt",{text:k}),el("dd",{text:val})))),p.summary?el("p",{text:p.summary}):null),
      arr(p.keyResults).length?sec("Key numbers",el("div",{class:"nums"},arr(p.keyResults).map(r=>el("div",{},el("span",{text:r.label}),el("b",{text:r.value}))))):null,
      el("div",{class:"twocol"},sec("What it adds",ul(p.adds,"adds")),sec("What it lacks",ul(p.lacks,"lacks"))),
      arr(p.bias).length&&!checklistRows(p)?sec("Risk of bias",el("div",{class:"bias"},arr(p.bias).map(b=>el("div",{},el("span",{class:"dot "+(b.risk||"some"),title:b.risk}),el("span",{},el("b",{text:b.domain+": "}),b.note||""))))):null,
      sec("Using it in my practice",ul(p.practice)),
      sec("Counselling patients",el("div",{class:"say"},el("div",{class:"note",text:"In plain words you could say:"}),bq,el("div",{class:"actions"},copyBtn)),
        arr(c.points).length?ul(c.points):null,
        arr(c.ifTheyAsk).length?el("div",{class:"qa"},el("div",{class:"note",text:"If they ask…"}),arr(c.ifTheyAsk).map(x=>el("details",{},el("summary",{text:x.q}),el("p",{text:x.a})))):null),
      checklistSec(p),
      p.verdictWhy||p.verdict?sec("Does this change my practice?",el("div",{class:"vfinal v-"+(p.verdict||"know")},el("b",{text:VERDICTS[p.verdict]||"No verdict"}),p.verdict?el("small",{text:VERDICT_HELP[p.verdict]||""}):null),p.verdictWhy?el("p",{text:p.verdictWhy}):null):null,
      exportBox(p),
      askBox(p),
      el("div",{class:"actions"},
        el("button",{class:"btn ghost",type:"button",onclick:()=>{patch(id,{read:false});toast("Marked unread")}},"Mark unread"),
        p.pmid?el("a",{class:"btn ghost",href:CLAUDE_APP+"#pm"+p.pmid,target:"_blank",rel:"noopener"},"Appraise with Claude ↗"):null,
        el("button",{class:"btn ghost",type:"button",onclick:()=>openManual(paperAsArticle(p),p)},p.engine==="manual"?"Edit my appraisal":"Appraise it myself"),
        delBtn),
      el("p",{class:"note",text:"Appraised by "+(ENGINE[p.engine]||"Claude")+" from the "+(p.source||"text")+" on "+(p.addedAt?new Date(p.addedAt).toLocaleDateString("en-GB"):"—")+(p.engine==="manual"?".":". Check key numbers against the paper before quoting.")})));
  show("detail");
}
/* the no-AI checklist as answered, so the appraisal shows (and exports) how the judgement was reached */
const ANS={y:"Yes",u:"Can't tell",n:"No"};
function checklistRows(p){const d=DESIGNS[p.designKey];if(!d||!p.answers)return null;const ans=migrateAnswers(p.designKey,p.answers),notes=migrateAnswers(p.designKey,p.notes);
  return{d,ov:overallJudgement(p.designKey,ans),rows:d.qs.map(([id,domain,q,,,crit])=>({domain,q,crit,a:ans[p.designKey+":"+id]||"",note:notes[p.designKey+":"+id]||""}))}}
function checklistSec(p){const c=checklistRows(p);if(!c)return null;
  return sec("Checklist",el("p",{class:"note",text:"Based on "+c.d.tool+"."}),refLinks(c.d.refs),
    el("div",{class:"overall"},el("span",{class:"dot "+c.ov.cls}),el("b",{text:c.ov.label+": "+c.ov.value})),
    el("details",{class:"why"},el("summary",{text:"Show all "+c.rows.length+" answers"}),el("div",{class:"bias"},c.rows.map(r=>el("div",{},el("span",{class:"dot "+(r.a==="y"?"low":r.a==="n"?"high":r.a==="u"?"some":"none")}),
      el("span",{},el("b",{text:r.domain+": "}),ANS[r.a]||"Not answered",r.note?" — "+r.note:""))))))}

/* ---------- export one appraisal as plain text or Markdown (for Notion, handouts) ---------- */
/* A self-contained journal-club handout: everything on the appraisal page plus the abstract and the full checklist
   (questions, answers, notes), so even a quick "Appraise myself" appraisal exports as a useful document. */
function appraisalText(p,md){
  const out=[],h=t=>out.push("",md?"## "+t:t.toUpperCase(),md?"":"=".repeat(t.length)),li=x=>out.push((md?"- ":"• ")+x),para=x=>{if(x)out.push("",x)},
    bold=x=>md?"**"+x+"**":x,link=(label,url)=>md?`[${label}](${url})`:`${label}: ${url}`,c=p.counselling||{},l=String(p.level||"?"),c2=checklistRows(p);
  out.push(md?"# "+(p.title||"Untitled"):(p.title||"Untitled").toUpperCase());
  para([p.authors,p.journal,p.year].filter(Boolean).join(" · ")+(p.pmid?" · PMID "+p.pmid:"")+(p.doi?" · doi:"+p.doi:""));
  const ls=[p.pmid&&link("PubMed",pubmedURL(p.pmid)),p.pmc&&link("Free full text (PMC)",pmcURL(p.pmc)),p.doi&&link("Journal",`https://doi.org/${p.doi}`)].filter(Boolean);
  if(ls.length)out.push(...(md?[ls.join(" · ")]:ls));
  h("At a glance");
  li(bold("Does this change my practice?")+" "+(VERDICTS[p.verdict]||"No verdict yet"));
  li(bold("Evidence level:")+" "+`Oxford CEBM ${l} — ${LEVELS[l]||"unclassified"}`);
  if(p.grade)li(bold("GRADE certainty:")+" "+p.grade);
  if(c2)li(bold(c2.ov.label+":")+" "+c2.ov.value);
  if(p.design)li(bold("Design:")+" "+p.design);
  if(p.bottomLine){h("Bottom line");out.push("",md?"> "+p.bottomLine:p.bottomLine)}
  const facts=[["Population",p.population],["Patients / eyes",p.n],["Follow-up",p.followUp],["Intervention",p.intervention],["Comparator",p.comparator],["Primary outcome",p.primaryOutcome],["Funding",p.funding],["Publication type",arr(p.pubTypes).filter(t=>!/^Journal Article$/.test(t)).join(", ")]].filter(x=>x[1]);
  if(facts.length||p.summary){h("The study");for(const[k,v]of facts)li(bold(k+":")+" "+v);para(p.summary)}
  if(arr(p.spotted).length){h("Spotted in the text");arr(p.spotted).forEach(li)}
  if(arr(p.keyResults).length){h("Key numbers");for(const r of arr(p.keyResults))li((r.label?r.label+": ":"")+(r.value||""))}
  h("Evidence level");para(`Oxford CEBM level ${l} — ${LEVELS[l]||"unclassified"}.`+(p.levelWhy?" "+p.levelWhy:""));if(p.grade)para("GRADE certainty: "+p.grade+(p.gradeWhy?" — "+p.gradeWhy:""));
  if(c2){h("Critical appraisal checklist");para("Based on "+c2.d.tool+".");para(bold(c2.ov.label+": "+c2.ov.value)+` (${c2.ov.answered}/${c2.ov.total} answered · ${c2.ov.yes} yes · ${c2.ov.unc} can't tell · ${c2.ov.no} no)`);out.push("");
    c2.rows.forEach((r,i)=>{out.push(`${i+1}. ${bold(r.domain)}${r.crit?" [KEY]":""} — ${r.q}`,`   Answer: ${ANS[r.a]||"Not answered"}${r.note?" — "+r.note:""}`)})}
  else if(arr(p.bias).length){h("Risk of bias");for(const b of arr(p.bias))li(`${bold(b.domain)} (${({low:"low",some:"some concerns",high:"high"})[b.risk]||b.risk||"unclear"}): ${b.note||""}`)}
  h("What it adds");arr(p.adds).forEach(li);if(!arr(p.adds).length)li("Not recorded");
  h("What it lacks");arr(p.lacks).forEach(li);if(!arr(p.lacks).length)li("Not recorded");
  if(arr(p.practice).length){h("Using it in my practice");arr(p.practice).forEach(li)}
  if(c.script||arr(c.points).length||arr(c.ifTheyAsk).length){h("Counselling patients");if(c.script)out.push("",md?"> "+c.script:"\""+c.script+"\"");if(arr(c.points).length)out.push("");arr(c.points).forEach(li);
    for(const x of arr(c.ifTheyAsk))out.push("",bold("If they ask: "+x.q),x.a)}
  h("Does this change my practice?");para(bold(VERDICTS[p.verdict]||"No verdict yet")+(p.verdict&&VERDICT_HELP[p.verdict]?" — "+VERDICT_HELP[p.verdict]:""));para(p.verdictWhy);
  const open=c2?c2.rows.filter(r=>r.a==="u"):[];
  if(open.length){h("For discussion");para("Checklist items we couldn't answer from the paper:");open.forEach(r=>li(r.domain+": "+r.q))}
  const abs=arr(p.abstractParts).length?p.abstractParts.map(x=>(x.label?bold(x.label)+": ":"")+x.text).join("\n\n"):(p.abstractText||"");
  if(abs){h("Abstract (from PubMed)");para(abs)}
  if(c2&&c2.d.refs.length){h("Appraisal tools");for(const r of c2.d.refs)li(link(r.label,pubmedURL(r.pmid)))}
  out.push("","—","Appraised by "+(ENGINE[p.engine]||"Claude")+" from the "+(p.source||"text")+(p.addedAt?" on "+new Date(p.addedAt).toLocaleDateString("en-GB"):"")+". Exported from Retina Appraiser on "+new Date().toLocaleDateString("en-GB")+".");
  return out.join("\n").replace(/\n{3,}/g,"\n\n").trim()+"\n";
}
async function copyText(text){
  try{await navigator.clipboard.writeText(text);return true}
  catch{const t=el("textarea",{style:"position:fixed;opacity:0;top:0"},text);document.body.append(t);t.select();let ok=false;try{ok=document.execCommand("copy")}catch{}t.remove();return ok}
}
const kb=n=>(n/1024).toFixed(1)+" KB";
/* Android's download manager can read the file after the click returns, so the link is kept alive for a minute */
function download(name,text,type){const blob=new Blob([text],{type:type+";charset=utf-8"}),a=el("a",{href:URL.createObjectURL(blob),download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),60000);return blob.size}
function exportBox(p){
  const base=(p.authors||"").split(/[\s,]/)[0]+"-"+(p.year||"")+"-"+(p.title||"appraisal").split(/\s+/).slice(0,6).join("-");
  const slug=base.toLowerCase().normalize("NFKD").replace(/[^a-z0-9-]+/g,"").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,70)||"appraisal";
  const md=appraisalText(p,true),txt=appraisalText(p,false);
  const shareFile=new File([md],slug+".md",{type:"text/markdown"});
  const canShare=!!(navigator.canShare&&navigator.canShare({files:[shareFile]}));
  const preview=el("pre",{class:"exportpre",text:txt});
  return sec("Export appraisal",el("p",{class:"note",text:`A full journal-club handout (${kb(new Blob([md]).size)}): summary, key numbers, the whole checklist, verdict, counselling and the PubMed abstract. Copy it into Notion or an email, or save it as a file.`}),
    el("div",{class:"actions"},
      el("button",{class:"btn",type:"button",onclick:async()=>toast(await copyText(txt)?"Copied as plain text ("+kb(new Blob([txt]).size)+")":"Couldn't copy — use Download .txt instead")},"Copy as text"),
      el("button",{class:"btn ghost",type:"button",onclick:async()=>toast(await copyText(md)?"Copied as Markdown — paste into Notion":"Couldn't copy — use Download .md instead")},"Copy Markdown"),
      canShare?el("button",{class:"btn ghost",type:"button",onclick:async()=>{try{await navigator.share({files:[shareFile],title:p.title||"Appraisal"})}catch(e){if(e.name!=="AbortError")toast("Couldn't share — use Download instead")}}},"Share file…"):null,
      el("button",{class:"btn ghost",type:"button",onclick:()=>toast("Saved "+slug+".md ("+kb(download(slug+".md",md,"text/markdown"))+") — check Downloads")},"Download .md"),
      el("button",{class:"btn ghost",type:"button",onclick:()=>toast("Saved "+slug+".txt ("+kb(download(slug+".txt",txt,"text/plain"))+") — check Downloads")},"Download .txt")),
    el("details",{class:"why"},el("summary",{text:"Preview what's exported"}),preview))}

function paperAsArticle(p){return{pmid:p.pmid||"",pmc:p.pmc||"",doi:p.doi||"",title:p.title,journal:p.journal,journalAbbr:p.journal,year:p.year,authors:p.authors?[p.authors]:[],authorShort:p.authors||"",abstract:p.abstractText||"",abstractParts:p.abstractParts||null,pubTypes:p.pubTypes||[],mesh:[],fullText:p.sourceText||""}}

function askBox(p){
  const box=el("textarea",{placeholder:"e.g. Would this apply to my patients with PCV? How does it compare with TENAYA?"}),out=el("div",{class:"answer"}),btn=el("button",{class:"btn",type:"button"},"Ask Gemini");
  btn.onclick=async()=>{const q=box.value.trim();if(!q)return;if(!gKey()){out.textContent="Add a free Gemini key in Settings to ask questions.";return}
    btn.disabled=true;out.textContent="Thinking…";
    const ctx=JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k])=>!["id","read","starred","sourceText"].includes(k))));
    try{out.textContent=await gemini(`You are a senior UK medical-retina consultant helping a colleague (an NHS ophthalmologist, medical retina fellow) think about one paper. Answer the question in plain, direct prose, 80–200 words, UK spelling. Ground the answer in the paper's data shown; where you add outside knowledge (other trials, NICE/RCOphth guidance), say so and name it. Be honest about uncertainty.\n\nPAPER AND APPRAISAL (JSON):\n${ctx.slice(0,60000)}\n\nPAPER TEXT EXCERPT:\n${(p.sourceText||"").slice(0,60000)}\n\nQUESTION: ${q}`,false)}
    catch(e){out.textContent=e.message||"Gemini didn't answer. Try again."}finally{btn.disabled=false}};
  return el("div",{class:"sec"},el("h4",{text:"Ask about this paper"}),box,el("div",{class:"actions"},btn),out);
}

/* ---------- PubMed ---------- */
const EU="https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
const PRESETS={
  retina:["Latest in retina",'(retina[tiab] OR retinal[tiab] OR macular[tiab] OR maculopathy[tiab] OR choroidal[tiab] OR retinopathy[tiab] OR intravitreal[tiab] OR "geographic atrophy"[tiab])'],
  namd:["nAMD / PCV",'("neovascular age-related macular degeneration"[tiab] OR "neovascular AMD"[tiab] OR nAMD[tiab] OR "wet AMD"[tiab] OR polypoidal[tiab] OR "macular neovascularization"[tiab] OR "choroidal neovascularization"[tiab])'],
  ga:["GA / dry AMD",'("geographic atrophy"[tiab] OR "intermediate age-related macular degeneration"[tiab] OR "intermediate AMD"[tiab] OR drusen[tiab] OR "dry AMD"[tiab] OR "reticular pseudodrusen"[tiab])'],
  dmo:["DMO / DR",'("diabetic macular edema"[tiab] OR "diabetic macular oedema"[tiab] OR "diabetic retinopathy"[tiab])'],
  rvo:["RVO",'("retinal vein occlusion"[tiab] OR "branch retinal vein"[tiab] OR "central retinal vein"[tiab])'],
  ird:["Inherited retinal",'("Retinal Dystrophies"[mh] OR "inherited retinal"[ti] OR "retinitis pigmentosa"[ti] OR Stargardt[ti] OR "retinal dystrophy"[ti] OR "cone-rod dystrophy"[ti] OR "rod-cone dystrophy"[ti] OR choroideremia[ti] OR "Leber congenital amaurosis"[ti] OR "Best disease"[ti] OR "X-linked retinoschisis"[ti])'],
  uveitis:["Uveitis",'(uveitis[tiab] OR uveitic[tiab] OR scleritis[tiab] OR choroiditis[tiab] OR "Behcet"[tiab] OR "Vogt-Koyanagi"[tiab] OR birdshot[tiab] OR "ocular inflammation"[tiab])'],
  imaging:["Imaging & AI",'(("optical coherence tomography"[tiab] OR "OCT angiography"[tiab] OR OCTA[tiab] OR "deep learning"[tiab] OR "artificial intelligence"[tiab] OR autofluorescence[tiab]) AND (retinal[tiab] OR macular[tiab] OR retina[tiab]))'],
  drugs:["Systemic drugs & the eye",'((semaglutide[tiab] OR "GLP-1"[tiab] OR SGLT2[tiab] OR hydroxychloroquine[tiab] OR pentosan[tiab] OR "checkpoint inhibitor"[tiab] OR "MEK inhibitor"[tiab]) AND (retinopathy[tiab] OR macular[tiab] OR uveitis[tiab] OR retinal[tiab]))']
};
const TYPES={
  trial:'(Randomized Controlled Trial[pt] OR Clinical Trial[pt])',
  review:'(Meta-Analysis[pt] OR Systematic Review[pt])',
  obs:'(Observational Study[pt] OR Cohort Studies[mh] OR cohort[tiab] OR "real-world"[tiab] OR registry[tiab] OR retrospective[tiab])',
  diag:'(Sensitivity and Specificity[mh] OR "diagnostic accuracy"[tiab] OR "area under the curve"[tiab])',
  case:'(Case Reports[pt] OR "case series"[tiab])'
};
const JOURNALS='("Ophthalmology"[ta] OR "Ophthalmol Retina"[ta] OR "JAMA Ophthalmol"[ta] OR "Am J Ophthalmol"[ta] OR "Br J Ophthalmol"[ta] OR "Retina"[ta] OR "Eye (Lond)"[ta] OR "Prog Retin Eye Res"[ta] OR "Acta Ophthalmol"[ta] OR "Graefes Arch Clin Exp Ophthalmol"[ta] OR "Ocul Immunol Inflamm"[ta] OR "Ophthalmol Sci"[ta] OR "Invest Ophthalmol Vis Sci"[ta] OR "Lancet"[ta] OR "N Engl J Med"[ta] OR "JAMA"[ta] OR "BMJ"[ta] OR "Cochrane Database Syst Rev"[ta] OR "Am J Ophthalmol Case Rep"[ta] OR "Retin Cases Brief Rep"[ta])';
const NOISE=' NOT (Letter[pt] OR Comment[pt] OR Editorial[pt] OR Published Erratum[pt] OR Retraction Notice[pt] OR News[pt])';
const NOISE_TYPES=/^(Letter|Comment|Editorial|Published Erratum|Retraction|News|Expression of Concern)/i;

let preset="retina",searched=false,results=[],resTotal=0,resStart=0,lastQuery="",isIdLookup=false;
const busy={};
for(const[k,[label]]of Object.entries(PRESETS))$("#presets").append(el("button",{class:"chip",type:"button","data-k":k,"aria-pressed":String(k===preset),onclick:()=>{preset=k;$("#fq").value="";$("#fsort").value="pub_date";if(!$("#fdate").value)$("#fdate").value="30";$("#fjournals").checked=true;markPresets();runSearch()}},label));
function markPresets(){for(const b of $("#presets").children)b.setAttribute("aria-pressed",String(b.dataset.k===preset&&!$("#fq").value.trim()))}
$("#findform").onsubmit=e=>{e.preventDefault();if($("#fq").value.trim()){preset="";$("#fdate").value="";$("#fsort").value="relevance";$("#fjournals").checked=false}markPresets();runSearch()};
for(const id of ["#ftype","#fdate","#fjournals","#fsort"])$(id).onchange=()=>runSearch();
$("#more").onclick=()=>runSearch(true);

function idQuery(text){const t=text.trim();
  let m=t.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{5,9})/)||t.match(/^(?:PMID:?\s*)?(\d{5,9})$/i);if(m)return m[1]+"[pmid]";
  m=t.match(/(?:doi\.org\/|^doi:?\s*|^)(10\.\d{4,9}\/[^\s"]+)/i);if(m)return '"'+m[1].replace(/[.,;)]+$/,"")+'"[doi]';
  return null}
function buildQuery(){
  const idq=idQuery($("#fq").value);isIdLookup=!!idq;if(idq)return idq;
  const free=$("#fq").value.trim();
  const parts=[free?`(${free})`:PRESETS[preset||"retina"][1]];
  const t=$("#ftype").value;if(t)parts.push(TYPES[t]);
  if($("#fjournals").checked)parts.push(JOURNALS);
  return parts.join(" AND ")+NOISE;
}
function ymd(d){return d.getFullYear()+"/"+String(d.getMonth()+1).padStart(2,"0")+"/"+String(d.getDate()).padStart(2,"0")}
async function getJSON(u){const r=await fetch(u);if(!r.ok)throw new Error("HTTP "+r.status);return r.json()}
async function getText(u){const r=await fetch(u);if(!r.ok)throw new Error("HTTP "+r.status);return r.text()}

async function runSearch(more=false){
  searched=true;
  const q=buildQuery();saveState();
  if(!more){resStart=0;results=[];lastQuery=q;renderResults(true)}
  $("#fcount").textContent="Searching PubMed…";$("#morewrap").hidden=true;
  const p=new URLSearchParams({db:"pubmed",retmode:"json",retmax:"20",retstart:String(resStart),sort:$("#fsort").value==="relevance"?"relevance":"pub_date",term:q,tool:"retina-appraiser"});
  const days=$("#fdate").value;
  if(days&&!isIdLookup){p.set("datetype","edat");p.set("mindate",ymd(new Date(Date.now()-days*864e5)));p.set("maxdate",ymd(new Date()))}
  try{
    const s=await getJSON(EU+"esearch.fcgi?"+p);
    const ids=arr(s.esearchresult?.idlist);resTotal=Number(s.esearchresult?.count)||0;
    if(lastQuery!==q)return;
    if(ids.length){const arts=await fetchArticles(ids);results=results.concat(arts.filter(a=>!a.pubTypes.some(t=>NOISE_TYPES.test(t))))}
    resStart+=ids.length;
    $("#fcount").textContent=isIdLookup?(resTotal?"Found that paper on PubMed.":"No PubMed paper with that PMID or DOI. Check it, or upload the PDF below."):resTotal?`${resTotal.toLocaleString("en-GB")} papers on PubMed · ${$("#fsort").value==="relevance"?"best match first":"newest first"} · letters & editorials hidden`:"No papers found. Try Any time, untick major journals, or change the words.";
    $("#morewrap").hidden=!(resStart<resTotal);
    renderResults();
  }catch(e){$("#fcount").textContent=navigator.onLine?"PubMed didn't answer. Check the search words and try again.":"You're offline. Your library still works; searching needs the internet.";renderResults()}
}

/* PubMed XML → plain objects */
async function fetchArticles(ids){
  const xml=await getText(EU+"efetch.fcgi?db=pubmed&retmode=xml&tool=retina-appraiser&id="+ids.join(","));
  const doc=new DOMParser().parseFromString(xml,"text/xml");
  const byId={};
  for(const a of doc.querySelectorAll("PubmedArticle")){
    const tx=(sel,root=a)=>root.querySelector(sel)?.textContent?.trim()||"";
    const pmid=tx("MedlineCitation > PMID");
    const parts=[...a.querySelectorAll("Abstract > AbstractText")].map(n=>({label:n.getAttribute("Label")||"",text:n.textContent.trim()}));
    const authors=[...a.querySelectorAll("AuthorList > Author")].map(x=>[tx("LastName",x),tx("Initials",x)].filter(Boolean).join(" ")||tx("CollectiveName",x)).filter(Boolean);
    const idOf=t=>a.querySelector(`PubmedData ArticleIdList ArticleId[IdType="${t}"]`)?.textContent?.trim()||"";
    const year=tx("Article Journal PubDate Year")||(tx("Article Journal PubDate MedlineDate").match(/\d{4}/)||[""])[0]||tx("ArticleDate Year");
    const month=tx("Article Journal PubDate Month");
    byId[pmid]={pmid,pmc:idOf("pmc"),doi:idOf("doi"),title:tx("ArticleTitle"),journal:tx("Journal > Title"),journalAbbr:tx("Journal > ISOAbbreviation"),year,month,
      authors,authorShort:authors.length?authors[0]+(authors.length>1?" et al.":""):"",
      abstract:parts.map(p=>(p.label?p.label+": ":"")+p.text).join("\n\n"),abstractParts:parts,
      pubTypes:[...a.querySelectorAll("PublicationTypeList > PublicationType")].map(n=>n.textContent.trim()),
      mesh:[...a.querySelectorAll("MeshHeading > DescriptorName")].map(n=>n.textContent.trim()),
      keywords:[...a.querySelectorAll("KeywordList > Keyword")].map(n=>n.textContent.trim())};
  }
  return ids.map(id=>byId[id]).filter(Boolean);
}
/* Europe PMC full text (open-access papers only) */
async function fetchFullText(a){
  if(!a.pmc)return "";
  try{
    const xml=await getText(`https://www.ebi.ac.uk/europepmc/webservices/rest/${a.pmc}/fullTextXML`);
    const doc=new DOMParser().parseFromString(xml,"text/xml");
    const body=doc.querySelector("body");if(!body)return "";
    for(const n of body.querySelectorAll("ref-list,xref,fig graphic,inline-formula"))n.remove();
    const out=[];
    const walk=node=>{for(const c of node.children){const tag=c.tagName.toLowerCase();
      if(tag==="title")out.push("\n## "+c.textContent.trim());
      else if(tag==="p")out.push(c.textContent.replace(/\s+/g," ").trim());
      else if(tag==="table-wrap"){const cap=c.querySelector("caption");out.push("\n[Table] "+(cap?cap.textContent.trim()+" ":"")+[...c.querySelectorAll("tr")].map(r=>[...r.children].map(x=>x.textContent.trim()).join(" | ")).join("\n"))}
      else if(tag==="fig"){const cap=c.querySelector("caption");if(cap)out.push("[Figure] "+cap.textContent.replace(/\s+/g," ").trim())}
      else walk(c)}};
    walk(body);
    const t=out.join("\n").trim();
    return t.length>2000?t:"";
  }catch{return ""}
}

function pubDate(a){return [a.month,a.year].filter(Boolean).join(" ")}
function shownType(a){const t=a.pubTypes.filter(x=>!/^(Journal Article|English Abstract|Research Support|Multicenter Study|Comparative Study)/.test(x));return t[0]||"Original study"}
function renderResults(loading){
  const box=$("#results");box.replaceChildren();
  if(loading){box.append(el("div",{class:"empty"},el("h3",{text:"Searching PubMed…"})));return}
  if(!results.length){if(!searched)box.append(el("div",{class:"empty"},el("h3",{text:"Find papers to appraise"}),el("p",{text:"Pick a topic or type a search. Each paper has AI appraise (Gemini) and Appraise myself (no AI)."})));return}
  const have=new Map(papers.filter(p=>p.pmid).map(p=>[String(p.pmid),p]));
  for(const a of results){
    const done=have.get(a.pmid);
    const abs=el("p",{class:"abs",text:a.abstract||"No abstract on PubMed."});
    const act=el("div",{class:"actions"});
    if(done)act.append(el("button",{class:"btn ghost",type:"button",onclick:()=>openPaper(done.id)},"Open appraisal"),starButton(done,renderResults),el("span",{class:"pill done",text:"✓ in library"}));
    else if(busy[a.pmid])act.append(el("span",{class:"prog","data-pmid":a.pmid,text:busyLabel(a.pmid)}));
    else act.append(el("button",{class:"btn",type:"button",onclick:()=>queueAI(a)},"AI appraise"),el("button",{class:"btn ghost",type:"button",onclick:()=>startManual(a)},"Appraise myself"),
      el("a",{class:"btn ghost",href:CLAUDE_APP+"#pm"+a.pmid,target:"_blank",rel:"noopener",title:"Opens your Claude version at this paper (needs a Claude subscription)"},"Claude ↗"));
    act.append(el("a",{class:"linkbtn",href:"https://pubmed.ncbi.nlm.nih.gov/"+a.pmid+"/",target:"_blank",rel:"noopener",text:"PubMed"}));
    if(a.pmc)act.append(el("a",{class:"linkbtn",href:"https://pmc.ncbi.nlm.nih.gov/articles/"+a.pmc+"/",target:"_blank",rel:"noopener",text:"Full text"}));
    box.append(el("article",{class:"res"},
      el("div",{class:"row"},el("span",{class:"pill type",text:shownType(a)}),a.pmc?el("span",{class:"pill free",text:"free full text"}):null),
      el("h3",{text:a.title||"Untitled"}),
      el("div",{class:"meta",text:[a.authorShort,a.journalAbbr||a.journal,pubDate(a)].filter(Boolean).join(" · ")}),
      abs,a.abstract?el("button",{class:"linkbtn",type:"button",onclick:e=>{abs.classList.toggle("open");e.target.textContent=abs.classList.contains("open")?"Less":"Read abstract"}},"Read abstract"):null,act,
      errs[a.pmid]?el("p",{class:"err",role:"alert",text:errs[a.pmid]}):null));
  }
}
/* busy state per paper, with a running clock so a slow answer never looks like nothing happening */
const busyStart={},errs={};
const CLAUDE_APP="https://claude.ai/artifact/C9FtH4aSh5uGPQ7F2yF5UU";
function busyLabel(id){const s=busyStart[id]?Math.round((Date.now()-busyStart[id])/1000):0;return busy[id]+(s>2?" "+s+"s":"")}
function setBusy(id,text){if(text){busy[id]=text;busyStart[id]=busyStart[id]||Date.now();delete errs[id]}else{delete busy[id];delete busyStart[id]}if(view==="find")renderResults()}
setInterval(()=>{for(const n of document.querySelectorAll(".prog[data-pmid]"))if(busy[n.dataset.pmid])n.textContent=busyLabel(n.dataset.pmid)},1000);

/* ---------- Gemini ---------- */
const GAPI="https://generativelanguage.googleapis.com/v1beta/";
const gKey=()=>store.get("gkey","");
let modelCache=null;
async function listModels(key){
  const r=await fetch(GAPI+"models?pageSize=200",{headers:{"x-goog-api-key":key}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error?.message||("Gemini error "+r.status));
  const ok=arr(j.models).filter(m=>arr(m.supportedGenerationMethods).includes("generateContent")).map(m=>m.name.replace(/^models\//,""))
    .filter(n=>/^gemini-/.test(n)&&/flash/.test(n)&&!/(image|tts|audio|live|embedding|exp|vision|thinking)/.test(n));
  const ver=n=>{const m=n.match(/gemini-(\d+(?:\.\d+)?)/);return m?parseFloat(m[1]):0};
  /* stable before preview: previews are often slower, gated or withdrawn */
  const score=n=>ver(n)*100-(/lite/.test(n)?50:0)-(/preview/.test(n)?120:0)-(/-\d{3,}$|latest$/.test(n)?1:0);
  return ok.sort((a,b)=>score(b)-score(a));
}
async function modelOrder(){
  const key=gKey();if(!key)return [];
  if(!modelCache){try{modelCache=await listModels(key)}catch{modelCache=["gemini-flash-latest","gemini-flash-lite-latest"]}}
  const chosen=store.get("gmodel","");
  const lites=modelCache.filter(n=>/lite/.test(n)),full=modelCache.filter(n=>!/lite/.test(n));
  return [...new Set([chosen,...full.slice(0,2),...lites.slice(0,1)].filter(Boolean))];
}
class GeminiError extends Error{}
async function gemini(prompt,json,images){
  const key=gKey();if(!key)throw new GeminiError("Add a free Gemini key in Settings first.");
  const parts=[{text:prompt}];
  for(const img of arr(images))parts.push({inline_data:{mime_type:img.type||"image/jpeg",data:await blobToB64(img)}});
  /* thinking models spend output tokens on reasoning first, so leave plenty of room */
  const body={contents:[{role:"user",parts}],generationConfig:{temperature:0.2,maxOutputTokens:32768,...(json?{responseMimeType:"application/json"}:{})}};
  const models=await modelOrder();
  if(!models.length)throw new GeminiError("No Gemini model is available for this key. Tap Test Gemini in Settings.");
  let last="",lastStatus=0;
  const call=async model=>{
    const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),180000);
    try{const r=await fetch(GAPI+"models/"+model+":generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify(body),signal:ctl.signal});return[r,await r.json().catch(()=>({}))]}
    finally{clearTimeout(timer)}
  };
  for(const model of models){
    let r,j,hidden=false;
    const onVis=()=>{if(document.hidden)hidden=true};document.addEventListener("visibilitychange",onVis);
    try{
      try{[r,j]=await call(model)}
      catch(e){if(e.name==="AbortError")throw e;await new Promise(res=>setTimeout(res,2000));[r,j]=await call(model)}   // one automatic retry on a dropped connection
    }catch(e){
      if(e.name==="AbortError")throw new GeminiError("Gemini took over 3 minutes and was stopped. Try again — or use Appraise myself.");
      throw new GeminiError(await diagnoseNetwork(key,hidden,e));
    }finally{document.removeEventListener("visibilitychange",onVis)}
    if(r.ok){
      const cand=j.candidates?.[0];
      const text=arr(cand?.content?.parts).filter(p=>!p.thought&&p.text).map(p=>p.text).join("");
      if(cand?.finishReason==="MAX_TOKENS")throw new GeminiError("Gemini's answer was cut off before it finished. Tap AI appraise again.");
      if(!text)throw new GeminiError(cand?.finishReason==="SAFETY"||j.promptFeedback?.blockReason?"Gemini declined this text ("+(j.promptFeedback?.blockReason||"safety")+").":"Gemini returned an empty answer ("+(cand?.finishReason||"no reason given")+"). Try again.");
      store.set("lastModel",model);
      return text;
    }
    last=j.error?.message||("HTTP "+r.status);lastStatus=r.status;
    if(r.status===400&&/API key/i.test(last))throw new GeminiError("Your Gemini key isn't valid. Check it in Settings.");
    if(r.status===403)throw new GeminiError("Google refused the key: "+last);
    if(![404,429,500,503].includes(r.status))break;   // otherwise try the next model
  }
  if(lastStatus===429)throw new GeminiError(/per.?day|daily|PerDay/i.test(last)?"You've used today's free Gemini allowance. It resets tomorrow — use Appraise myself until then.":"Gemini's free tier is busy or you've hit the per-minute limit. Wait a minute and tap AI appraise again.");
  throw new GeminiError("Gemini couldn't answer: "+last);
}
/* when a request dies before Google answers, work out why and say it plainly */
async function diagnoseNetwork(key,wentHidden,err){
  const raw=" (technical detail: "+(err?.name||"Error")+" — "+(err?.message||"no message")+")";
  if(!navigator.onLine)return "Your device is offline. Reconnect and tap AI appraise again.";
  if(wentHidden)return "The connection to Gemini was cut because the app went into the background or the screen switched off. Keep the app open on screen until the appraisal appears, then try again."+raw;
  let googleOK=false,pubmedOK=false;
  try{const r=await fetch(GAPI+"models?pageSize=1",{headers:{"x-goog-api-key":key},cache:"no-store"});googleOK=r.status>0}catch{}
  try{const r=await fetch(EU+"einfo.fcgi?retmode=json",{cache:"no-store"});pubmedOK=r.ok}catch{}
  if(!googleOK&&pubmedOK)return "This network is blocking Google's Gemini service (generativelanguage.googleapis.com), although PubMed works. Hospital/NHS Wi-Fi often blocks AI services. Switch to mobile data or home Wi-Fi and tap AI appraise again — or use Appraise myself / Claude ↗."+raw;
  if(!googleOK)return "Your device can't reach Google's Gemini service right now. Try another network (mobile data or home Wi-Fi)."+raw;
  return "Gemini is reachable, but the appraisal request was dropped on the way. Keep the app open on screen and tap AI appraise again. If it keeps happening, try Settings → Test Gemini and send me what it says."+raw;
}
/* keep the phone screen on while Gemini writes (Android cuts background connections) */
let wakeLock=null;
async function holdAwake(on){try{if(on&&!wakeLock&&navigator.wakeLock)wakeLock=await navigator.wakeLock.request("screen");else if(!on&&wakeLock){await wakeLock.release();wakeLock=null}}catch{wakeLock=null}}
function blobToB64(b){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(",")[1]);r.onerror=rej;r.readAsDataURL(b)})}
function parseJSON(t){try{return JSON.parse(t)}catch{}const f=t.match(/```(?:json)?\s*([\s\S]*?)```/);if(f)try{return JSON.parse(f[1])}catch{}const a=t.indexOf("{"),b=t.lastIndexOf("}");if(a>=0&&b>a)try{return JSON.parse(t.slice(a,b+1))}catch{}return null}

const APPRAISE=`You are a senior medical-retina consultant and clinical epidemiologist. Critically appraise the research paper below for a UK NHS ophthalmologist (medical retina & cataract fellow) who wants to know: what it found, how trustworthy it is, what level of evidence it is, what it adds, what it lacks, how to use it in clinic, and what to tell patients.

Rules:
- Use ONLY facts in the supplied text/images for numbers. Never invent figures, p-values or sample sizes. If something is not reported, say "not reported".
- Papers can be ANY design: RCT, meta-analysis, cohort, registry/real-world, case-control, cross-sectional, diagnostic accuracy, imaging/AI, economic model, case series, case report, lab/animal. Appraise each with the recognised tool for its design: RCT — Cochrane RoB 2 domains + CASP RCT (CONSORT 2025 for reporting); systematic review/meta-analysis — AMSTAR-2 critical domains (PRISMA 2020); cohort/case-control — CASP + STROBE; cross-sectional — AXIS; diagnostic/imaging/AI — QUADAS-2 + STARD 2015; case series — JBI; case report — JBI + CARE; economic — CHEERS 2022. Name the tool used in levelWhy and use its domains in "bias".
- Be genuinely critical. Note industry funding, surrogate endpoints, post hoc analyses, short follow-up, non-inferiority margins, multiplicity, generalisability to a UK NHS population.
- Evidence level = Oxford CEBM 2011 for the question type the paper answers (treatment, diagnosis, prognosis, harm, screening): "1" systematic review of the top design for that question, "2" RCT (or for diagnosis: cross-sectional study with consistent reference standard; for prognosis: inception cohort), "3" non-randomised cohort / follow-up, "4" case series, case-control, historical controls, "5" mechanism-based reasoning, lab, animal, modelling or expert opinion. Down-grade a level for serious bias or imprecision and say so. In levelWhy give the question type and a one-line reason. Also give GRADE certainty for the main outcome.
- Practice points must be concrete and UK-relevant (NICE TA/NG, RCOphth guidance, NHS availability) — but only cite guidance you are confident exists; otherwise speak generally.
- Counselling script: plain English a patient with no medical background understands, 80–150 words, honest about uncertainty, no jargon, no percentages without "out of 100" framing.
- UK spelling. Concise bullets (each under 30 words).

Reply with ONLY one JSON object of this exact shape:
{"title":"","authors":"First author et al.","journal":"","year":"","topic":"one of: ${TOPICS.join(" | ")}","design":"","population":"","n":"","followUp":"","intervention":"","comparator":"","primaryOutcome":"","funding":"",
"level":"1-5","levelWhy":"","grade":"High|Moderate|Low|Very low","gradeWhy":"",
"bottomLine":"two sentences max","summary":"3-5 sentences",
"keyResults":[{"label":"","value":""}],
"adds":[""],"lacks":[""],
"bias":[{"domain":"","risk":"low|some|high","note":""}],
"practice":[""],
"counselling":{"script":"","points":[""],"ifTheyAsk":[{"q":"","a":""}]},
"verdict":"change|support|know|notready|low","verdictWhy":"one or two sentences answering: does this change my practice, and why (validity, size of effect, applicability)?"}`;

async function aiAppraise({article,body,source,images,onProgress}){
  const meta=article?`PubMed record: PMID ${article.pmid}${article.pmc?", "+article.pmc:""}; journal ${article.journal}; published ${pubDate(article)}; publication types: ${article.pubTypes.join(", ")}; MeSH: ${article.mesh.slice(0,15).join(", ")}. Source supplied: ${source}.`:`Source supplied: ${source}.`;
  onProgress?.(source==="full text"?"Gemini is reading the full paper…":"Gemini is reading the abstract…");
  /* ~150k characters keeps a long paper well inside the free tier's per-minute token allowance */
  const text=await gemini(APPRAISE+"\n\n"+meta+(images?.length?`\n\nThe attached ${images.length} image(s) are photos of the paper's pages.`:"")+(body?"\n\nPAPER TEXT:\n"+body.slice(0,150000):""),true,images);
  const a=parseJSON(text);
  if(!a||!a.title)throw new GeminiError("Gemini's answer wasn't in the expected format. Tap AI appraise again.");
  const doc={...a,level:String(a.level||"").replace(/\D/g,"").slice(0,1)||"?",engine:"gemini",model:store.get("lastModel",""),source,addedAt:Date.now(),read:false,starred:false,sourceText:(body||"").slice(0,80000)};
  if(article)Object.assign(doc,{pmid:article.pmid,pmc:article.pmc,doi:article.doi,title:article.title||a.title,journal:article.journal||a.journal,year:article.year||a.year,authors:article.authorShort||a.authors,pubTypes:article.pubTypes,abstractText:article.abstract,abstractParts:article.abstractParts});
  if(!TOPICS.includes(doc.topic))doc.topic=preset==="uveitis"?"Uveitis":"Other retina";
  return savePaper(doc);
}
let queue=Promise.resolve();
/* an appraisal in progress is noted on the device, so a reload can offer to resume it */
const pendingAll=()=>store.get("pending",{});
function setPending(a,on){const p=pendingAll();if(on)p[a.pmid]={a:{...a,fullText:""},at:Date.now()};else delete p[a.pmid];store.set("pending",p)}
function queueAI(a){
  if(!gKey()){toast("Add a free Gemini key in Settings to use AI appraise. Or tap Appraise myself.");show("settings");return}
  setPending(a,true);
  setBusy(a.pmid,"Queued…");
  queue=queue.then(async()=>{
    await holdAwake(true);
    try{
      setBusy(a.pmid,a.pmc?"Fetching full text…":"Reading abstract…");
      let body="",source="abstract";
      const ft=await fetchFullText(a);
      if(ft){body="ABSTRACT:\n"+a.abstract+"\n\nFULL TEXT:\n"+ft;source="full text"}
      else if(a.abstract)body="ABSTRACT:\n"+a.abstract;
      else{setPending(a,false);setBusy(a.pmid);errs[a.pmid]="No abstract or free full text for this paper on PubMed. Upload the PDF instead (bottom of this page).";renderResults();return}
      const id=await aiAppraise({article:a,body,source,onProgress:t=>setBusy(a.pmid,t)});
      setPending(a,false);setBusy(a.pmid);
      /* show the finished appraisal straight away unless she has moved on or more are queued */
      if(view==="find"&&!Object.keys(busy).length)openPaper(id);else{toast("Appraised — tap Open appraisal");if(view==="find")renderResults()}
      return id;
    }catch(e){setPending(a,false);setBusy(a.pmid);errs[a.pmid]="Not appraised: "+(e instanceof GeminiError?e.message:(e.message||"unknown error"));if(view==="find")renderResults();else toast(errs[a.pmid])}
    finally{await holdAwake(false)}
  });
}

/* ---------- appraise it myself (no AI) ---------- */
/* Each checklist follows a recognised tool. Item: [id, domain, question, what it lacks if No, why it matters, critical?].
   Critical items drive the overall judgement (RoB 2 / QUADAS-2 / AMSTAR-2 rules). Answers are keyed by item id;
   "legacy" maps the old numbered keys (earlier version of the app) onto the new ids. */
const PM=(label,pmid,pmc)=>({label,pmid,pmc});
const DESIGNS={
  sr:{name:"Systematic review / meta-analysis",level:"1",plain:"a review that pooled the results of several studies",
    tool:"AMSTAR-2 (critical appraisal) with PRISMA 2020 (reporting)",rule:"amstar",refs:[PM("AMSTAR 2 — Shea 2017","28935701","PMC5833365"),PM("PRISMA 2020 — Page 2021","33782057","PMC8005924")],
    legacy:["pico","search","design","rob","het","precision","pubbias","protocol","apply"],qs:[
    ["pico","PICO (AMSTAR 1)","Did the question and inclusion criteria include the PICO components (population, intervention, comparator, outcome)?","Question / PICO not clearly defined","A review is only as useful as its question: a loose PICO lets very different patients and treatments be pooled together."],
    ["protocol","Protocol (AMSTAR 2)","Was a protocol registered before the review began (e.g. PROSPERO), with any deviations justified?","No registered protocol","Without a protocol, reviewers can change inclusion criteria or outcomes after seeing the results.",1],
    ["design","Study designs (AMSTAR 3)","Did the authors explain why they included the study designs they did (ideally RCTs for treatment questions)?","Choice of study designs not justified","Mixing RCTs with retrospective series lets the weaker studies drive the pooled result."],
    ["search","Search (AMSTAR 4)","Was the search comprehensive: at least two databases, trial registries, grey literature, no language limits, and recent?","Search may have missed studies","Unpublished and non-English trials are more often negative; missing them tends to exaggerate benefit.",1],
    ["dup","Duplicate screening & extraction (AMSTAR 5–6)","Did two reviewers independently select studies and extract data?","Single-reviewer screening or extraction","One reviewer working alone misses eligible studies and makes more extraction errors."],
    ["excl","Excluded studies (AMSTAR 7)","Is there a list of excluded studies with reasons?","Excluded studies not listed / justified","Lets you check that inconvenient studies weren't quietly dropped.",1],
    ["detail","Included studies described (AMSTAR 8)","Were the included studies described in enough detail (patients, interventions, comparators, follow-up)?","Included studies poorly described","You need this to judge whether pooling made sense and whether the studies resemble your patients."],
    ["rob","Risk of bias assessed (AMSTAR 9)","Did they assess risk of bias in each included study with a recognised tool (RoB 2, ROBINS-I)?","Risk of bias of included studies not properly assessed","Pooling biased studies gives a precise-looking but wrong answer — 'garbage in, garbage out'.",1],
    ["funding","Funding of included studies (AMSTAR 10)","Did they report the funding sources of the included studies?","Funding of included studies not reported","Industry-funded trials more often report favourable results; a review should show how much of the evidence that is."],
    ["meta","Meta-analysis methods (AMSTAR 11)","If pooled, were the statistical methods appropriate (random-effects where studies differ; RCTs and observational studies not naively combined)?","Inappropriate pooling methods","The wrong model or pooling unlike designs can create a spurious or over-precise effect.",1],
    ["robimpact","Bias in interpretation (AMSTAR 12–13)","Did they consider the risk of bias of the studies when pooling and interpreting the results (e.g. sensitivity analysis excluding high-risk studies)?","Risk of bias ignored when interpreting results","If the effect disappears when only low-risk studies are kept, the headline result shouldn't be trusted.",1],
    ["het","Heterogeneity (AMSTAR 14)","Was heterogeneity (I², differing results) explored and explained?","High or unexplained heterogeneity","When studies disagree a lot, a single pooled number hides real differences between patients or treatments."],
    ["pubbias","Publication bias (AMSTAR 15)","Was publication bias investigated (funnel plot, Egger test when ≥10 studies) and its likely impact discussed?","Publication bias not assessed","Small positive studies get published, small negative ones don't — the pooled effect then looks bigger than reality.",1],
    ["coi","Review conflicts (AMSTAR 16)","Did the review authors report their own funding and conflicts of interest?","Review conflicts of interest not reported","Reviews by authors with industry links reach more favourable conclusions."],
    ["precision","Results & certainty (PRISMA / GRADE)","Is the pooled estimate precise (narrow 95% CI) and is the certainty of evidence (GRADE) reported?","Imprecise pooled estimate / certainty not graded","A pooled CI crossing 'no effect' or a 'low certainty' GRADE rating means the answer could easily change."],
    ["apply","Applicability","Do the results apply to my NHS patients and services?","Limited applicability to UK NHS patients","Trials pooled from other health systems may use regimens, populations or comparators that don't match yours."]]},
  rct:{name:"Randomised controlled trial",level:"2",plain:"a fair test where people were put into groups by chance",
    tool:"Cochrane RoB 2 (risk of bias) with CASP RCT checklist and CONSORT 2025 (reporting)",rule:"rob",refs:[PM("RoB 2 — Sterne 2019","31462531"),PM("CONSORT 2025 — Hopewell 2025","40228833","PMC11995449")],
    legacy:["q","rand","conceal","mask","baseline","missing","report","effect","harms","coi","apply"],qs:[
    ["q","Question (CASP 1)","Did it address a clearly focused question (population, intervention, comparator, outcomes)?","Unfocused question","If the PICO is vague you can't tell whether the answer applies to the patient in front of you."],
    ["rand","Randomisation (RoB 2 D1)","Was the allocation sequence truly random (computer-generated — not by date, hospital number or clinician choice)?","Assignment not truly random","Non-random allocation lets prognosis decide who gets which treatment — exactly the bias randomisation is meant to remove.",1],
    ["conceal","Allocation concealment (RoB 2 D1)","Was allocation concealed until each patient was enrolled (central/web system, sealed opaque envelopes)?","Allocation concealment unclear","If recruiters can foresee the next allocation they can steer patients; poorly concealed trials overestimate benefit.",1],
    ["baseline","Baseline balance (RoB 2 D1)","Were the groups similar at the start (age, baseline VA, lesion type, previous treatment)?","Groups differed at baseline","Imbalance in baseline vision or disease activity can look like a treatment effect, especially in small trials."],
    ["mask","Masking (RoB 2 D2)","Were patients and treating clinicians masked to treatment (e.g. sham injections)?","Not masked (open-label or unclear)","Unmasked patients and clinicians behave differently — extra visits, co-treatments, more effort on the letter chart."],
    ["itt","Deviations & ITT (RoB 2 D2)","Were patients analysed in the groups they were randomised to (intention-to-treat), with few deviations or crossovers?","Not intention-to-treat / many deviations or crossovers","Per-protocol analyses drop people who did badly or stopped treatment and flatter the intervention. For non-inferiority, check both ITT and per-protocol.",1],
    ["missing","Missing outcome data (RoB 2 D3)","Were outcome data available for nearly all participants, with losses small, balanced between arms and explained?","Losses to follow-up large or unbalanced","If more than ~10–20% are lost, or losses differ between arms, the result may reflect who dropped out. Check how missing data were handled (LOCF?).",1],
    ["assess","Outcome measurement (RoB 2 D4)","Was the outcome measured the same way in both arms, by assessors masked to treatment (masked VA examiners, reading centre)?","Outcome assessors not masked","Refraction, OCT grading and 'fluid' judgements shift when the assessor knows the treatment.",1],
    ["report","Selective reporting (RoB 2 D5)","Were the primary outcome and analysis prespecified in a registered protocol (NCT/ISRCTN) and reported as planned?","Surrogate, post hoc or switched outcome","Switching outcomes or time points after seeing the data inflates false-positive findings — compare with the registry entry.",1],
    ["outcome","Outcome relevance","Is the primary outcome meaningful to patients (vision, function, treatment burden) rather than a surrogate (CST, lesion growth)?","Surrogate primary outcome","Anatomical surrogates often don't translate into vision — e.g. slowing GA growth without any BCVA benefit."],
    ["effect","Size & precision (CASP 7–8)","Is the effect big enough to matter clinically with a narrow 95% CI? For non-inferiority: is the margin justified and the whole CI inside it?","Effect small or imprecise","Statistical significance isn't clinical importance (~5 letters is one line). A generous non-inferiority margin can hide a real loss of vision."],
    ["harms","Harms (CONSORT)","Were adverse events (inflammation, vasculitis, endophthalmitis, IOP) collected systematically and reported for each arm?","Harms poorly reported","Benefit only counts against risk; rare serious harms may only show up in larger or post-marketing data."],
    ["coi","Funding & conflicts","Was the trial free of sponsor control over design, analysis and reporting?","Industry-funded / sponsor involvement","Industry-funded trials more often reach favourable conclusions; check who analysed the data and wrote the paper."],
    ["apply","Applicability (CASP 9–10)","Do the patients, dosing regimen and setting match my NHS patients and clinic capacity?","Limited applicability to UK NHS patients","Trial regimens (monthly visits, strict exclusions) may not be deliverable or relevant in a busy NHS service."],
    ["worth","Benefit vs harm & cost (CASP 11)","Do the benefits outweigh the harms and costs, including injection burden and NICE/commissioning status?","Benefit may not justify harms, burden or cost","A real but small benefit may not justify extra visits, risk or cost — this feeds straight into your verdict."]]},
  cohort:{name:"Cohort / real-world study",level:"3",plain:"a study that followed groups of patients over time",
    tool:"CASP Cohort Study checklist with STROBE (reporting)",rule:"key",refs:[PM("STROBE — von Elm 2007","18064739")],
    legacy:["q","select","expo","outc","adjust","fu","effect","believe","apply"],qs:[
    ["q","Question (CASP 1)","Did it address a clearly focused question?","Unfocused question","A clear exposure, outcome and population tells you whether the answer is relevant to your patients."],
    ["select","Recruitment (CASP 2)","Was the cohort recruited in an acceptable way — consecutive or population-based, with clear eligibility?","Selection bias likely","Cohorts of 'patients with complete data' from one tertiary centre can differ systematically from your clinic.",1],
    ["expo","Exposure (CASP 3)","Was the exposure or treatment measured accurately, and the same way in all groups?","Exposure poorly measured","Misclassified exposure (e.g. prescriptions vs actual use) dilutes or distorts the association.",1],
    ["outc","Outcome (CASP 4)","Was the outcome measured objectively, the same way in all groups, ideally by masked assessors?","Outcome measurement unreliable","Real-world VA is noisy (Snellen, unrefracted); differential measurement creates spurious differences.",1],
    ["conf","Confounders identified (CASP 5a)","Did the authors identify the important confounders (age, baseline VA, disease severity, previous treatment, number of injections)?","Important confounders not identified","Sicker patients get different treatment (confounding by indication) — the commonest reason cohorts mislead.",1],
    ["adjust","Confounders handled (CASP 5b)","Were they accounted for in the design or analysis (matching, multivariable models, propensity scores)?","Confounding not adequately handled","Adjustment only fixes what was measured; unmeasured confounding remains, so treat modest effects with caution.",1],
    ["fu","Follow-up complete (CASP 6a)","Was follow-up complete, with few lost and losses similar between groups?","Incomplete follow-up","Real-world patients lost to follow-up often do worse; ignoring them makes outcomes look better.",1],
    ["fulong","Follow-up long enough (CASP 6b)","Was follow-up long enough for the outcome to occur?","Follow-up too short","Late events (atrophy, fibrosis, recurrence, rare harms) are missed by short studies."],
    ["effect","Results & precision (CASP 7–8)","Are the results clinically meaningful and precise (effect size with 95% CI)?","Imprecise results","A wide CI means the true effect could be trivial or even the other way."],
    ["believe","Believability (CASP 9)","Do you believe it — a large effect, dose–response or clear timing, and bias unlikely to explain it?","Effect may not be believable","Big, consistent, dose-dependent effects (Bradford Hill) are much harder to explain away than small associations."],
    ["fits","Fits other evidence (CASP 11)","Does it fit with other evidence (RCTs, other cohorts)?","Conflicts with other evidence","A lone observational finding that contradicts trial evidence is usually the one that's wrong."],
    ["apply","Applicability (CASP 10)","Do the results apply to my NHS patients?","Limited applicability to UK NHS patients","Different health systems, ethnic mix and treatment regimens can change the result."]]},
  casecontrol:{name:"Case-control study",level:"4",plain:"a study comparing people with and without a condition",
    tool:"CASP Case Control Study checklist with STROBE (reporting)",rule:"key",refs:[PM("STROBE — von Elm 2007","18064739")],
    legacy:["q","cases","controls","expo","conf","effect","apply"],qs:[
    ["q","Question (CASP 1)","Did it address a clearly focused question?","Unfocused question","A clear exposure, outcome and population tells you whether the answer is relevant."],
    ["method","Right design (CASP 2)","Was a case-control design appropriate (rare outcome, or a long gap between exposure and outcome)?","Case-control design not well suited","For common outcomes or treatment effects a cohort or trial gives a more trustworthy answer."],
    ["cases","Case selection (CASP 3)","Were cases precisely defined and recruited in an acceptable way (confirmed diagnosis with imaging criteria, ideally incident cases)?","Case selection questionable","Loosely defined or prevalent cases mix in survivors and misdiagnoses, biasing the comparison.",1],
    ["controls","Control selection (CASP 4)","Were controls from the same source population — people who would have been counted as cases had they developed the disease?","Control selection questionable","Controls from a different population (e.g. other hospital patients) create spurious associations — the Achilles' heel of case-control studies.",1],
    ["expo","Exposure measurement (CASP 5)","Was exposure measured the same way in cases and controls (records rather than memory)?","Exposure measured differently (recall/measurement bias)","People with a disease remember past exposures more thoroughly than controls (recall bias).",1],
    ["conf","Confounding (CASP 6)","Were groups comparable apart from the exposure, with confounders matched or adjusted for?","Confounding not handled","An apparent link with a drug may really be a link with the disease the drug treats.",1],
    ["effect","Size & precision (CASP 7–8)","Is the odds ratio large and precise (narrow 95% CI)?","Imprecise or small effect","Odds ratios under about 2 from a case-control study are easily produced by residual bias."],
    ["believe","Believability (CASP 9)","Do you believe the result (dose–response, biological plausibility, bias unlikely)?","Effect may not be believable","Plausibility and dose–response make a causal explanation more likely."],
    ["fits","Fits other evidence (CASP 11)","Does it fit with other available evidence?","Conflicts with other evidence","Isolated case-control signals often fail to replicate."],
    ["apply","Applicability (CASP 10)","Do the results apply to my patients?","Limited applicability","The population studied may differ from yours in risk factors or ethnicity."]]},
  cross:{name:"Cross-sectional study / survey",level:"4",plain:"a snapshot survey of a group of people at one time",
    tool:"AXIS tool for cross-sectional studies with STROBE (reporting)",rule:"key",refs:[PM("AXIS — Downes 2016","27932337"),PM("STROBE — von Elm 2007","18064739")],
    legacy:["q","sample","response","measure","conf","effect","apply"],qs:[
    ["q","Aims (AXIS 1)","Were the aims and objectives clear?","Unfocused question","A clear aim tells you what the snapshot can and can't answer."],
    ["sample","Sample frame (AXIS 5–6)","Was the sample drawn from a population representative of the people it claims to describe?","Unrepresentative sample","A clinic or volunteer sample can over- or under-estimate prevalence badly.",1],
    ["size","Sample size (AXIS 3)","Was the sample size justified?","Sample size not justified","Small surveys give unstable prevalence estimates with wide CIs."],
    ["response","Response rate (AXIS 7, 13–14)","Was the response rate adequate and were non-responders described?","Low or unreported response rate","People who respond differ from those who don't (often healthier or more engaged).",1],
    ["measure","Measurement (AXIS 8–9)","Were the measurements valid and reliable (validated questionnaires, standard imaging criteria)?","Measurement validity uncertain","Home-made questionnaires or ungraded images make results hard to trust or compare.",1],
    ["conf","Confounding","Were confounders considered in the analysis?","Confounding not handled","Associations in a snapshot are easily driven by age or other shared factors."],
    ["effect","Results & precision","Are the results precise (95% CIs reported)?","Imprecise results","Without CIs you can't judge how certain the estimate is."],
    ["causal","Cause vs association (AXIS 16)","Do the conclusions avoid claiming cause and effect (exposure and outcome measured at the same time)?","Overstates causation","A cross-sectional study can't show which came first."],
    ["apply","Applicability","Do the results apply to my patients?","Limited applicability","Prevalence and associations vary between populations and settings."]]},
  diag:{name:"Diagnostic accuracy / imaging / AI",level:"2",plain:"a study testing how well a test or scan picks up a condition",
    tool:"QUADAS-2 (risk of bias) with CASP Diagnostic checklist and STARD 2015 (reporting)",rule:"rob",refs:[PM("QUADAS-2 — Whiting 2011","22007046"),PM("STARD 2015 — Bossuyt 2015","26511519","PMC4623764")],
    legacy:["q","ref","spectrum","flow","index","repro","accuracy","extval","apply"],qs:[
    ["q","Question (CASP 1)","Was there a clear question about a specific test in a specific population and setting?","Unfocused question","Accuracy depends on who is tested and why — screening, triage and specialist clinics give different answers."],
    ["spectrum","Patient selection (QUADAS-2 D1)","Was a consecutive or random sample of patients like mine enrolled, avoiding a case-control design (clear-cut cases vs healthy eyes) and inappropriate exclusions?","Spectrum bias — selected or case-control sample","Comparing obvious disease with healthy eyes inflates sensitivity and specificity substantially.",1],
    ["index","Index test (QUADAS-2 D2)","Was the index test read without knowledge of the reference standard, with its threshold prespecified (not picked to maximise accuracy)?","Index test not masked / threshold chosen after the fact","Choosing the 'best' cut-off from the same data overestimates accuracy; it must be confirmed in new patients.",1],
    ["ref","Reference standard (QUADAS-2 D3)","Is the reference standard likely to classify the condition correctly (e.g. FFA/ICGA, expert graders) and read masked to the index test?","Reference standard inadequate","If the 'truth' is wrong, every accuracy figure is wrong with it.",1],
    ["flow","Flow & timing (QUADAS-2 D4)","Did all patients get the same reference standard, within a sensible interval, and were all included in the analysis?","Partial or differential verification","Verifying only test-positives, or using different references for different patients, biases accuracy.",1],
    ["accuracy","Accuracy & precision (STARD)","Are sensitivity and specificity (and/or PPV, NPV, AUC) reported with 95% CIs, ideally with a 2×2 table?","Accuracy estimates imprecise or incomplete","Small studies give wide CIs; PPV and NPV depend on prevalence — check it matches your setting."],
    ["repro","Reproducibility (CASP)","Is the test described well enough to repeat, with repeatability or inter-grader agreement reported?","Test poorly described","A test that two graders read differently won't perform in your clinic as it did in the paper."],
    ["extval","External validation (AI)","For AI or prediction tools: was it validated on an external dataset (different centre, device, population)? Answer Yes if not an AI study.","No external validation","AI models often lose accuracy on new cameras, OCT devices or ethnic groups; internal test sets are optimistic."],
    ["apply","Applicability (QUADAS-2)","Do the patients, test and target condition match my question, and is the test available in the NHS?","Limited availability or usefulness in the NHS","A good test on a different population or device may not transfer to your service."],
    ["impact","Effect on management (CASP)","Would the result change management or outcomes for my patients?","Unlikely to change management","Accuracy alone isn't benefit — a test is only useful if it changes what you do."]]},
  series:{name:"Case series",level:"4",plain:"a report of a group of patients treated in one way, without a comparison group",
    tool:"JBI Critical Appraisal Checklist for Case Series",rule:"key",refs:[PM("JBI case series tool — Munn 2020","33038125")],
    legacy:[null,"consec","incl","outcomes",null,"comparison","apply"],qs:[
    ["incl","Inclusion criteria (JBI 1)","Were there clear criteria for inclusion?","Inclusion criteria unclear","Without clear criteria you can't tell who these patients were or whether yours are similar."],
    ["measure","Condition measured (JBI 2)","Was the condition measured in a standard, reliable way for all participants (defined imaging/clinical criteria)?","Condition not measured reliably","Inconsistent diagnosis means the 'series' may mix different diseases."],
    ["ident","Valid identification (JBI 3)","Were valid methods used to identify the condition for all participants?","Identification methods questionable","Cases found by different routes may differ in severity."],
    ["consec","Consecutive inclusion (JBI 4)","Were patients included consecutively?","Cases may be selected","Picking 'interesting' or successful cases makes a treatment look better than it is.",1],
    ["complete","Complete inclusion (JBI 5)","Was inclusion complete (all eligible patients over the period)?","Incomplete inclusion","Missing patients are often the ones who did badly or didn't return.",1],
    ["demog","Demographics (JBI 6)","Were participants' demographics clearly reported?","Demographics poorly reported","Needed to judge whether results apply to your population."],
    ["clinical","Clinical information (JBI 7)","Was clinical information (severity, previous treatment, imaging) clearly reported?","Clinical details poorly reported","Severity and prior treatment strongly affect outcomes."],
    ["outcomes","Outcomes & follow-up (JBI 8)","Were outcomes and follow-up clearly reported, and long enough?","Outcomes or follow-up poorly reported","Short or patchy follow-up misses recurrence and late complications.",1],
    ["site","Setting (JBI 9)","Were the presenting site(s)/clinic(s) and their demographics reported?","Setting not described","A tertiary referral series often sees rarer and more severe disease."],
    ["stats","Statistics (JBI 10)","Was the statistical analysis appropriate?","Statistics inappropriate","Small series need simple, honest analysis; p-values without a comparator mean little."],
    ["comparison","Comparison (CEBM)","Is there any comparison (natural history, historical controls) to judge the effect?","No comparison group","Without a comparator, improvement may be natural history, regression to the mean or co-treatment."],
    ["apply","Applicability","Do the results apply to my patients?","Limited applicability","Single-centre experience may not transfer to your service."]]},
  report:{name:"Case report",level:"5",plain:"a description of one patient's case",
    tool:"JBI Critical Appraisal Checklist for Case Reports with CARE (reporting)",rule:"key",refs:[PM("CARE — Gagnier 2013","24228906","PMC3844611")],
    legacy:["condition","history","workup","treat","post",null,"lesson"],qs:[
    ["demog","Demographics (JBI 1)","Were the patient's demographic characteristics clearly described?","Patient poorly described","Helps you recognise a similar patient."],
    ["history","History & timeline (JBI 2)","Was the history clearly described and presented as a timeline?","Timeline unclear","Timing of exposures, symptoms and treatment is what makes a causal story plausible."],
    ["condition","Presentation (JBI 3)","Was the clinical condition on presentation clearly described (with imaging)?","Presentation unclear","Clear findings and images let you recognise the condition yourself."],
    ["workup","Diagnostic work-up (JBI 4)","Were diagnostic tests clearly described and alternative diagnoses considered?","Work-up incomplete / alternatives not considered","An unusual case is only instructive if mimics were properly excluded.",1],
    ["treat","Intervention (JBI 5)","Was the treatment clearly described?","Treatment unclear","You need dose, route and timing to apply the lesson."],
    ["post","Outcome (JBI 6)","Was the post-intervention condition and follow-up clearly described?","Outcome/follow-up unclear","Without follow-up you can't tell whether the outcome lasted."],
    ["harms","Adverse events (JBI 7)","Were adverse or unanticipated events identified and described?","Harms not described","Case reports are often the first signal of a rare drug harm."],
    ["lesson","Take-home lessons (JBI 8)","Does it provide clear take-home lessons?","Limited take-home value","A case report earns its place by teaching something you'd act on."]]},
  econ:{name:"Economic evaluation / model",level:"5",plain:"a calculation of whether a treatment is good value for money",
    tool:"CASP Economic Evaluation checklist with CHEERS 2022 (reporting)",rule:"key",refs:[PM("CHEERS 2022 — Husereau 2022","35017145","PMC8749494")],
    legacy:["q","alts","effect","costs","sens","apply"],qs:[
    ["q","Question & perspective","Was the question and perspective (NHS & PSS, payer, society) clear?","Perspective unclear","NICE uses the NHS and personal social services perspective; a societal one counts different costs."],
    ["alts","Comparators","Were all sensible alternatives compared (including current NHS standard care and biosimilars)?","Comparators incomplete","Comparing with an outdated or expensive alternative makes anything look good value."],
    ["effect","Effectiveness evidence","Is the effectiveness evidence behind it robust (good RCTs or a network meta-analysis)?","Rests on weak or single-study evidence","A model is only as good as the effect sizes fed into it.",1],
    ["model","Model structure & horizon","Is the model structure sensible and the time horizon long enough (often lifetime for chronic eye disease)?","Model structure or time horizon questionable","Short horizons miss long-term costs (injections, sight loss, care needs)."],
    ["costs","Costs & outcomes","Were costs and outcomes (QALYs, utilities) measured and valued credibly, with an incremental analysis (ICER)?","Costs or utilities questionable","Utilities for vision states vary widely and drive the result."],
    ["sens","Uncertainty","Were uncertainty and sensitivity analyses done (deterministic and probabilistic)?","Uncertainty poorly explored","If plausible changes flip the conclusion, the result is fragile.",1],
    ["coi","Funding","Was the analysis independent of the manufacturer?","Manufacturer-funded model","Sponsor models more often find their product cost-effective."],
    ["apply","Applicability","Does it apply to the NHS (UK costs, NICE £20–30k per QALY threshold)?","Not applicable to NHS costs/thresholds","Prices and thresholds differ between countries."]]},
  lab:{name:"Lab / animal / genetic discovery",level:"5",plain:"laboratory research, not yet tested in patients",
    tool:"General principles (ARRIVE-style rigour for animal work); no single appraisal checklist",rule:"key",refs:[],
    legacy:["q","model","controls","rigour","translation"],qs:[
    ["q","Question","Is the question clinically relevant?","Clinical relevance unclear","Many lab findings answer questions that never reach the clinic."],
    ["model","Model","Is the model (cells, organoids, animals) appropriate for human disease?","Model may not reflect human disease","Mouse retina has no macula; results often don't translate."],
    ["controls","Controls","Were appropriate controls used?","Controls inadequate","Without proper controls the effect can't be attributed to the intervention."],
    ["rigour","Rigour","Were experiments randomised, masked and replicated, with sample size justified?","Not replicated or masked","Unmasked, unreplicated lab studies have a high false-positive rate."],
    ["translation","Translation","Is there a credible path to patients?","Long way from clinical use","Most promising lab findings never become treatments."]]}
};
/* answers saved by the earlier numbered checklist → stable ids */
function migrateAnswers(design,obj){const out={},d=DESIGNS[design];
  for(const[k,v]of Object.entries(obj||{})){const[dk,rest]=k.split(":");if(!DESIGNS[dk]){continue}
    const id=/^\d+$/.test(rest)?DESIGNS[dk].legacy?.[Number(rest)]:rest;if(id)out[dk+":"+id]=v}
  return out}
/* overall judgement from the critical items, using each tool's own rule */
function overallJudgement(design,answers){
  const d=DESIGNS[design],crit=d.qs.filter(q=>q[5]),ans=q=>answers[design+":"+q[0]];
  const answered=d.qs.filter(q=>ans(q)).length,critNo=crit.filter(q=>ans(q)==="n"),critU=crit.filter(q=>ans(q)==="u"),critOpen=crit.filter(q=>!ans(q));
  const no=d.qs.filter(q=>ans(q)==="n"),unc=d.qs.filter(q=>ans(q)==="u");
  let label,value,cls;
  if(d.rule==="amstar"){label="Overall confidence (AMSTAR-2 rule)";
    const nonCrit=no.filter(q=>!q[5]).length;
    value=critNo.length>1?"Critically low":critNo.length===1?"Low":nonCrit>1?"Moderate":"High";cls=critNo.length?"high":nonCrit>1?"some":"low"}
  else if(d.rule==="rob"){label=design==="diag"?"Overall risk of bias (QUADAS-2 rule)":"Overall risk of bias (RoB 2 rule)";
    value=critNo.length?"High":critU.length?"Some concerns":"Low";cls=critNo.length?"high":critU.length?"some":"low"}
  else{label="Key validity items";value=critNo.length?"Serious concerns":critU.length?"Some concerns":"No major concerns";cls=critNo.length?"high":critU.length?"some":"low"}
  if(critOpen.length&&cls!=="high"){value+=" — provisional ("+critOpen.length+" key item"+(critOpen.length>1?"s":"")+" unanswered)";cls="some"}
  return{label,value,cls,answered,total:d.qs.length,no:no.length,unc:unc.length,yes:answered-no.length-unc.length,flags:critNo.map(q=>q[1])};
}
function detectDesign(a,text){
  const title=(a.title||"").toLowerCase(),t=(a.pubTypes||[]).join(" "),x=(title+" "+text).toLowerCase(),mesh=(a.mesh||[]).join(" ");
  if(/Meta-Analysis|Systematic Review/.test(t)||/meta-analysis|systematic review/.test(title))return["sr","publication type says systematic review / meta-analysis"];
  if(/Case Reports/.test(t))return["report","publication type says case report"];
  if(/Randomized Controlled Trial/.test(t))return["rct","publication type says randomised trial"];
  if(/cost-effectiveness|cost-utility|markov|qaly/.test(x))return["econ","mentions cost-effectiveness / QALYs"];
  if(/randomi[sz]ed (controlled |clinical )?trial|randomly assigned/.test(x))return["rct","text says randomised trial"];
  if(/sensitivity and specificity|diagnostic accuracy|area under the (receiver|curve)|\bauc\b|deep learning|algorithm/.test(x)||/Sensitivity and Specificity/.test(mesh))return["diag","mentions diagnostic accuracy / AUC / algorithm"];
  if(/case-control|case control/.test(x))return["casecontrol","mentions case-control"];
  if(/\bmice\b|\bmouse\b|\brats?\b|in vitro|cell line|organoid/.test(x)&&!/patients/.test(x))return["lab","laboratory / animal work"];
  if(/cross-sectional|survey|questionnaire/.test(x))return["cross","mentions cross-sectional / survey"];
  if(/case series|consecutive (patients|eyes|cases)/.test(x)&&!/cohort|compared with|versus|vs\.?/.test(x))return["series","mentions case series"];
  if(/cohort|retrospective|prospective|registry|real-world|database/.test(x))return["cohort","mentions cohort / retrospective / registry"];
  return["cohort","no clear label — check this"];
}
function detectFacts(text){
  const f=[],w=[];
  const n=[...text.matchAll(/\b(\d{1,3}(?:,\d{3})+|\d{2,7})\s+(patients|participants|eyes|subjects|individuals|children|adults|cases|people|women|men)\b/gi)].map(m=>m[0]);
  if(n.length)f.push("Size: "+[...new Set(n)].slice(0,3).join(", "));
  const fu=text.match(/(\d+(?:\.\d+)?)[- ](month|year|week)s?\b[^.]{0,40}(follow|treatment|period)|follow[- ]up[^.]{0,30}?(\d+(?:\.\d+)?)\s*(months?|years?|weeks?)/i);if(fu)f.push("Follow-up: "+fu[0].slice(0,60));
  const reg=text.match(/NCT\d{8}|ISRCTN\d+|CRD\d{8,}|EudraCT[\s:]*[\d-]+/g);if(reg)f.push("Registered: "+[...new Set(reg)].slice(0,2).join(", "));else w.push("No registration number found");
  if(/double[- ](masked|blind)/i.test(text))f.push("Double-masked");else if(/single[- ](masked|blind)/i.test(text))f.push("Single-masked");
  if(/open[- ]label/i.test(text))w.push("Open-label");
  if(/post[- ]hoc|secondary analysis|exploratory analysis/i.test(text))w.push("Post hoc / secondary analysis");
  if(/retrospective/i.test(text))w.push("Retrospective");
  if(/single[- ](centre|center|institution)/i.test(text))w.push("Single centre");
  if(/multi[- ]?(centre|center)|multicentre|multicenter/i.test(text))f.push("Multicentre");
  if(/non-?inferiority/i.test(text))w.push("Non-inferiority design — check the margin");
  if(/\b(Inc\.?|Ltd|Pharmaceuticals?|Genentech|Roche|Novartis|Bayer|Regeneron|Apellis|Astellas|Alcon|AbbVie|Allergan|Biogen|Alkeus|Ocugen|Kodiak|Outlook|Eyepoint|Iveric|sponsor)\b/.test(text)||/employee of|funded by .{0,40}(Inc|Ltd|Pharma)/i.test(text))w.push("Possible industry involvement");
  if(/(central subfield thickness|\bCST\b|\bCMT\b|lesion growth|growth rate|ellipsoid zone|biomarker)/i.test(text))w.push("Possible surrogate (imaging) outcome");
  return{f,w};
}
function numberSentences(text){
  return [...new Set(text.split(/(?<=[.!?])\s+(?=[A-Z(])/).filter(s=>/95%\s*CI|confidence interval|[Pp]\s*[<=]\s*\.?\d|\b(HR|OR|RR|AUC)\b\s*[=:,]?\s*\d|\d+(\.\d+)?%/.test(s)&&s.length<320).map(s=>s.trim()))].slice(0,14);
}
function highlight(text){
  const frag=document.createDocumentFragment();
  const re=/(95%\s*CI[^;)]*|\b[Pp]\s*[<=>]\s*\.?\d[\d.]*|\b(?:HR|OR|RR|AUC|MD)\b\s*[=:,]?\s*-?\d[\d.]*|-?\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?\s*(?:letters|µm|μm|mm²?|mmHg|logMAR))/g;
  let i=0;for(const m of text.matchAll(re)){frag.append(text.slice(i,m.index),el("mark",{text:m[0]}));i=m.index+m[0].length}
  frag.append(text.slice(i));return frag;
}

async function startManual(a){
  setBusy(a.pmid,a.pmc?"Fetching full text…":"Opening…");
  const ft=await fetchFullText(a);setBusy(a.pmid);
  a.fullText=ft;
  openManual(a,null);
}
function openManual(a,existing){
  /* unsaved answers survive a reload: a draft is kept per paper until it is saved */
  manualArticle=a;
  const draftKey="draft:"+(a.pmid||a.title||"paper");
  const init=existing||store.get(draftKey,null);
  lastList=view==="detail"?lastList:view==="find"?"find":lastList;
  const v=$("#v-manual");v.replaceChildren();
  const text=[a.abstract,a.fullText].filter(Boolean).join("\n\n");
  const [dkey,dwhy]=init?.designKey?[init.designKey,"your earlier choice"]:detectDesign(a,text);
  /* size/follow-up from the abstract when it has them (full text also quotes other studies) */
  const fa=detectFacts(a.abstract||""),ff=detectFacts(text);
  const facts={f:[...new Set([...fa.f,...ff.f.filter(x=>!(/^(Size|Follow-up):/.test(x)&&fa.f.some(y=>y.startsWith(x.split(":")[0]))))])],w:[...new Set([...fa.w,...ff.w])]};
  const regRelevant=()=>st.design==="rct"||st.design==="sr";
  const st={design:dkey,answers:migrateAnswers(dkey,init?.answers),notes:migrateAnswers(dkey,init?.notes)};

  // paper text
  const paperBox=el("div",{class:"paper"});
  if(a.abstractParts?.length)for(const p of a.abstractParts){if(p.label)paperBox.append(el("b",{text:p.label}),"\n");paperBox.append(highlight(p.text),"\n\n")}
  else paperBox.append(highlight(a.abstract||"No abstract available."));
  const ftBox=a.fullText?el("details",{},el("summary",{class:"linkbtn",text:"Show full text ("+Math.round(a.fullText.length/1000)+"k characters)"}),el("div",{class:"paper",style:"margin-top:8px"},highlight(a.fullText))):null;

  // design + checklist
  const dsel=el("select",{id:"m-design"},Object.entries(DESIGNS).map(([k,d])=>el("option",{value:k,text:d.name,selected:k===st.design})));
  const lvl=el("select",{id:"m-level"},["1","2","3","4","5"].map(n=>el("option",{value:n,text:n+" — "+LEVELS[n],selected:n===String(init?.level||DESIGNS[st.design].level)})));
  const grade=el("select",{id:"m-grade"},["High","Moderate","Low","Very low"].map(g=>el("option",{value:g,text:g,selected:g===(init?.grade||"Low")})));
  const qbox=el("div",{class:"sec"}),overallBox=el("div",{class:"overall","aria-live":"polite"});
  const hintFor=id=>{const ws=facts.w.join(" ")+" "+facts.f.join(" ");
    return ({mask:/Double-masked/.test(ws)?"Text says double-masked":/Open-label/.test(ws)?"Text says open-label":"",assess:/Double-masked/.test(ws)?"Text says double-masked":"",coi:/industry/.test(ws)?"Possible industry involvement found":"",
      report:/Post hoc/.test(ws)?"Post hoc analysis mentioned":/Registered: (NCT|ISRCTN|EudraCT)/.test(ws)?"Trial registration found":"",outcome:/surrogate/.test(ws)?"Imaging/surrogate outcome mentioned":"",
      protocol:/CRD\d/.test(ws)?"PROSPERO number found":"",select:/Retrospective/.test(ws)?"Retrospective design":"",rand:/randomi[sz]/i.test(text)?"Text mentions randomisation":"",
      effect:/Non-inferiority/.test(ws)?"Non-inferiority design — check the margin":"",consec:/consecutive/i.test(text)?"Text mentions consecutive patients":""})[id]||""};
  const overallSummary=el("div",{class:"overall"});
  function drawOverall(){const o=overallJudgement(st.design,st.answers);
    overallSummary.replaceChildren(el("span",{class:"dot "+o.cls}),el("div",{},el("b",{text:o.label+": "+o.value}),el("div",{class:"note",text:"From your checklist answers."})));
    overallBox.replaceChildren(el("span",{class:"dot "+o.cls}),el("div",{},el("b",{text:o.label+": "+o.value}),
      el("div",{class:"note",text:`${o.answered}/${o.total} answered · ${o.yes} yes · ${o.unc} can't tell · ${o.no} no`+(o.flags.length?" · key flaws: "+o.flags.join(", "):"")})))}
  function drawQs(){
    const d=DESIGNS[st.design];
    qbox.replaceChildren(el("h4",{text:"Checklist — "+d.name}),
      el("p",{class:"note"},"Based on "+d.tool+".",d.qs.some(q=>q[5])?el("span",{}," Items marked ",el("b",{class:"keymark",text:"KEY"})," decide the overall judgement."):null),refLinks(d.refs));
    d.qs.forEach(([id,domain,q,,why,crit])=>{
      const k=st.design+":"+id;
      const mk=(val,cls,label)=>el("button",{type:"button",class:cls,"aria-pressed":String(st.answers[k]===val),onclick:e=>{st.answers[k]=st.answers[k]===val?undefined:val;for(const b of e.currentTarget.parentNode.children)b.setAttribute("aria-pressed",String(b.dataset.v===st.answers[k]));drawOverall()},"data-v":val},label);
      const hint=hintFor(id);
      qbox.append(el("div",{class:"q"},el("small",{},domain,crit?el("b",{class:"keymark",text:"KEY"}):null),el("p",{text:q}),hint?el("div",{class:"hint",text:"Found: "+hint}):null,
        why?el("details",{class:"why"},el("summary",{text:"Why this matters"}),el("p",{text:why})):null,
        el("div",{class:"ynu"},mk("y","y","Yes"),mk("u","u","Can't tell"),mk("n","n","No")),
        el("input",{type:"text",placeholder:"Note (optional)","aria-label":"Note for "+domain,value:st.notes[k]||"",oninput:e=>{st.notes[k]=e.target.value}})));
    });
    qbox.append(overallBox);drawOverall();
  }
  dsel.onchange=()=>{st.design=dsel.value;lvl.value=DESIGNS[st.design].level;drawQs()};
  drawQs();

  // write-up fields
  const ta=(id,ph,val,rows)=>el("textarea",{id,placeholder:ph,rows:rows||3},val||"");
  const fBottom=ta("m-bottom","In one or two sentences: what did it find, and how much should we trust it?",init?.bottomLine);
  const fSummary=ta("m-summary","Short summary (question, design, main result).",init?.summary,4);
  const numsBox=el("div",{class:"sec"});const nums=arr(init?.keyResults).map(r=>({...r}));
  function drawNums(){numsBox.replaceChildren(el("span",{class:"lab",text:"Key numbers"}));
    nums.forEach((r,i)=>numsBox.append(el("div",{class:"numrow"},el("input",{type:"text",placeholder:"What",value:r.label,oninput:e=>r.label=e.target.value}),el("input",{type:"text",placeholder:"Result",value:r.value,oninput:e=>r.value=e.target.value}),el("button",{type:"button","aria-label":"Remove",onclick:()=>{nums.splice(i,1);drawNums()}},"×"))));
    numsBox.append(el("div",{class:"actions"},el("button",{class:"btn ghost",type:"button",onclick:()=>{nums.push({label:"",value:""});drawNums()}},"+ Add a number")));
    const cands=numberSentences(text);
    if(cands.length)numsBox.append(el("span",{class:"note",text:"Tap a result sentence from the paper to add it:"}),el("div",{class:"cand"},cands.map(s=>el("button",{type:"button",onclick:()=>{const m=s.match(/(95%\s*CI.*|[Pp]\s*[<=].*|\b(?:HR|OR|RR|AUC)\b.*)$/);nums.push({label:s.slice(0,m?m.index:s.length).replace(/[,(]\s*$/,"").trim().slice(0,140),value:m?m[0].replace(/[).;]+$/,"").slice(0,80):""});drawNums()}},highlight(s)))));
  }
  drawNums();
  const fAdds=ta("m-adds","What it adds — one point per line",lines(init?.adds?.join("\n")).join("\n"));
  const fLacks=ta("m-lacks","What it lacks — one point per line (tap Fill from checklist)",arr(init?.lacks).join("\n"),4);
  const fPractice=ta("m-practice","How I'd use it in clinic — one point per line",arr(init?.practice).join("\n"));
  const fScript=ta("m-script","What to tell patients, in plain words (tap Draft from my answers)",init?.counselling?.script,5);
  const topic=el("select",{id:"m-topic"},TOPICS.map(t=>el("option",{value:t,text:t,selected:t===(init?.topic||(preset==="uveitis"?"Uveitis":preset==="ird"?"Inherited retinal disease":"Other retina"))})));
  /* the appraisal ends with one explicit decision: does this change what I do? */
  const verdictBox=el("div",{class:"verdicts",role:"radiogroup","aria-label":"Does this change my practice?"},Object.entries(VERDICTS).map(([k,l])=>el("label",{class:"vopt v-"+k},
    el("input",{type:"radio",name:"m-verdict",value:k,checked:k===(init?.verdict||"know")}),el("span",{},el("b",{text:l}),el("small",{text:VERDICT_HELP[k]})))));
  const verdict={get value(){return verdictBox.querySelector("input:checked")?.value||"know"}};
  const fWhy=el("textarea",{id:"m-why",rows:2,placeholder:"Why? e.g. Valid and applicable, but the benefit is on a surrogate only."},init?.verdictWhy||"");

  const fillLacks=()=>{const out=lines(fLacks.value);
    DESIGNS[st.design].qs.forEach(([id,d,q,lack])=>{const a=st.answers[st.design+":"+id],note=st.notes[st.design+":"+id];if(a==="n"||a==="u"){const line=(a==="u"?"Unclear: ":"")+lack+(note?" — "+note:"");if(!out.includes(line))out.push(line)}});
    for(const w of facts.w){if(/registration/.test(w)&&!regRelevant())continue;if(!out.some(x=>x.startsWith(w)))out.push(w)}
    fLacks.value=out.join("\n")};
  const certainty={High:"We can be quite confident in this result.",Moderate:"This is reasonably reliable, but more research could change it.",Low:"This is an early or uncertain finding, so we can't be sure yet.","Very low":"This is very uncertain, so it shouldn't change your treatment on its own."};
  const draftScript=()=>{const d=DESIGNS[st.design];const nTxt=(facts.f.find(x=>x.startsWith("Size:"))||"").replace("Size: ","").split(",")[0];
    fScript.value=`There's a study I can tell you about. It was ${d.plain}${nTxt&&st.design!=="report"&&st.design!=="lab"?", involving about "+nTxt:""}. ${fBottom.value.trim()||"[In plain words: what it found.]"} ${certainty[grade.value]} ${verdict.value==="change"?"Because of this, I'd suggest we consider it for you.":verdict.value==="support"?"It supports the treatment we already recommend.":"For now, it doesn't change what we'd recommend for you."}`.replace(/\s+/g," ").trim()};

  const status=el("div",{class:"status","aria-live":"polite"});
  const save=async()=>{
    const qs=DESIGNS[st.design].qs,ov=overallJudgement(st.design,st.answers);
    if(!fBottom.value.trim()){status.textContent="Write a bottom line first — one or two sentences.";fBottom.focus();return}
    const worst={};qs.forEach(([id,d,q])=>{const k=st.design+":"+id,a=st.answers[k];if(!a)return;const r=a==="n"?"high":a==="u"?"some":"low";const rank={low:0,some:1,high:2};if(!(d in worst)||rank[r]>rank[worst[d].risk])worst[d]={risk:r,note:st.notes[k]||(a==="y"?"Yes":a==="u"?"Can't tell":"No")+" — "+q}});
    const doc={...(existing||{}),
      id:existing?.id||(a.pmid?"pm"+a.pmid:undefined),pmid:a.pmid||existing?.pmid||"",pmc:a.pmc||"",doi:a.doi||"",title:a.title||"Untitled paper",journal:a.journal||"",year:a.year||"",authors:a.authorShort||"",
      topic:topic.value,design:DESIGNS[st.design].name,designKey:st.design,level:lvl.value,levelWhy:`${DESIGNS[st.design].name} (${dwhy}); ${ov.answered}/${qs.length} checklist questions answered.`,tool:DESIGNS[st.design].tool,overall:ov.label+": "+ov.value,grade:grade.value,
      bottomLine:fBottom.value.trim(),summary:fSummary.value.trim(),keyResults:nums.filter(r=>r.label||r.value),
      adds:lines(fAdds.value),lacks:lines(fLacks.value),practice:lines(fPractice.value),
      bias:Object.entries(worst).map(([domain,v])=>({domain,risk:v.risk,note:v.note})),
      counselling:{script:fScript.value.trim(),points:[],ifTheyAsk:[]},
      verdict:verdict.value,verdictWhy:fWhy.value.trim(),
      answers:Object.fromEntries(Object.entries(st.answers).filter(([,v])=>v)),notes:Object.fromEntries(Object.entries(st.notes).filter(([,v])=>v)),engine:"manual",spotted:[...facts.f,...facts.w.filter(w=>!/registration/.test(w)||regRelevant())],source:a.fullText?"full text":"abstract",
      pubTypes:a.pubTypes||[],abstractText:a.abstract||"",abstractParts:a.abstractParts||null,sourceText:text.slice(0,80000),
      addedAt:existing?.addedAt||Date.now(),read:true,starred:!!existing?.starred};
    const id=await savePaper(doc);store.set(draftKey,null);toast("Saved to your library");openPaper(id);
  };
  const saveDraft=()=>{if(view!=="manual")return;store.set(draftKey,{designKey:st.design,answers:st.answers,notes:st.notes,level:lvl.value,grade:grade.value,bottomLine:fBottom.value,summary:fSummary.value,keyResults:nums,adds:lines(fAdds.value),lacks:lines(fLacks.value),practice:lines(fPractice.value),counselling:{script:fScript.value},topic:topic.value,verdict:verdict.value,verdictWhy:fWhy.value})};
  let draftTimer;v.oninput=v.onchange=v.onclick=()=>{clearTimeout(draftTimer);draftTimer=setTimeout(saveDraft,400)};

  v.append(el("button",{class:"back",onclick:()=>existing?openPaper(existing.id):show(lastList)},"← Back"),
    el("article",{class:"sheet"},
      el("div",{class:"row"},el("span",{class:"pill type",text:"Appraise it myself — no AI"})),
      el("h2",{text:a.title||"Untitled paper"}),
      el("div",{class:"cite"},[a.authorShort,a.journal,a.year].filter(Boolean).join(" · ")," ",links({pmid:a.pmid,pmc:a.pmc,doi:a.doi})),
      el("div",{class:"sec"},el("h4",{text:"The paper"}),el("p",{class:"note",text:"Numbers, percentages, confidence intervals and p-values are highlighted."}),paperBox,ftBox),
      el("div",{class:"sec"},el("h4",{text:"Spotted automatically"}),el("div",{class:"found"},facts.f.map(x=>el("span",{text:x})),facts.w.map(x=>el("span",{class:"warnf",text:x}))),el("p",{class:"note",text:"Pattern-matched from the text — check each one."})),
      el("div",{class:"sec"},el("h4",{text:"Study type & evidence level"}),el("div",{class:"field"},el("label",{for:"m-design",text:"Study type (suggested: "+dwhy+")"}),dsel),el("div",{class:"field"},el("label",{for:"m-level",text:"Oxford CEBM level"}),lvl),el("div",{class:"field"},el("label",{for:"m-grade",text:"How certain is the main result? (GRADE)"}),grade),el("p",{class:"note",text:"Move the level down one if the checklist shows serious bias or imprecision."})),
      qbox,
      el("div",{class:"sec"},el("h4",{text:"Your appraisal"}),
        el("div",{class:"field"},el("label",{for:"m-bottom",text:"Bottom line"}),fBottom),
        el("div",{class:"field"},el("label",{for:"m-summary",text:"Summary"}),fSummary),
        numsBox,
        el("div",{class:"field"},el("label",{for:"m-adds",text:"What it adds"}),fAdds),
        el("div",{class:"field"},el("label",{for:"m-lacks",text:"What it lacks"}),fLacks,el("div",{class:"actions",style:"margin-top:6px"},el("button",{class:"btn ghost",type:"button",onclick:fillLacks},"Fill from checklist"))),
        el("div",{class:"field"},el("label",{for:"m-practice",text:"Using it in my practice"}),fPractice),
        el("div",{class:"field"},el("label",{for:"m-script",text:"Counselling patients"}),fScript,el("div",{class:"actions",style:"margin-top:6px"},el("button",{class:"btn ghost",type:"button",onclick:draftScript},"Draft from my answers"))),
        el("div",{class:"field"},el("label",{for:"m-topic",text:"Topic"}),topic)),
      el("div",{class:"sec"},el("h4",{text:"Does this change my practice?"}),
        el("p",{class:"guide",text:"Weigh it up: are the results valid (checklist above), are they important (size and precision of the effect), and do they apply to my patients and service?"}),
        overallSummary,verdictBox,
        el("div",{class:"field"},el("label",{for:"m-why",text:"Why — in one line"}),fWhy)),
      el("div",{class:"actions"},el("button",{class:"btn",type:"button",onclick:save},"Save appraisal")),status));
  show("manual");
}

/* ---------- upload / paste fallback ---------- */
let pdfText="";
async function loadPdfJs(){if(window.pdfjsLib)return;const add=src=>new Promise((res,rej)=>{const s=document.createElement("script");s.src=src;s.onload=res;s.onerror=rej;document.head.append(s)});
  await add("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");await add("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js");
  pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"}
$("#pdf").onchange=async e=>{const f=e.target.files[0];if(!f)return;$("#status").textContent="Reading PDF…";
  try{await loadPdfJs();const doc=await pdfjsLib.getDocument({data:await f.arrayBuffer()}).promise;const out=[];
    for(let i=1;i<=Math.min(doc.numPages,60);i++){const pg=await doc.getPage(i);const tc=await pg.getTextContent();out.push(tc.items.map(t=>t.str).join(" "))}
    pdfText=out.join("\n\n").replace(/[ \t]+/g," ");$("#pdfname").textContent=f.name+" · "+doc.numPages+" pages";
    if(!$("#utitle").value)$("#utitle").value=f.name.replace(/\.pdf$/i,"");
    $("#status").textContent=pdfText.trim().length<400?"This PDF has almost no text (it may be scanned). Use photos with AI appraise.":"PDF ready ("+Math.round(pdfText.length/1000)+"k characters)."}
  catch{pdfText="";$("#status").textContent="Couldn't read that PDF. Try pasting the text."}};
$("#photos").onchange=e=>{const n=e.target.files.length;$("#photoname").textContent=n?n+" photo"+(n>1?"s":"")+" chosen":"AI appraisal only"};
function uploadedArticle(){const body=(pdfText||$("#text").value.trim());return{pmid:"",pmc:"",doi:"",title:$("#utitle").value.trim()||"Uploaded paper",journal:"",year:"",authors:[],authorShort:"",abstract:body.slice(0,3000),abstractParts:null,pubTypes:[],mesh:[],fullText:body.length>3000?body:""}}
$("#newform").onsubmit=async e=>{e.preventDefault();
  const body=(pdfText||$("#text").value.trim()),photos=$("#photos").files;
  if(!body&&!photos.length){$("#status").textContent="Add a PDF, photos, or paste some text first.";return}
  if(!gKey()){$("#status").textContent="AI appraise needs a free Gemini key (Settings). Or tap Appraise myself.";return}
  $("#go").disabled=true;await holdAwake(true);
  try{const id=await aiAppraise({article:null,body,source:pdfText?"full text (PDF)":photos.length?"photos":"pasted text",images:photos.length?[...photos]:null,onProgress:t=>$("#status").textContent=t});
    $("#newform").reset();pdfText="";$("#status").textContent="";toast("Saved to your library");openPaper(id)}
  catch(err){$("#status").textContent=err.message||"Couldn't appraise that."}finally{$("#go").disabled=false;await holdAwake(false)}};
$("#goManual").onclick=()=>{const body=(pdfText||$("#text").value.trim());if(!body){$("#status").textContent="Upload a PDF or paste the text first.";return}openManual(uploadedArticle(),null)};

/* ---------- settings ---------- */
$("#gkey").value=gKey();
async function fillModels(){const sel=$("#gmodel");const cur=store.get("gmodel","");sel.replaceChildren(el("option",{value:"",text:"Automatic (newest free Flash)"}));
  for(const m of arr(modelCache))sel.append(el("option",{value:m,text:m,selected:m===cur}))}
$("#gmodel").onchange=e=>store.set("gmodel",e.target.value);
$("#savekey").onclick=async()=>{const k=$("#gkey").value.trim();if(!k){$("#keystatus").textContent="Paste your key first.";return}
  $("#keystatus").textContent="Testing…";
  try{const ms=await listModels(k);store.set("gkey",k);modelCache=ms;fillModels();$("#keystatus").textContent=ms.length?"Key works. It will use "+ms[0]+".":"Key works, but no Flash model was listed — try again later."}
  catch(e){$("#keystatus").textContent="That key didn't work: "+(e.message||"error")}};
$("#testai").onclick=async()=>{
  const out=$("#teststatus");if(!gKey()){out.textContent="Save a key first.";return}
  out.textContent="Checking the connection to Google…";const t0=Date.now();
  try{await fetch(GAPI+"models?pageSize=1",{headers:{"x-goog-api-key":gKey()},cache:"no-store"})}
  catch(e){out.textContent=await diagnoseNetwork(gKey(),false,e);return}
  out.textContent="Connection fine. Asking Gemini a tiny question…";
  try{const t=await gemini('Reply with only this JSON: {"ok": true, "answer": "the capital of France"}',true);
    const j=parseJSON(t);out.textContent=(j?.ok?"Gemini works":"Gemini answered, but oddly: "+t.slice(0,120))+" — model "+store.get("lastModel","?")+", "+((Date.now()-t0)/1000).toFixed(1)+"s."}
  catch(e){out.textContent="Gemini problem: "+(e.message||e)}};
$("#clearkey").onclick=()=>{store.set("gkey","");store.set("gmodel","");modelCache=null;$("#gkey").value="";fillModels();$("#keystatus").textContent="Key removed from this device."};
$("#export").onclick=()=>{const data=JSON.stringify({app:"retina-appraiser",version:1,exportedAt:new Date().toISOString(),papers},null,1);
  const a=el("a",{href:URL.createObjectURL(new Blob([data],{type:"application/json"})),download:"retina-library-"+new Date().toISOString().slice(0,10)+".json"});document.body.append(a);a.click();a.remove();
  $("#libstatus").textContent="Exported "+papers.length+" papers."};
$("#import").onchange=async e=>{const f=e.target.files[0];if(!f)return;
  try{const j=JSON.parse(await f.text());const list=Array.isArray(j)?j:arr(j.papers);let added=0,updated=0;
    for(const p of list){if(!p||!p.title)continue;p.id=p.id||(p.pmid?"pm"+p.pmid:"u"+Math.random().toString(36).slice(2));const have=papers.find(x=>x.id===p.id);
      if(!have){await dbPut(p);added++}else if((p.addedAt||0)>(have.addedAt||0)){await dbPut({...p,starred:have.starred||p.starred});updated++}}
    await reload();$("#libstatus").textContent=`Imported: ${added} new, ${updated} updated.`}
  catch{$("#libstatus").textContent="That file isn't a Retina Appraiser library."}finally{e.target.value=""}};

/* ---------- coming back after a reload ---------- */
function restoreState(){
  const s=store.get("state",null);
  if(!s||Date.now()-(s.at||0)>7*864e5){show("find");runSearch();return}
  restoring=true;
  $("#fq").value=s.fq||"";preset=s.preset??"retina";
  if(s.ftype!=null)$("#ftype").value=s.ftype;if(s.fdate!=null)$("#fdate").value=s.fdate;if(s.fsort)$("#fsort").value=s.fsort;
  $("#fjournals").checked=s.fjournals!==false;$("#q").value=s.q||"";$("#topic").value=s.topic||"";vfilter=s.vfilter||"";
  markPresets();renderChips();
  restoring=false;
  lastList=s.lastList||"find";
  if(lastList==="find"||s.view==="find")runSearch();else searched=false;
  if(s.view==="detail"&&papers.some(p=>p.id===s.openId))openPaper(s.openId);
  else if(s.view==="manual"&&s.manual)startManual(s.manual);
  else if(["find","library","uveitis","starred","settings"].includes(s.view))show(s.view);
  else show("find");
}
function renderPending(){
  const box=$("#pending");box.replaceChildren();
  const p=pendingAll(),now=Date.now();
  for(const[pmid,{a,at}]of Object.entries(p)){
    if(now-at>6*3600e3||busy[pmid]||papers.some(x=>String(x.pmid)===String(pmid))){setPending({pmid},false);continue}
    box.append(el("div",{class:"banner",role:"status"},
      el("div",{},"Interrupted before it finished (the screen went off or the app was closed): ",el("b",{text:a.title||"PMID "+pmid})),
      el("div",{class:"actions"},
        el("button",{class:"btn",type:"button",onclick:()=>{queueAI(a);renderPending()}},"Resume AI appraisal"),
        el("button",{class:"btn ghost",type:"button",onclick:()=>{setPending({pmid},false);renderPending()}},"Dismiss"))));
  }
}

/* ---------- boot ---------- */
(async()=>{
  try{idb=await openDB()}catch{toast("This browser blocked local storage, so the library can't be saved.")}
  if(idb){
    await reload();
    if(!papers.length&&!store.get("seeded",false)){
      try{const seeds=await (await fetch("seeds.json")).json();let t=Date.now();for(const s of seeds){await dbPut({...s,id:s.id||"pm"+s.pmid,addedAt:s.addedAt||t--,read:false,starred:false})}store.set("seeded",true);await reload()}catch{}
    }
  }
  renderList();
  if(gKey())modelOrder().then(fillModels).catch(()=>{});
  restoreState();
  renderPending();
  if("serviceWorker" in navigator&&location.protocol==="https:")navigator.serviceWorker.register("sw.js").catch(()=>{});
})();
