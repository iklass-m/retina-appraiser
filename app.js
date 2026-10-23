"use strict";
/* Retina Appraiser — standalone. PubMed (NCBI E-utilities) + Europe PMC full text + optional Gemini.
   No server: everything runs in the browser; the library lives in IndexedDB on this device. */

const TOPICS=["nAMD","GA / dry AMD","DMO","Diabetic retinopathy","RVO","Inherited retinal disease","Uveitis","Imaging & AI","Systemic drugs & the eye","Other retina"];
const VERDICTS={change:"Changes practice",support:"Supports current practice",know:"Worth knowing",notready:"Not ready yet",low:"Low value"};
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
function links(p){const out=[];
  if(p.pmid)out.push(el("a",{href:"https://pubmed.ncbi.nlm.nih.gov/"+encodeURIComponent(p.pmid)+"/",target:"_blank",rel:"noopener",text:"PubMed"}));
  if(p.pmc)out.push(el("a",{href:"https://pmc.ncbi.nlm.nih.gov/articles/"+encodeURIComponent(p.pmc)+"/",target:"_blank",rel:"noopener",text:"Free full text"}));
  if(p.doi)out.push(el("a",{href:"https://doi.org/"+p.doi,target:"_blank",rel:"noopener",text:"Journal"}));
  const s=el("span");out.forEach((a,i)=>{if(i)s.append(" · ");s.append(a)});return s}
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
      arr(p.bias).length?sec("Risk of bias",el("div",{class:"bias"},arr(p.bias).map(b=>el("div",{},el("span",{class:"dot "+(b.risk||"some"),title:b.risk}),el("span",{},el("b",{text:b.domain+": "}),b.note||""))))):null,
      sec("Using it in my practice",ul(p.practice)),
      sec("Counselling patients",el("div",{class:"say"},el("div",{class:"note",text:"In plain words you could say:"}),bq,el("div",{class:"actions"},copyBtn)),
        arr(c.points).length?ul(c.points):null,
        arr(c.ifTheyAsk).length?el("div",{class:"qa"},el("div",{class:"note",text:"If they ask…"}),arr(c.ifTheyAsk).map(x=>el("details",{},el("summary",{text:x.q}),el("p",{text:x.a})))):null),
      p.verdictWhy||p.verdict?sec("Verdict",el("p",{},el("b",{text:(VERDICTS[p.verdict]||"")+". "}),p.verdictWhy||"")):null,
      askBox(p),
      el("div",{class:"actions"},
        el("button",{class:"btn ghost",type:"button",onclick:()=>{patch(id,{read:false});toast("Marked unread")}},"Mark unread"),
        p.pmid?el("a",{class:"btn ghost",href:CLAUDE_APP+"#pm"+p.pmid,target:"_blank",rel:"noopener"},"Appraise with Claude ↗"):null,
        el("button",{class:"btn ghost",type:"button",onclick:()=>openManual(paperAsArticle(p),p)},p.engine==="manual"?"Edit my appraisal":"Appraise it myself"),
        delBtn),
      el("p",{class:"note",text:"Appraised by "+(ENGINE[p.engine]||"Claude")+" from the "+(p.source||"text")+" on "+(p.addedAt?new Date(p.addedAt).toLocaleDateString("en-GB"):"—")+(p.engine==="manual"?".":". Check key numbers against the paper before quoting.")})));
  show("detail");
}
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
      abs,el("button",{class:"linkbtn",type:"button",onclick:e=>{abs.classList.toggle("open");e.target.textContent=abs.classList.contains("open")?"Less":"Read abstract"}},"Read abstract"),act,
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
- Papers can be ANY design: RCT, meta-analysis, cohort, registry/real-world, case-control, cross-sectional, diagnostic accuracy, imaging/AI, economic model, case series, case report, lab/animal. Appraise each with the right checklist for its design (CASP RCT/cohort/diagnostic/case-control, AMSTAR-2, QUADAS-2, CHEERS, JBI case report/series).
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
"verdict":"change|support|know|notready|low","verdictWhy":""}`;

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
const DESIGNS={
  sr:{name:"Systematic review / meta-analysis",level:"1",plain:"a review that pooled the results of several studies",qs:[
    ["Question","Did it ask a clearly focused question (population, intervention, comparison, outcome)?","No clearly focused question"],
    ["Search","Was the search thorough (several databases, trial registries, no language limits)?","Search may have missed studies"],
    ["Study selection","Did it include the right kind of studies for the question (ideally RCTs for treatment)?","Mixes study designs or includes weak designs"],
    ["Risk of bias","Did it assess the quality of the included studies with a recognised tool?","Quality of included studies not properly assessed"],
    ["Heterogeneity","Was it reasonable to combine the studies (similar patients and outcomes, I² not high)?","High heterogeneity — pooling questionable"],
    ["Precision","Are the pooled results precise (narrow confidence intervals)?","Imprecise pooled estimate"],
    ["Publication bias","Did it check for publication bias (funnel plot, Egger)?","Publication bias not assessed"],
    ["Protocol","Was a protocol registered beforehand (e.g. PROSPERO)?","No registered protocol"],
    ["Applicability","Do the results apply to my NHS patients?","Limited applicability to UK NHS patients"]]},
  rct:{name:"Randomised controlled trial",level:"2",plain:"a fair test where people were put into groups by chance",qs:[
    ["Question","Did it address a clearly focused question?","Unfocused question"],
    ["Randomisation","Were patients truly randomly assigned?","Assignment not truly random"],
    ["Allocation concealment","Was allocation concealed from those recruiting?","Allocation concealment unclear"],
    ["Masking","Were patients, clinicians and outcome assessors masked?","Not masked (open-label or unclear)"],
    ["Baseline","Were the groups similar at the start?","Groups differed at baseline"],
    ["Attrition","Were all participants accounted for, with low loss to follow-up and intention-to-treat analysis?","Losses to follow-up / not intention-to-treat"],
    ["Outcome","Was the primary outcome prespecified and meaningful to patients (not just a surrogate or post hoc)?","Surrogate, post hoc or switched outcome"],
    ["Precision","Is the effect clinically worthwhile and precise (narrow confidence interval)?","Effect small or imprecise"],
    ["Harms","Were side effects reported properly?","Harms poorly reported"],
    ["Conflicts","Was it free of major industry influence on design and analysis?","Industry-funded / sponsor involvement"],
    ["Applicability","Do the results apply to my NHS patients and services?","Limited applicability to UK NHS patients"]]},
  cohort:{name:"Cohort / real-world study",level:"3",plain:"a study that followed groups of patients over time",qs:[
    ["Question","Did it address a clearly focused question?","Unfocused question"],
    ["Selection","Was the cohort recruited in an acceptable, representative way (consecutive, defined)?","Selection bias likely"],
    ["Exposure","Was the treatment/exposure measured accurately?","Exposure poorly measured"],
    ["Outcome","Was the outcome measured accurately and, ideally, by someone masked?","Outcome measurement unreliable"],
    ["Confounding","Were important confounders identified and adjusted for?","Confounding not adequately handled"],
    ["Follow-up","Was follow-up complete and long enough?","Incomplete or short follow-up"],
    ["Precision","Are the results precise (narrow confidence intervals)?","Imprecise results"],
    ["Plausibility","Is the effect believable (size, dose-response, fits other evidence)?","Effect may not be believable"],
    ["Applicability","Do the results apply to my NHS patients?","Limited applicability to UK NHS patients"]]},
  casecontrol:{name:"Case-control study",level:"4",plain:"a study comparing people with and without a condition",qs:[
    ["Question","Did it address a clearly focused question?","Unfocused question"],
    ["Cases","Were cases recruited in an acceptable, well-defined way?","Case selection questionable"],
    ["Controls","Were controls selected in an acceptable way (same source population)?","Control selection questionable"],
    ["Exposure","Was exposure measured the same way in cases and controls?","Exposure measured differently (recall/measurement bias)"],
    ["Confounding","Were confounders accounted for?","Confounding not handled"],
    ["Precision","Are the results precise?","Imprecise results"],
    ["Applicability","Do the results apply to my patients?","Limited applicability"]]},
  cross:{name:"Cross-sectional study / survey",level:"4",plain:"a snapshot survey of a group of people at one time",qs:[
    ["Question","Did it address a clearly focused question?","Unfocused question"],
    ["Sample","Was the sample representative of the population of interest?","Unrepresentative sample"],
    ["Response","Was the response rate adequate?","Low or unreported response rate"],
    ["Measurement","Were measurements valid and reliable?","Measurement validity uncertain"],
    ["Confounding","Were confounders considered?","Confounding not handled"],
    ["Precision","Are the results precise?","Imprecise results"],
    ["Applicability","Do the results apply to my patients?","Limited applicability"]]},
  diag:{name:"Diagnostic accuracy / imaging / AI",level:"2",plain:"a study testing how well a test or scan picks up a condition",qs:[
    ["Question","Was there a clear question about a specific test in a specific population?","Unfocused question"],
    ["Reference standard","Was the test compared with an appropriate reference standard?","Reference standard inadequate"],
    ["Spectrum","Were patients like those in my clinic, recruited consecutively (not just clear-cut cases)?","Spectrum bias — selected or case-control sample"],
    ["Verification","Did everyone get the reference standard, whatever the test result?","Partial or differential verification"],
    ["Masking","Were the test and reference standard read independently and masked?","Readers not masked"],
    ["Reproducibility","Is the test described well enough to repeat it?","Test poorly described"],
    ["Precision","Are sensitivity and specificity reported with confidence intervals?","Accuracy estimates imprecise or incomplete"],
    ["External validation","For AI/algorithms: was it validated on an external dataset?","No external validation"],
    ["Applicability","Is the test available and useful in my service?","Limited availability or usefulness in the NHS"]]},
  series:{name:"Case series",level:"4",plain:"a report of a group of patients treated in one way, without a comparison group",qs:[
    ["Question","Was there a clear aim?","Unclear aim"],
    ["Consecutive","Were cases consecutive and complete?","Cases may be selected"],
    ["Inclusion","Were inclusion criteria clear?","Inclusion criteria unclear"],
    ["Outcomes","Were outcomes measured and reported clearly?","Outcomes poorly reported"],
    ["Follow-up","Was follow-up long and complete enough?","Short or incomplete follow-up"],
    ["Comparison","Is there any comparison (natural history, historical controls) to judge the effect?","No comparison group"],
    ["Applicability","Do the results apply to my patients?","Limited applicability"]]},
  report:{name:"Case report",level:"5",plain:"a description of one patient's case",qs:[
    ["Description","Were the patient's history and findings described clearly?","Patient poorly described"],
    ["Timeline","Is the timeline clear?","Timeline unclear"],
    ["Work-up","Was the diagnostic work-up adequate?","Work-up incomplete"],
    ["Treatment","Was the treatment described clearly?","Treatment unclear"],
    ["Outcome","Were the outcome and follow-up reported?","Outcome/follow-up unclear"],
    ["Alternatives","Were alternative explanations considered?","Alternative explanations not considered"],
    ["Lesson","Is there a useful take-home lesson?","Limited take-home value"]]},
  econ:{name:"Economic evaluation / model",level:"5",plain:"a calculation of whether a treatment is good value for money",qs:[
    ["Question","Was the question and perspective (payer, NHS, society) clear?","Perspective unclear"],
    ["Alternatives","Were sensible alternatives compared?","Comparators incomplete"],
    ["Effectiveness","Is the effectiveness evidence behind it robust (good RCTs)?","Rests on weak or single-study evidence"],
    ["Costs & outcomes","Were costs and outcomes (QALYs) valued credibly?","Costs or utilities questionable"],
    ["Sensitivity","Were uncertainty and sensitivity analyses done?","Uncertainty poorly explored"],
    ["Applicability","Does it apply to the NHS (UK costs, NICE £20–30k/QALY)?","Not applicable to NHS costs/thresholds"]]},
  lab:{name:"Lab / animal / genetic discovery",level:"5",plain:"laboratory research, not yet tested in patients",qs:[
    ["Question","Is the question clinically relevant?","Clinical relevance unclear"],
    ["Model","Is the model (cells, animals, cohort) appropriate?","Model may not reflect human disease"],
    ["Controls","Were appropriate controls used?","Controls inadequate"],
    ["Rigour","Were experiments masked/replicated?","Not replicated or masked"],
    ["Translation","Is there a credible path to patients?","Long way from clinical use"]]}
};
function detectDesign(a,text){
  const title=(a.title||"").toLowerCase(),t=(a.pubTypes||[]).join(" "),x=(title+" "+text).toLowerCase(),mesh=(a.mesh||[]).join(" ");
  if(/Meta-Analysis|Systematic Review/.test(t)||/meta-analysis|systematic review/.test(title))return["sr","publication type says systematic review / meta-analysis"];
  if(/Case Reports/.test(t))return["report","publication type says case report"];
  if(/cost-effectiveness|markov|qaly|cost per/.test(x))return["econ","mentions cost-effectiveness / QALYs"];
  if(/Randomized Controlled Trial/.test(t)||/randomi[sz]ed (controlled |clinical )?trial|randomly assigned/.test(x))return["rct","publication type or text says randomised trial"];
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
  return [...new Set(text.split(/(?<=[.;])\s+/).filter(s=>/95%\s*CI|confidence interval|[Pp]\s*[<=]\s*\.?\d|\b(HR|OR|RR|AUC)\b\s*[=:,]?\s*\d|\d+(\.\d+)?%/.test(s)&&s.length<320).map(s=>s.trim()))].slice(0,14);
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
  const st={design:dkey,answers:init?.answers?{...init.answers}:{},notes:init?.notes?{...init.notes}:{}};

  // paper text
  const paperBox=el("div",{class:"paper"});
  if(a.abstractParts?.length)for(const p of a.abstractParts){if(p.label)paperBox.append(el("b",{text:p.label}),"\n");paperBox.append(highlight(p.text),"\n\n")}
  else paperBox.append(highlight(a.abstract||"No abstract available."));
  const ftBox=a.fullText?el("details",{},el("summary",{class:"linkbtn",text:"Show full text ("+Math.round(a.fullText.length/1000)+"k characters)"}),el("div",{class:"paper",style:"margin-top:8px"},highlight(a.fullText))):null;

  // design + checklist
  const dsel=el("select",{id:"m-design"},Object.entries(DESIGNS).map(([k,d])=>el("option",{value:k,text:d.name,selected:k===st.design})));
  const lvl=el("select",{id:"m-level"},["1","2","3","4","5"].map(n=>el("option",{value:n,text:n+" — "+LEVELS[n],selected:n===String(init?.level||DESIGNS[st.design].level)})));
  const grade=el("select",{id:"m-grade"},["High","Moderate","Low","Very low"].map(g=>el("option",{value:g,text:g,selected:g===(init?.grade||"Low")})));
  const qbox=el("div",{class:"sec"});
  const hintFor=domain=>{const ws=facts.w.join(" ")+" "+facts.f.join(" ");
    return ({Masking:/Double-masked/.test(ws)?"Text says double-masked":/Open-label/.test(ws)?"Text says open-label":"",Conflicts:/industry/.test(ws)?"Possible industry involvement found":"",Outcome:/Post hoc/.test(ws)?"Post hoc analysis mentioned":/surrogate/.test(ws)?"Imaging/surrogate outcome mentioned":"",Protocol:/CRD\d/.test(ws)?"PROSPERO number found":"",Selection:/Retrospective/.test(ws)?"Retrospective design":"",Randomisation:/randomi[sz]/i.test(text)?"Text mentions randomisation":""})[domain]||""};
  function drawQs(){
    qbox.replaceChildren(el("h4",{text:"Checklist — "+DESIGNS[st.design].name}));
    DESIGNS[st.design].qs.forEach(([domain,q],i)=>{
      const k=st.design+":"+i;
      const mk=(val,cls,label)=>el("button",{type:"button",class:cls,"aria-pressed":String(st.answers[k]===val),onclick:()=>{st.answers[k]=st.answers[k]===val?undefined:val;drawQs()}},label);
      const hint=hintFor(domain);
      qbox.append(el("div",{class:"q"},el("p",{text:q}),el("small",{text:domain}),hint?el("div",{class:"hint",text:"Found: "+hint}):null,
        el("div",{class:"ynu"},mk("y","y","Yes"),mk("u","u","Can't tell"),mk("n","n","No")),
        el("input",{type:"text",placeholder:"Note (optional)",value:st.notes[k]||"",oninput:e=>{st.notes[k]=e.target.value}})));
    });
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
  const verdict=el("select",{id:"m-verdict"},Object.entries(VERDICTS).map(([k,l])=>el("option",{value:k,text:l,selected:k===(init?.verdict||"know")})));
  const fWhy=el("input",{type:"text",id:"m-why",placeholder:"Why? (one line)",value:init?.verdictWhy||""});

  const fillLacks=()=>{const out=lines(fLacks.value);
    DESIGNS[st.design].qs.forEach(([d,q,lack],i)=>{const a=st.answers[st.design+":"+i],note=st.notes[st.design+":"+i];if(a==="n"||a==="u"){const line=(a==="u"?"Unclear: ":"")+lack+(note?" — "+note:"");if(!out.includes(line))out.push(line)}});
    for(const w of facts.w){if(/registration/.test(w)&&!regRelevant())continue;if(!out.some(x=>x.startsWith(w)))out.push(w)}
    fLacks.value=out.join("\n")};
  const certainty={High:"We can be quite confident in this result.",Moderate:"This is reasonably reliable, but more research could change it.",Low:"This is an early or uncertain finding, so we can't be sure yet.","Very low":"This is very uncertain, so it shouldn't change your treatment on its own."};
  const draftScript=()=>{const d=DESIGNS[st.design];const nTxt=(facts.f.find(x=>x.startsWith("Size:"))||"").replace("Size: ","").split(",")[0];
    fScript.value=`There's a study I can tell you about. It was ${d.plain}${nTxt&&st.design!=="report"&&st.design!=="lab"?", involving about "+nTxt:""}. ${fBottom.value.trim()||"[In plain words: what it found.]"} ${certainty[grade.value]} ${verdict.value==="change"?"Because of this, I'd suggest we consider it for you.":verdict.value==="support"?"It supports the treatment we already recommend.":"For now, it doesn't change what we'd recommend for you."}`.replace(/\s+/g," ").trim()};

  const status=el("div",{class:"status","aria-live":"polite"});
  const save=async()=>{
    const qs=DESIGNS[st.design].qs;const answered=qs.filter((_,i)=>st.answers[st.design+":"+i]).length;
    if(!fBottom.value.trim()){status.textContent="Write a bottom line first — one or two sentences.";fBottom.focus();return}
    const worst={};qs.forEach(([d],i)=>{const a=st.answers[st.design+":"+i];if(!a)return;const r=a==="n"?"high":a==="u"?"some":"low";const rank={low:0,some:1,high:2};if(!(d in worst)||rank[r]>rank[worst[d].risk])worst[d]={risk:r,note:st.notes[st.design+":"+i]||(a==="y"?"Yes":a==="u"?"Can't tell":"No")+" — "+qs[i][1]}});
    const doc={...(existing||{}),
      id:existing?.id||(a.pmid?"pm"+a.pmid:undefined),pmid:a.pmid||existing?.pmid||"",pmc:a.pmc||"",doi:a.doi||"",title:a.title||"Untitled paper",journal:a.journal||"",year:a.year||"",authors:a.authorShort||"",
      topic:topic.value,design:DESIGNS[st.design].name,designKey:st.design,level:lvl.value,levelWhy:`${DESIGNS[st.design].name} (${dwhy}); ${answered}/${qs.length} checklist questions answered.`,grade:grade.value,
      bottomLine:fBottom.value.trim(),summary:fSummary.value.trim(),keyResults:nums.filter(r=>r.label||r.value),
      adds:lines(fAdds.value),lacks:lines(fLacks.value),practice:lines(fPractice.value),
      bias:Object.entries(worst).map(([domain,v])=>({domain,risk:v.risk,note:v.note})),
      counselling:{script:fScript.value.trim(),points:[],ifTheyAsk:[]},
      verdict:verdict.value,verdictWhy:fWhy.value.trim(),
      answers:st.answers,notes:st.notes,engine:"manual",source:a.fullText?"full text":"abstract",
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
        el("div",{class:"twocol"},el("div",{class:"field"},el("label",{for:"m-topic",text:"Topic"}),topic),el("div",{class:"field"},el("label",{for:"m-verdict",text:"Verdict"}),verdict)),
        el("div",{class:"field"},el("label",{for:"m-why",text:"Verdict reason"}),fWhy)),
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
