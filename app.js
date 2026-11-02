const state = {
  coins:500,fuel:3,xp:0,level:1,owned:["scout"],page:"spaceport",
  inventory:{"iron_ore":0,"copper":0,"blue_crystal":0,"amethyst":0,"quantum_stone":0,"stellar_core":0},
  authenticated:false,userId:null,profileName:"Космический пилот",playerRockets:[],expeditions:[]
};
const rockets=[
 {id:"scout",name:"Scout",icon:"🚀",time:"30 минут",minutes:30,cargo:10,price:0,description:"Стартовая ракета для первых коротких экспедиций."},
 {id:"miner",name:"Miner",icon:"🛰️",time:"2 часа",minutes:120,cargo:50,price:1500,description:"Добывающий корабль с увеличенным грузовым отсеком."},
 {id:"explorer",name:"Explorer",icon:"🌠",time:"4 часа",minutes:240,cargo:120,price:4500,description:"Исследовательский корабль для дальних маршрутов."},
 {id:"titan",name:"Titan",icon:"🛸",time:"8 часов",minutes:480,cargo:300,price:12000,description:"Тяжёлая ракета для крупных экспедиций."},
 {id:"galaxy",name:"Galaxy",icon:"🚀",time:"12 часов",minutes:720,cargo:600,price:30000,description:"Флагман стартовой линейки Crypto Astra."}
];
const resources=[
 ["iron_ore","Iron Ore","⛰️"],["copper","Copper","🟠"],["blue_crystal","Blue Crystal","💎"],
 ["amethyst","Amethyst","🔮"],["quantum_stone","Quantum Stone","🪨"],["stellar_core","Stellar Core","🌟"]
];
const pageInfo={
 spaceport:["Космопорт","Твоя база. Подготовь ракету и отправляйся исследовать космос."],
 rockets:["Флот ракет","Покупай корабли и увеличивай грузоподъёмность."],
 expeditions:["Экспедиции","Выбирай ракету и отправляйся за космическими ресурсами."],
 inventory:["Склад","Все найденные материалы и предметы."],
 market:["Рынок и мастерская","Обменивай ресурсы и готовь флот к новым полётам."],
 pool:["Astra Pool","Информация о фонде реальных наград."],
 profile:["Профиль","Твой пилот, прогресс и настройки аккаунта."],
 more:["Другие разделы","Миссии, рынок, Astra Pool и профиль."]
};
function el(id){return document.getElementById(id)}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]))}
function idempotencyKey(prefix){return prefix+":"+Date.now().toString(36)+":"+Math.random().toString(36).slice(2,12)}
function openAuth(){el("auth-message").textContent="";el("auth-dialog").showModal()}
function updateHeader(){
 el("coin-balance").textContent=state.coins.toLocaleString("ru-RU");
 el("fuel-balance").textContent=state.fuel;
 el("xp-balance").textContent=state.xp+" XP";
 el("player-level").textContent=state.level;
 el("xp-progress-label").textContent=state.xp+" / 100 XP";
 el("xp-progress").style.width=Math.min(100,state.xp%100)+"%";
 const notice=document.querySelector(".notice-panel");
 if(notice){
  notice.querySelector("b").textContent=state.authenticated?"Аккаунт подключён":"Тестовая версия";
  notice.querySelector("p").textContent=state.authenticated?"Игровой прогресс хранится в Supabase. Балансы и экспедиции проверяются базой данных.":"Без входа доступен только предварительный просмотр. Игровые действия требуют аккаунта.";
 }
 const shortcut=el("profile-shortcut");
 if(shortcut)shortcut.title=state.authenticated?"Открыть профиль":"Войти в аккаунт";
}
function panel(title,body){return '<section class="panel"><div class="panel-heading">'+title+'</div>'+body+'</section>'}
function ownedRocketIds(){return new Set(state.playerRockets.map(r=>r.rocket_id))}
function rocketCards(){
 const owned=ownedRocketIds();
 return '<div class="item-grid">'+rockets.map(r=>{
  const has=state.authenticated?owned.has(r.id):r.id==="scout";
  const action=has?"select":(state.authenticated?"buy":"login");
  const label=has?"В ангаре":(state.authenticated?"Купить":"Войти");
  return '<article class="item-card"><div class="item-visual">'+r.icon+'</div><h3>'+r.name+'</h3><p>'+r.description+'</p><div class="item-meta"><span>Груз: '+r.cargo+'</span><b>'+(r.price===0?"БЕСПЛАТНО":r.price.toLocaleString("ru-RU")+" ASTRA")+'</b></div><button class="'+(has?"secondary-button":"primary-button")+'" data-action="'+action+'" data-name="'+r.id+'">'+label+'</button></article>';
 }).join("")+'</div>';
}
function renderExpeditions(){
 if(!state.authenticated)return panel("ЭКСПЕДИЦИИ",'<div class="empty-state">Войди в аккаунт, чтобы запускать настоящие серверные экспедиции и сохранять прогресс.</div><button class="primary-button" data-action="login">Войти</button>');
 const active=state.expeditions.filter(e=>e.status==="in_progress");
 const owned=state.playerRockets;
 const activeHtml=active.length?panel("ТЕКУЩИЕ ПОЛЁТЫ",active.map(e=>{
  const due=new Date(e.ends_at)<=new Date();
  return '<div class="list-row"><div class="list-left"><span class="list-icon">🚀</span><div><b>Экспедиция</b><small>'+ (due?"Готова к завершению":"Завершение: "+new Date(e.ends_at).toLocaleString("ru-RU"))+'</small></div></div><button class="'+(due?"primary-button":"secondary-button")+'" data-action="complete" data-id="'+e.id+'" '+(due?"":"disabled")+'>'+(due?"Забрать":"В полёте")+'</button></div>';
 }).join("")):"";
 const launchHtml=panel("ДОСТУПНЫЕ РАКЕТЫ",owned.length?'<div class="item-grid">'+owned.map(pr=>{
  const r=rockets.find(x=>x.id===pr.rocket_id);if(!r)return "";
  const busy=active.some(e=>e.player_rocket_id===pr.id);
  return '<article class="item-card"><div class="item-visual">'+r.icon+'</div><h3>'+r.name+'</h3><p>Длительность: '+r.time+'<br>Вместимость: '+r.cargo+'</p><button class="primary-button" data-action="launch" data-id="'+pr.id+'" '+(busy||state.fuel<1?"disabled":"")+'>'+(busy?"Уже в полёте":"Запустить экспедицию")+'</button></article>';
 }).join("")+'</div>':'<div class="empty-state">В ангаре пока нет ракет.</div>');
 return activeHtml+launchHtml;
}
function render(){
 const [title,subtitle]=pageInfo[state.page]||pageInfo.spaceport;
 el("page-title").textContent=title;el("page-subtitle").textContent=subtitle;
 document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===state.page));
 let html="";
 if(state.page==="spaceport"){
  html='<section class="panel hero-panel"><div class="hero-copy"><p class="eyebrow">СЕКТОР 01 · СТАРТОВАЯ СИСТЕМА</p><h2>Галактика ждёт<br>своего исследователя</h2><p>Подготовь Scout, проверь запасы топлива и отправляйся в первую экспедицию.</p><button class="primary-button" data-go="expeditions">Начать экспедицию →</button></div><div class="hero-planet" aria-label="Планета"></div></section>'+
  '<div><h2 class="section-title">Быстрый доступ</h2><div class="quick-grid"><button class="quick-card" data-go="rockets"><span class="quick-icon">🚀</span><b>Мой флот</b><small>Управление ракетами</small></button><button class="quick-card" data-go="inventory"><span class="quick-icon">▦</span><b>Склад</b><small>Космические ресурсы</small></button><button class="quick-card" data-go="market"><span class="quick-icon">⚒️</span><b>Мастерская</b><small>Развитие флота</small></button></div></div>'+
  panel("ПОСЛЕДНИЕ СОБЫТИЯ",'<div class="list-row"><div class="list-left"><span class="list-icon">🧑‍🚀</span><div><b>'+(state.authenticated?"С возвращением, "+escapeHtml(state.profileName):"Добро пожаловать в Crypto Astra")+'</b><small>'+(state.authenticated?"Твой прогресс сохранён в аккаунте.":"Войди, чтобы сохранить прогресс на сервере.")+'</small></div></div><span class="status-dot">'+(state.authenticated?"ONLINE":"DEMO")+'</span></div>');
 }else if(state.page==="rockets"){
  html=panel("АНГАР · "+(state.authenticated?state.playerRockets.length:1)+" / 5 РАКЕТ",rocketCards());
 }else if(state.page==="expeditions"){
  html=renderExpeditions();
 }else if(state.page==="inventory"){
  html=panel("КОСМИЧЕСКИЕ МАТЕРИАЛЫ",'<div>'+resources.map(([id,name,icon])=>'<div class="list-row"><div class="list-left"><span class="list-icon">'+icon+'</span><div><b>'+name+'</b><small>Космический ресурс</small></div></div><strong>'+state.inventory[id]+'</strong></div>').join("")+'</div>');
 }else if(state.page==="market"){
  html=panel("РЫНОК И МАСТЕРСКАЯ",'<div class="empty-state"><div style="font-size:34px">⚒️</div><b>Мастерская готовится к открытию</b><br>Здесь появятся ремонт, улучшение ракет и обмен ресурсов.</div>');
 }else if(state.page==="pool"){
  html=panel("ASTRA POOL",'<div class="notice-banner">Реальные награды не включены. Пул сможет распределять только фактически полученную и подтверждённую чистую выручку проекта. Фиксированные выплаты не обещаются.</div><div class="empty-state"><div style="font-size:38px">✧</div><h2>Фонд наград</h2><p>Здесь появятся подтверждённый баланс, периоды распределения и история выплат.</p></div>');
 }else if(state.page==="profile"){
  html=state.authenticated?panel("ПРОФИЛЬ ПИЛОТА",'<div class="list-row"><div class="list-left"><span class="list-icon">👨‍🚀</span><div><b>'+escapeHtml(state.profileName)+'</b><small>Уровень '+state.level+'</small></div></div><span class="status-dot">ONLINE</span></div><div class="list-row"><span>Ракет в ангаре</span><b>'+state.playerRockets.length+'</b></div><div class="list-row"><span>Опыт</span><b>'+state.xp+' XP</b></div><div class="page-actions"><button class="secondary-button" data-action="logout">Выйти из аккаунта</button></div>'):panel("ПРОФИЛЬ ПИЛОТА",'<div class="empty-state">Войди или создай аккаунт, чтобы хранить свой прогресс.</div><button class="primary-button" data-action="login">Войти / Регистрация</button>');
 }else{
  html='<div class="quick-grid"><button class="quick-card" data-go="market"><span class="quick-icon">⚒️</span><b>Рынок</b><small>Обмен и мастерская</small></button><button class="quick-card" data-go="pool"><span class="quick-icon">✧</span><b>Astra Pool</b><small>Фонд наград</small></button><button class="quick-card" data-go="profile"><span class="quick-icon">👨‍🚀</span><b>Профиль</b><small>Статистика пилота</small></button></div>'+panel("АККАУНТ",state.authenticated?'<p class="muted small">Ты вошёл как '+escapeHtml(state.profileName)+'.</p><button class="secondary-button" data-action="logout">Выйти</button>':'<p class="muted small">Войди, чтобы сохранить игровой прогресс.</p><button class="primary-button" data-action="login">Войти / Регистрация</button>');
 }
 el("page-content").innerHTML=html;updateHeader();
}
function navigate(page){state.page=page;render();window.scrollTo(0,0)}
async function loadAccountData(){
 const session=await window.CryptoAstra.auth.getSession();
 if(!session?.user?.id){state.authenticated=false;state.userId=null;render();return}
 state.authenticated=true;state.userId=session.user.id;
 try{
  const uid=encodeURIComponent(session.user.id);
  const [profiles,wallets,playerRockets,inventory,expeditions]=await Promise.all([
   window.CryptoAstra.db.rows("profiles","select=id,display_name&id=eq."+uid),
   window.CryptoAstra.db.rows("player_wallets","select=astra_coins,fuel,xp,level&user_id=eq."+uid),
   window.CryptoAstra.db.rows("player_rockets","select=id,rocket_id,is_active&user_id=eq."+uid),
   window.CryptoAstra.db.rows("player_inventory","select=resource_id,quantity&user_id=eq."+uid),
   window.CryptoAstra.db.rows("expeditions","select=id,player_rocket_id,status,ends_at,reward_payload,created_at&user_id=eq."+uid+"&order=created_at.desc")
  ]);
  state.profileName=profiles[0]?.display_name||"Космический пилот";
  if(wallets[0]){state.coins=Number(wallets[0].astra_coins);state.fuel=wallets[0].fuel;state.xp=wallets[0].xp;state.level=wallets[0].level}
  state.playerRockets=playerRockets;state.owned=playerRockets.map(r=>r.rocket_id);
  state.inventory=Object.fromEntries(resources.map(([id])=>[id,Number(inventory.find(x=>x.resource_id===id)?.quantity||0)]));
  state.expeditions=expeditions;
 }catch(error){
  console.error(error);alert("Не удалось загрузить игровой профиль: "+error.message);
 }
 render();
}
document.addEventListener("click",async e=>{
 const nav=e.target.closest("[data-page]");if(nav){navigate(nav.dataset.page);return}
 const go=e.target.closest("[data-go]");if(go){navigate(go.dataset.go);return}
 const action=e.target.closest("[data-action]");if(!action)return;
 const type=action.dataset.action;
 try{
  if(type==="login"){openAuth();return}
  if(type==="logout"){await window.CryptoAstra.auth.signOut();state.authenticated=false;state.playerRockets=[];state.expeditions=[];navigate("spaceport");return}
  if(!state.authenticated){openAuth();return}
  action.disabled=true;
  if(type==="buy"){
   const result=await window.CryptoAstra.db.rpc("purchase_rocket",{p_rocket_id:action.dataset.name,p_idempotency_key:idempotencyKey("buy")});
   await loadAccountData();alert("Ракета приобретена!");
  }else if(type==="launch"){
   await window.CryptoAstra.db.rpc("launch_expedition",{p_player_rocket_id:action.dataset.id,p_idempotency_key:idempotencyKey("launch")});
   await loadAccountData();alert("Экспедиция запущена. Вернись после её завершения.");
  }else if(type==="complete"){
   const result=await window.CryptoAstra.db.rpc("complete_expedition",{p_expedition_id:action.dataset.id});
   await loadAccountData();
   const reward=result.reward||{};
   alert("Экспедиция завершена! Получено: "+(reward.resource_name||"ресурс")+" × "+(reward.quantity||1)+" и "+(reward.xp||10)+" XP.");
  }else if(type==="select"){navigate("expeditions")}
 }catch(error){alert(error.message||"Не удалось выполнить действие.");action.disabled=false}
});
el("profile-shortcut").addEventListener("click",()=>state.authenticated?navigate("profile"):openAuth());
let authMode="login";
function setAuthMode(mode){
 authMode=mode;
 const signup=mode==="signup";
 el("auth-title").textContent=signup?"Создать аккаунт":"Войти в Crypto Astra";
 el("auth-description").textContent=signup?"Создай пилота. Прогресс будет храниться в базе данных.":"Войди, чтобы продолжить свою экспедицию.";
 el("display-name-label").style.display=signup?"grid":"none";
 el("auth-name").required=signup;
 el("auth-password").autocomplete=signup?"new-password":"current-password";
 el("auth-submit").textContent=signup?"Создать аккаунт":"Войти";
 el("auth-switch").textContent=signup?"У меня уже есть аккаунт":"Создать аккаунт";
 el("auth-message").textContent="";
}
el("auth-switch").addEventListener("click",()=>setAuthMode(authMode==="login"?"signup":"login"));
el("auth-close").addEventListener("click",()=>el("auth-dialog").close());
el("auth-form").addEventListener("submit",async event=>{
 event.preventDefault();
 const email=el("auth-email").value.trim();
 const password=el("auth-password").value;
 const name=el("auth-name").value.trim();
 const submit=el("auth-submit");
 submit.disabled=true;el("auth-message").textContent="Подключаемся…";
 try{
  if(authMode==="signup"){
   const result=await window.CryptoAstra.auth.signUp(email,password,name);
   if(!result.access_token){
    el("auth-message").textContent="Аккаунт создан. Если включено подтверждение email, проверь почту, затем войди.";
   }else{
    el("auth-dialog").close();await loadAccountData();navigate("spaceport");
   }
  }else{
   await window.CryptoAstra.auth.signIn(email,password);
   el("auth-dialog").close();await loadAccountData();navigate("spaceport");
  }
 }catch(error){el("auth-message").textContent=error.message}
 finally{submit.disabled=false}
});
setAuthMode("login");
render();
loadAccountData();
