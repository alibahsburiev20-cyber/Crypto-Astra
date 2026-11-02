const state = { coins: 500, fuel: 3, xp: 0, level: 1, owned: ["Scout"], page: "spaceport", inventory: { "Iron Ore": 0, "Copper": 0, "Blue Crystal": 0, "Amethyst": 0, "Quantum Stone": 0, "Stellar Core": 0 } };
const rockets = [
  {name:"Scout",icon:"🚀",time:"30 минут",cargo:10,price:0,description:"Стартовая ракета для первых коротких экспедиций."},
  {name:"Miner",icon:"🛰️",time:"2 часа",cargo:50,price:1500,description:"Небольшой добывающий корабль с увеличенным грузовым отсеком."},
  {name:"Explorer",icon:"🌠",time:"4 часа",cargo:120,price:4500,description:"Исследовательский корабль для дальних маршрутов."},
  {name:"Titan",icon:"🛸",time:"8 часов",cargo:300,price:12000,description:"Тяжёлая ракета для крупных экспедиций."},
  {name:"Galaxy",icon:"🚀",time:"12 часов",cargo:600,price:30000,description:"Флагман стартовой линейки Crypto Astra."}
];
const resources = [
  ["Iron Ore","⛰️"],["Copper","🟠"],["Blue Crystal","💎"],["Amethyst","🔮"],["Quantum Stone","🪨"],["Stellar Core","🌟"]
];
const pageInfo = {
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
function updateHeader(){
  el("coin-balance").textContent=state.coins.toLocaleString("ru-RU");
  el("fuel-balance").textContent=state.fuel;
  el("xp-balance").textContent=state.xp+" XP";
  el("player-level").textContent=state.level;
  el("xp-progress-label").textContent=state.xp+" / 100 XP";
  el("xp-progress").style.width=Math.min(100,state.xp)+"%";
}
function panel(title,body){return '<section class="panel"><div class="panel-heading">'+title+'</div>'+body+'</section>'}
function rocketCards(){return '<div class="item-grid">'+rockets.map(r=>'<article class="item-card"><div class="item-visual">'+r.icon+'</div><h3>'+r.name+'</h3><p>'+r.description+'</p><div class="item-meta"><span>Груз: '+r.cargo+'</span><b>'+(r.price===0?"БЕСПЛАТНО":r.price.toLocaleString("ru-RU")+" ASTRA")+'</b></div><button class="'+(state.owned.includes(r.name)?"secondary-button":"primary-button")+'" data-action="'+(state.owned.includes(r.name)?"select":"buy")+'" data-name="'+r.name+'" '+(state.owned.includes(r.name)?"":"")+'>'+(state.owned.includes(r.name)?"В ангаре":"Купить")+'</button></article>').join("")+'</div>'}
function render(){
 const [title,subtitle]=pageInfo[state.page]||pageInfo.spaceport;
 el("page-title").textContent=title;el("page-subtitle").textContent=subtitle;
 document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===state.page || (state.page==="more"&&b.dataset.page==="more")));
 let html="";
 if(state.page==="spaceport"){
  html= '<section class="panel hero-panel"><div class="hero-copy"><p class="eyebrow">СЕКТОР 01 · СТАРТОВАЯ СИСТЕМА</p><h2>Галактика ждёт<br>своего исследователя</h2><p>Подготовь Scout, проверь запасы топлива и отправляйся в первую экспедицию.</p><button class="primary-button" data-go="expeditions">Начать экспедицию →</button></div><div class="hero-planet" aria-label="Планета"></div></section>'+
  '<div><h2 class="section-title">Быстрый доступ</h2><div class="quick-grid"><button class="quick-card" data-go="rockets"><span class="quick-icon">🚀</span><b>Мой флот</b><small>Управление ракетами</small></button><button class="quick-card" data-go="inventory"><span class="quick-icon">▦</span><b>Склад</b><small>Космические ресурсы</small></button><button class="quick-card" data-go="market"><span class="quick-icon">⚒️</span><b>Мастерская</b><small>Развитие флота</small></button></div></div>'+
  panel("ПОСЛЕДНИЕ СОБЫТИЯ",'<div class="list-row"><div class="list-left"><span class="list-icon">🧑‍🚀</span><div><b>Добро пожаловать в Crypto Astra</b><small>Твой путь начинается с ракеты Scout.</small></div></div><span class="status-dot">NEW</span></div>');
 } else if(state.page==="rockets"){
  html=panel("АНГАР · "+state.owned.length+" / 5 РАКЕТ",rocketCards());
 } else if(state.page==="expeditions"){
  const owned=rockets.filter(r=>state.owned.includes(r.name));
  html=panel("ДОСТУПНЫЕ ЭКСПЕДИЦИИ",'<div class="notice-banner">Демо-режим: завершение экспедиций и добыча пока моделируются локально. В рабочей версии время и награды будет проверять сервер.</div><div class="item-grid" style="margin-top:12px">'+owned.map(r=>'<article class="item-card"><div class="item-visual">'+r.icon+'</div><h3>'+r.name+'</h3><p>Длительность: '+r.time+'<br>Вместимость: '+r.cargo+'</p><button class="primary-button" data-action="launch" data-name="'+r.name+'">Запустить демо</button></article>').join("")+'</div>');
 } else if(state.page==="inventory"){
  html=panel("КОСМИЧЕСКИЕ МАТЕРИАЛЫ",'<div>'+resources.map(([name,icon])=>'<div class="list-row"><div class="list-left"><span class="list-icon">'+icon+'</span><div><b>'+name+'</b><small>Космический ресурс</small></div></div><strong>'+state.inventory[name]+'</strong></div>').join("")+'</div>');
 } else if(state.page==="market"){
  html=panel("РЫНОК И МАСТЕРСКАЯ",'<div class="empty-state"><div style="font-size:34px">⚒️</div><b>Мастерская готовится к открытию</b><br>Здесь появятся ремонт, улучшение ракет и обмен ресурсов. Цены и спрос будут рассчитываться сервером.</div>');
 } else if(state.page==="pool"){
  html=panel("ASTRA POOL",'<div class="notice-banner">Реальные награды не включены в демо. Пул сможет распределять только фактически полученную и подтверждённую чистую выручку проекта. Фиксированные выплаты не обещаются.</div><div class="empty-state"><div style="font-size:38px">✧</div><h2>Фонд наград</h2><p>После подключения финансового журнала здесь будут отображаться подтверждённый баланс, периоды распределения и история выплат.</p></div>');
 } else if(state.page==="profile"){
  html=panel("ПРОФИЛЬ ПИЛОТА",'<div class="list-row"><div class="list-left"><span class="list-icon">👨‍🚀</span><div><b>Космический пилот</b><small>Уровень '+state.level+'</small></div></div><span class="status-dot">DEMO</span></div><div class="list-row"><span>Ракет в ангаре</span><b>'+state.owned.length+'</b></div><div class="list-row"><span>Опыт</span><b>'+state.xp+' XP</b></div>');
 } else {
  html='<div class="quick-grid"><button class="quick-card" data-go="market"><span class="quick-icon">⚒️</span><b>Рынок</b><small>Обмен и мастерская</small></button><button class="quick-card" data-go="pool"><span class="quick-icon">✧</span><b>Astra Pool</b><small>Фонд наград</small></button><button class="quick-card" data-go="profile"><span class="quick-icon">👨‍🚀</span><b>Профиль</b><small>Статистика пилота</small></button></div>'+panel("CLAIM",'<p class="muted small">Демо-начисление тестовых ASTRA Coins. В реальной версии лимиты и начисления будут проверяться сервером.</p><button class="primary-button" data-action="claim">Получить +10 ASTRA</button>');
 }
 el("page-content").innerHTML=html;updateHeader();
}
function navigate(page){state.page=page;render();window.scrollTo(0,0)}
document.addEventListener("click",e=>{
 const nav=e.target.closest("[data-page]");if(nav){navigate(nav.dataset.page);return}
 const go=e.target.closest("[data-go]");if(go){navigate(go.dataset.go);return}
 const action=e.target.closest("[data-action]");if(!action)return;
 const name=action.dataset.name;
 if(action.dataset.action==="buy"){
  const r=rockets.find(x=>x.name===name);if(!r||state.coins<r.price)return;
  state.coins-=r.price;state.owned.push(name);render();
 }else if(action.dataset.action==="select"){navigate("expeditions")}
 else if(action.dataset.action==="launch"){
  if(state.fuel<1){alert("Недостаточно топлива в демо-режиме.");return}
  state.fuel-=1;state.xp+=10;state.level=state.xp>=100?2:1;
  const reward=resources[Math.floor(Math.random()*3)];state.inventory[reward[0]]+=1;render();
  alert("Демо-экспедиция завершена: +10 XP и 1 "+reward[0]+". Это тестовые данные, не реальные награды.");
 }else if(action.dataset.action==="claim"){
  state.coins+=10;render();alert("Демо: начислено 10 ASTRA Coins.");
 }
});
el("profile-shortcut").addEventListener("click",()=>navigate("profile"));
render();