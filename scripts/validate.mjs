import fs from "node:fs";
import path from "node:path";
const root=process.cwd();
const read=(name)=>fs.readFileSync(path.join(root,name),"utf8");
const fail=(m)=>{console.error("FAIL:",m);process.exitCode=1;};
const pass=(m)=>console.log("OK:",m);
const html=read("index.html"),app=read("app.js"),css=read("styles.css");
const ids=[...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]);
const duplicates=ids.filter((id,i)=>ids.indexOf(id)!==i);
if(duplicates.length)fail("Duplicate HTML ids: "+[...new Set(duplicates)].join(", "));else pass("HTML ids are unique");
const idSet=new Set(ids);
const missingIds=[...new Set([...app.matchAll(/\bel\(["']([^"']+)["']\)/g)].map(m=>m[1]))].filter(id=>!idSet.has(id));
if(missingIds.length)fail("JS references missing DOM ids: "+missingIds.join(", "));else pass("Every el(id) reference exists in index.html");
const refs=[...[...html.matchAll(/(?:src|href)=["']\.\/([^"']+)["']/g)].map(m=>m[1]),...[...app.matchAll(/["'](\.\/assets\/[^"'$]+)["']/g)].map(m=>m[1].slice(2))];
const generatedPrefixes=["assets/game-art/pilots/pilot-","assets/game-art/planets/pixel/planet-pixel-","assets/game-art/planets/realistic/planet-real-"];
const missing=[...new Set(refs)].filter(file=>!generatedPrefixes.some(prefix=>file===prefix)&&!fs.existsSync(path.join(root,file)));
if(missing.length)fail("Missing asset references: "+missing.join(", "));else pass("All literal HTML/JS asset references exist");
const counts={"assets/game-art/ships":9,"assets/game-art/pilots":8,"assets/game-art/planets/pixel":8,"assets/game-art/planets/realistic":8,"assets/game-art/resources":14,"assets/game-art/modules":8,"assets/game-art/objects":13};
let all=true;
for(const [dir,n] of Object.entries(counts)){const actual=fs.readdirSync(path.join(root,dir)).filter(f=>f.endsWith(".webp")).length;if(actual!==n){all=false;fail(dir+": expected "+n+", found "+actual);}}
if(all)pass("All 68 WebP sprites are present");
if(!app.includes("function renderGallery()")||!app.includes("planet-pixel-")||!app.includes("pilot-"))fail("Sprite archive missing");else pass("Sprite archive renderer exists");
if(/\b(animation|transition)\s*:/i.test(css)||/@keyframes\b/i.test(css))fail("Motion found in static v1 CSS");else pass("No CSS animations or transitions");
if(!app.includes('gallery:{title:"Архив спрайтов"'))fail("Gallery route missing");else pass("Gallery route exists");

// CSS structure: a stray "}" silently drops the next rule in the browser.
{
  const stripped=css.replace(/\/\*[\s\S]*?\*\//g,"");
  let depth=0,broken=false;
  for(const ch of stripped){
    if(ch==="{")depth++;
    else if(ch==="}"){depth--;if(depth<0){broken=true;break;}}
  }
  if(broken||depth!==0)fail("styles.css has unbalanced braces");else pass("styles.css braces are balanced");
  if(/^\s*\d+%\s*\{/m.test(stripped))fail("styles.css has orphan keyframe steps (leftover from a removed animation)");else pass("No orphan keyframe steps in styles.css");
}

// Every RPC the client calls must exist in a migration.
{
  const dir=path.join(root,"supabase/migrations");
  const sql=fs.readdirSync(dir).filter(f=>f.endsWith(".sql")).map(f=>fs.readFileSync(path.join(dir,f),"utf8")).join("\n");
  const rpcs=[...new Set([...app.matchAll(/rpc\(["']([a-z_]+)["']/g)].map(m=>m[1]))];
  const absent=rpcs.filter(n=>!new RegExp("function\\s+public\\."+n+"\\b").test(sql));
  if(absent.length)fail("RPC called by app.js but missing in migrations: "+absent.join(", "));else pass("All RPCs used by app.js exist in migrations ("+rpcs.join(", ")+")");
}
console.log("Crypto Astra validation finished.");
