const state = {
  page:"spaceport",
  authenticated:false,
  userId:null,
  email:"",
  profileName:"Гость",
  coins:0,
  fuel:0,
  xp:0,
  level:1,
  playerRockets:[],
  inventory:{},
  expeditions:[]
};

const rockets = [
  {id:"scout",name:"Scout",image:"./assets/game-art/ships/scout.webp",duration:30,cargo:10,price:0,role:"Разведка",description:"Лёгкий корабль для первых коротких вылетов."},
  {id:"miner",name:"Miner",image:"./assets/game-art/ships/miner.webp",duration:120,cargo:50,price:1500,role:"Добыча",description:"Компактный добывающий корабль с увеличенным отсеком."},
  {id:"explorer",name:"Explorer",image:"./assets/game-art/ships/explorer.webp",duration:240,cargo:120,price:4500,role:"Исследование",description:"Дальний радиус действия и расширенный грузовой отсек."},
  {id:"titan",name:"Titan",image:"./assets/game-art/ships/titan.webp",duration:480,cargo:300,price:12000,role:"Тяжёлый класс",description:"Тяжёлый корпус для продолжительных экспедиций."},
  {id:"galaxy",name:"Galaxy",image:"./assets/ships/galaxy.svg",duration:720,cargo:600,price:30000,role:"Флагман",description:"Максимальная грузоподъёмность стартовой линейки."}
];

const resources = [
  {id:"iron_ore",name:"Железная руда",en:"Iron Ore",image:"./assets/game-art/resources/iron-ore.webp",description:"Базовый конструкционный материал."},
  {id:"copper",name:"Медь",en:"Copper",image:"./assets/game-art/resources/copper-ore.webp",description:"Проводящий металл для оборудования."},
  {id:"blue_crystal",name:"Голубой кристалл",en:"Blue Crystal",image:"./assets/game-art/resources/blue-crystal.webp",description:"Кристаллическое сырьё неизвестного происхождения."},
  {id:"amethyst",name:"Аметист",en:"Amethyst",image:"./assets/game-art/resources/amethyst.webp",description:"Редкий минерал из глубоких пород."},
  {id:"quantum_stone",name:"Квантовый камень",en:"Quantum Stone",image:"./assets/game-art/resources/quantum-ore.webp",description:"Материал с нестабильными энергетическими свойствами."},
  {id:"stellar_core",name:"Звёздное ядро",en:"Stellar Core",image:"./assets/game-art/resources/stellar-core.webp",description:"Редкий компонент для продвинутых систем."}
];

const planets = [
  {id:"ferra",name:"Ferra",className:"Зона добычи",resource:"Железная руда",image:"./assets/game-art/planets/realistic/planet-real-01.webp",status:"ОБНАРУЖЕНА"},
  {id:"cuprum",name:"Cuprum",className:"Промышленный пояс",resource:"Медь",image:"./assets/game-art/planets/realistic/planet-real-02.webp",status:"СКОРО"},
  {id:"azur",name:"Azur",className:"Кристаллические моря",resource:"Голубой кристалл",image:"./assets/game-art/planets/realistic/planet-real-03.webp",status:"ОБНАРУЖЕНА"},
  {id:"ameth",name:"Ameth",className:"Минеральные каньоны",resource:"Аметист",image:"./assets/game-art/planets/realistic/planet-real-04.webp",status:"ОБНАРУЖЕНА"},
  {id:"quantis",name:"Quantis",className:"Аномальная зона",resource:"Квантовый камень",image:"./assets/game-art/planets/realistic/planet-real-05.webp",status:"СКОРО"},
  {id:"stellara",name:"Stellara",className:"Дальний сектор",resource:"Звёздное ядро",image:"./assets/game-art/planets/realistic/planet-real-06.webp",status:"СКОРО"}
];

const pageInfo = {
  spaceport:{title:"Космопорт",kicker:"01 / ОБЗОР",subtitle:"Состояние базы, готовность флота и доступные сектора."},
  rockets:{title:"Ангар",kicker:"02 / ФЛОТ",subtitle:"Корабли, характеристики и развитие экспедиционного флота."},
  expeditions:{title:"Экспедиции",kicker:"03 / ОПЕРАЦИИ",subtitle:"Запускай вылеты, отслеживай время и забирай найденные ресурсы."},
  inventory:{title:"Склад",kicker:"04 / РЕСУРСЫ",subtitle:"Учёт материалов, полученных во время экспедиций."},
  market:{title:"Верфь",kicker:"05 / МОДЕРНИЗАЦИЯ",subtitle:"Технологические модули и развитие кораблей."},
  pool:{title:"Astra Pool",kicker:"06 / ФОНД",subtitle:"Прозрачная информация о механике фонда наград."},
  profile:{title:"Профиль пилота",kicker:"07 / АККАУНТ",subtitle:"Учётная запись и игровая статистика."},
  more:{title:"Система",kicker:"08 / СИСТЕМА",subtitle:"Информация о проекте и текущем режиме игры."}
};

const iconPaths = {
  overview:'<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5M9 21v-7h6v7"/>',
  ship:'<path d="M12 2c3.7 3.2 5.4 7.1 5.4 12.2L12 21l-5.4-6.8C6.6 9.1 8.3 5.2 12 2Z"/><path d="m7 12-3 2v5l5-2m8-5 3 2v5l-5-2M12 8v5"/>',
  orbit:'<circle cx="12" cy="12" r="2.5"/><ellipse cx="12" cy="12" rx="9" ry="4.5" transform="rotate(-35 12 12)"/><path d="m18.5 4.5 1.8-1.8"/>',
  inventory:'<path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z"/><path d="m4 7.5 8 4.7 8-4.7M12 12.2V21M8 5.3l8 4.6"/>',
  market:'<path d="m14 6 4 4M3 21l5.2-1 11.3-11.3a2.8 2.8 0 0 0-4-4L4.2 16 3 21Z"/><path d="m12 8 4 4"/>',
  pool:'<path d="M12 2v20M2 12h20M5 5l14 14M19 5 5 19"/><circle cx="12" cy="12" r="8"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  coin:'<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5c-.7-.7-1.7-1-3.2-1-1.8 0-3 .8-3 2s1.1 1.8 3 2.3 3 1.2 3 2.5-1.2 2.2-3.2 2.2c-1.4 0-2.6-.4-3.4-1.2M12 5.5v13"/>',
  fuel:'<path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h7A1.5 1.5 0 0 1 16 4.5V21M4 21h14M8.5 7h5"/><path d="M16 8h2l2 3v5.5a1.5 1.5 0 0 1-3 0V14"/>',
  experience:'<path d="m12 2 2.6 6.1L21 10l-6.4 1.9L12 18l-2.6-6.1L3 10l6.4-1.9L12 2Z"/><path d="m19 16 1.2 2.8L23 20l-2.8 1.2L19 24l-1.2-2.8L15 20l2.8-1.2L19 16Z"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.7 9A7 7 0 0 1 18 6l2 1M4 17l2 1a7 7 0 0 0 12.3-3"/>',
  arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
  lock:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3M12 14v3"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.1 1.9-2 3.4-2.2-.4a7.5 7.5 0 0 1-1.5.9l-.7 2.1h-4l-.7-2.1a7.5 7.5 0 0 1-1.5-.9l-2.2.4-2-3.4 1.1-1.9A7.8 7.8 0 0 1 5 13l-1.9-1.1v-4L5 7.2c.2-.6.5-1.1.9-1.6L5.5 3.4 9 1.5l1.8 1.1c.6-.1 1.2-.1 1.8 0l1.8-1.1 3.5 1.9-.4 2.2c.4.5.7 1 .9 1.6l1.9.7v4L18.4 13c-.1.7-.4 1.4-.8 2Z"/>'
};
function svgIcon(name){
  const d=iconPaths[name]||iconPaths.overview;
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+d+'</svg>';
}
function hydrateIcons(){
  document.querySelectorAll("[data-icon]").forEach(node=>{node.innerHTML=svgIcon(node.dataset.icon)});
}
function el(id){return document.getElementById(id)}
function escapeHtml(value){
  return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function key(prefix){
  return prefix+":"+Date.now().toString(36)+":"+Math.random().toString(36).slice(2,10);
}
function formatNumber(value){return Number(value||0).toLocaleString("ru-RU")}
function formatDuration(minutes){
  if(minutes<60)return minutes+" мин";
  const h=Math.floor(minutes/60),m=minutes%60;
  return h+" ч"+(m?" "+m+" мин":"");
}
function panel(title,body,meta=""){
  return '<section class="panel"><div class="panel-heading"><span>'+title+'</span>'+(meta?'<span class="muted-label">'+meta+'</span>':"")+'</div>'+body+'</section>';
}
function navigate(page){
  if(!pageInfo[page])return;
  state.page=page;
  render();
  window.scrollTo(0,0);
}
function updateHeader(){
  el("coin-balance").textContent=state.authenticated?formatNumber(state.coins):"—";
  el("fuel-balance").textContent=state.authenticated?formatNumber(state.fuel):"—";
  el("xp-balance").textContent=state.authenticated?formatNumber(state.xp)+" XP":"—";
  el("player-level").textContent=state.authenticated?state.level:"—";
  el("xp-progress-label").textContent=state.authenticated?(state.xp%100)+" / 100 XP":"—";
  el("xp-progress").style.width=state.authenticated?Math.min(100,state.xp%100)+"%":"0%";

  const user=state.authenticated?state.profileName:"Гость";
  const initials=state.authenticated?user.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase():"CA";
  el("topbar-profile-name").textContent=user;
  el("account-status").textContent=state.authenticated?state.email:"Вход не выполнен";
  el("profile-initials").textContent=initials;
  el("pilot-avatar").textContent=initials;
  el("pilot-name").textContent=user;
  el("pilot-subtitle").textContent=state.authenticated?"Командир экспедиционного флота":"Создай аккаунт, чтобы начать";
  el("pilot-state").textContent=state.authenticated?"В СЕТИ":"НЕ В СЕТИ";
  el("pilot-state").classList.toggle("online",state.authenticated);
  el("demo-label").textContent=state.authenticated?"ONLINE":"DEMO";
  el("demo-label").classList.toggle("online",state.authenticated);
  el("sync-state").textContent=state.authenticated?"Синхронизировано":"Ожидание";
}
function ownedIds(){return new Set(state.playerRockets.map(r=>r.rocket_id))}
function pageHeading(){
  const info=pageInfo[state.page]||pageInfo.spaceport;
  el("page-title").textContent=info.title;
  el("page-kicker").textContent=info.kicker;
  el("page-subtitle").textContent=info.subtitle;
  el("topbar-section").textContent=info.title.toLocaleUpperCase("ru-RU");
}
function renderPlanetCards(){
  return planets.map((p,i)=>{
    return '<article class="planet-card"><div class="planet-art"><img src="'+p.image+'" alt="Планета '+p.name+'" loading="lazy"></div><div class="planet-card-copy"><b>'+p.name.toUpperCase()+'</b><small>'+p.className+' · '+p.resource+'</small><span>'+(p.status==="ОБНАРУЖЕНА"?"РАЗВЕДАНА":"В РАЗРАБОТКЕ")+'</span></div></article>';
  }).join("");
}
function renderHome(){
  const owned=state.playerRockets.length;
  const active=state.expeditions.filter(e=>e.status==="in_progress");
  const due=active.filter(e=>new Date(e.ends_at)<=new Date()).length;
  const heroStatus=state.authenticated?(active.length?active.length+" АКТИВНЫХ ПОЛЁТА":"ФЛОТ ГОТОВ К РАБОТЕ"):"ПРЕДВАРИТЕЛЬНЫЙ ПРОСМОТР";
  const mainHero='<section class="panel mission-hero"><div class="mission-copy"><div class="mission-code">СЕКТОР 01 · СТАРТОВАЯ СИСТЕМА</div><h2>Исследование начинается с подготовки</h2><p>Собери флот, распределяй топливо и отправляй корабли в сектора с неразведанными ресурсами.</p><div class="mission-actions"><button class="primary-button" data-go="expeditions">Открыть экспедиции '+svgIcon("arrow")+'</button><button class="secondary-button" data-go="rockets">Состав флота</button></div></div><div class="mission-art"><img src="./assets/game-art/ships/scout.webp" alt="Корабль Scout"><span class="mission-art-label">SCOUT / CLASS I</span></div></section>';
  const stats='<section class="dashboard-grid"><div class="panel"><div class="panel-title-row"><h2>Оперативная сводка</h2><small>ТЕКУЩЕЕ СОСТОЯНИЕ</small></div><div class="mission-facts"><div class="mission-fact"><small>КОРАБЛИ В АНГАРЕ</small><b>'+(state.authenticated?owned:"—")+'</b></div><div class="mission-fact"><small>АКТИВНЫЕ ПОЛЁТЫ</small><b>'+(state.authenticated?active.length:"—")+'</b></div><div class="mission-fact"><small>ГОТОВЫ К СБОРУ</small><b>'+(state.authenticated?due:"—")+'</b></div></div><div class="list-row"><div class="list-left"><span class="list-icon">'+svgIcon("orbit")+'</span><div><b>Экспедиционная сеть</b><small>'+(state.authenticated?"Данные получены из базы игрока":"Войди, чтобы синхронизировать флот")+'</small></div></div><span class="status-pill '+(state.authenticated?"ready":"warning")+'">'+(state.authenticated?"СИНХРОН":"ТРЕБУЕТСЯ ВХОД")+'</span></div></div><div class="panel"><div class="panel-title-row"><h2>Быстрые действия</h2><small>НАВИГАЦИЯ</small></div><div class="compact-list"><div class="list-row"><div class="list-left"><span class="list-icon">'+svgIcon("ship")+'</span><div><b>Проверить ангар</b><small>Состояние и покупка кораблей</small></div></div><button class="text-link" data-go="rockets">Открыть →</button></div><div class="list-row"><div class="list-left"><span class="list-icon">'+svgIcon("inventory")+'</span><div><b>Инвентаризация</b><small>Найденные материалы</small></div></div><button class="text-link" data-go="inventory">Открыть →</button></div><div class="list-row"><div class="list-left"><span class="list-icon">'+svgIcon("market")+'</span><div><b>Технологии</b><small>Развитие кораблей</small></div></div><button class="text-link" data-go="market">Открыть →</button></div></div></div></section>';
  const chart=panel("НАВИГАЦИОННАЯ КАРТА",'<div class="galaxy-map-frame"><img src="./assets/maps/galaxy-map.svg" alt="Карта секторов галактики"></div><div class="map-legend"><span><i class="map-dot map-known"></i>Известный сектор</span><span><i class="map-dot map-route"></i>Маршрут связи</span><span><i class="map-dot map-frontier"></i>Внешняя зона</span></div><div class="space-object-strip"><div><img src="./assets/game-art/objects/station.webp" alt=""><span>ОРБИТАЛЬНАЯ СТАНЦИЯ</span></div><div><img src="./assets/game-art/objects/asteroid.webp" alt=""><span>ПОЯС АСТЕРОИДОВ</span></div><div><img src="./assets/game-art/objects/mining-drone.webp" alt=""><span>РАЗВЕДДРОН</span></div></div>',"SECTOR GRID 01");
  const sectors=panel("ПЛАНЕТЫ СИСТЕМЫ",'<div class="planet-grid">'+renderPlanetCards()+'</div>',"6 СЕКТОРОВ");
  const note='<div class="system-note-wide"><span class="system-note-mark">i</span><span>Игровая экономика находится в тестовом режиме. ASTRA Coins не являются денежным балансом, а реальные выплаты пока отключены.</span></div>';
  const extraSprites=["beacon","cargo-container","outpost","probe","relay-satellite","satellite","supply-crate","teleporter","turret","wreckage"].map(id=>`<div class="space-object-card"><img src="./assets/game-art/objects/${id}.webp" alt="${id}"><span>${id.toUpperCase()}</span></div>`).join("");
  return mainHero+stats+chart+sectors+panel("ОБЪЕКТЫ ГАЛАКТИКИ",'<div class="space-object-gallery">'+extraSprites+'</div>',"13 SPRITES")+note;
}
function renderRocketCards(){
  const owned=ownedIds();
  return rockets.map((r,i)=>{
    const has=state.authenticated&&owned.has(r.id);
    const unavailable=!state.authenticated;
    const action=has?"select":(unavailable?"login":"buy");
    const actionLabel=has?"В ангаре":(unavailable?"Войти":(r.price===0?"Получить":"Купить"));
    return '<article class="rocket-card"><div class="rocket-card-top"><span class="rocket-index">CA / 0'+(i+1)+'</span>'+(has?'<span class="owned-tag">В АНГАРЕ</span>':'<span class="status-pill">'+r.role.toUpperCase()+'</span>')+'</div><div class="rocket-art"><img src="'+r.image+'" alt="Корабль '+r.name+'" loading="lazy"></div><h3>'+r.name+'</h3><p>'+r.description+'</p><div class="rocket-stats"><div class="rocket-stat"><small>ПОЛЁТ</small><b>'+formatDuration(r.duration)+'</b></div><div class="rocket-stat"><small>ГРУЗ</small><b>'+formatNumber(r.cargo)+'</b></div><div class="rocket-stat"><small>КЛАСС</small><b>'+r.role+'</b></div></div><div class="rocket-footer"><span class="rocket-price">'+(r.price===0?"СТАРТОВЫЙ":formatNumber(r.price)+" ASTRA")+'</span><button class="'+(has?"secondary-button":"primary-button")+'" data-action="'+action+'" data-name="'+r.id+'" '+(has?"disabled":"")+'>'+actionLabel+'</button></div></article>';
  }).join("");
}
function renderRockets(){
  const summary=state.authenticated?state.playerRockets.length+" КОРАБЛЯ В АНГАРЕ":"КАТАЛОГ КОРАБЛЕЙ";
  const intro='<div class="section-intro"><div><h2>Линейка кораблей</h2><p>У каждого класса своё время полёта и грузовая вместимость.</p></div><span class="status-pill '+(state.authenticated?"ready":"warning")+'">'+summary+'</span></div>';
  const cards=panel("КАТАЛОГ ФЛОТА",'<div class="item-grid">'+renderRocketCards()+'</div>',"5 КЛАССОВ");
  const extraShips=["fighter","guardian","phantom","ranger","stealth"].map(id=>`<article class="sprite-showcase-card"><img src="./assets/game-art/ships/${id}.webp" alt="${id}"><b>${id.toUpperCase()}</b></article>`).join("");
  return intro+cards+panel("ДРУГИЕ КОРПУСА",'<div class="sprite-showcase-grid">'+extraShips+'</div>',"5 SPRITES");
}
function renderExpeditions(){
  if(!state.authenticated){
    return panel("ДОСТУП К ОПЕРАЦИЯМ",'<div class="empty-state"><div class="empty-mark">'+svgIcon("lock")+'</div><b>Требуется авторизация</b>Войди в аккаунт, чтобы запускать экспедиции и сохранять результаты на сервере.<div class="page-actions" style="justify-content:center"><button class="primary-button" data-action="login">Войти в систему</button></div></div>');
  }
  const active=state.expeditions.filter(e=>e.status==="in_progress");
  const completed=state.expeditions.filter(e=>e.status==="completed").slice(0,4);
  const owned=state.playerRockets;
  const activeCards=active.length?active.map(e=>{
    const r=rockets.find(x=>x.id===state.playerRockets.find(p=>p.id===e.player_rocket_id)?.rocket_id);
    const due=new Date(e.ends_at)<=new Date();
    return '<article class="expedition-card"><div class="expedition-card-head"><div><b>'+(r?r.name:"Экспедиционный корабль")+'</b><small>Окончание: '+new Date(e.ends_at).toLocaleString("ru-RU")+'</small></div><span class="status-pill '+(due?"ready":"warning")+'">'+(due?"ГОТОВО":"В ПОЛЁТЕ")+'</span></div><div class="expedition-meta"><div><small>СТАРТ</small><b>'+new Date(e.started_at).toLocaleString("ru-RU")+'</b></div><div><small>ДОСТУПНОСТЬ</small><b>'+(due?"Можно завершить":"Ожидание")+'</b></div><div><small>СТАТУС</small><b>Серверный таймер</b></div></div><div class="expedition-actions"><button class="'+(due?"primary-button":"secondary-button")+'" data-action="complete" data-id="'+e.id+'" '+(due?"":"disabled")+'>'+(due?"Забрать результаты":"Экспедиция выполняется")+'</button></div></article>';
  }).join(""):'<div class="empty-state">Активных экспедиций нет. Выбери корабль и запусти новый вылет.</div>';
  const available=owned.map(pr=>{
    const r=rockets.find(x=>x.id===pr.rocket_id);if(!r)return "";
    const busy=active.some(e=>e.player_rocket_id===pr.id);
    return '<div class="list-row"><div class="list-left"><span class="list-icon">'+svgIcon("ship")+'</span><div><b>'+r.name+'</b><small>'+formatDuration(r.duration)+' · груз '+formatNumber(r.cargo)+'</small></div></div><button class="primary-button" data-action="launch" data-id="'+pr.id+'" '+(busy||state.fuel<1?"disabled":"")+'>'+(busy?"В полёте":"Запустить")+'</button></div>';
  }).join("");
  const history=completed.length?panel("ПОСЛЕДНИЕ ЗАВЕРШЁННЫЕ ПОЛЁТЫ",completed.map(e=>{
    const rw=e.reward_payload||{};
    return '<div class="list-row"><div class="list-left"><span class="list-icon">'+svgIcon("check")+'</span><div><b>Экспедиция завершена</b><small>'+new Date(e.completed_at||e.created_at).toLocaleString("ru-RU")+'</small></div></div><span class="list-value">'+escapeHtml(rw.resource_name||"Ресурсы")+' × '+formatNumber(rw.quantity||0)+'</span></div>';
  }).join("")):"";
  return panel("АКТИВНЫЕ ЭКСПЕДИЦИИ",'<div class="page-actions"><button class="secondary-button" data-action="refresh">'+svgIcon("refresh")+' Обновить данные</button></div>'+activeCards,active.length+" АКТИВНО")+
    panel("ГОТОВЫЕ К ЗАПУСКУ",'<div class="compact-list">'+(available||'<div class="empty-state">В ангаре пока нет кораблей.</div>')+'</div>',"ТОПЛИВО: "+formatNumber(state.fuel))+
    history;
}
function renderInventory(){
  const total=resources.reduce((sum,r)=>sum+Number(state.inventory[r.id]||0),0);
  const tiles=resources.map(r=>{
    const quantity=Number(state.inventory[r.id]||0);
    return '<article class="resource-tile"><div class="resource-tile-art"><img src="'+r.image+'" alt="'+r.en+'" loading="lazy"></div><h3>'+r.name+'</h3><p>'+r.en+'</p><strong>'+formatNumber(quantity)+'</strong></article>';
  }).join("");
  return panel("МАТЕРИАЛЬНЫЙ БАЛАНС",'<div class="mission-facts"><div class="mission-fact"><small>ТИПЫ МАТЕРИАЛОВ</small><b>06</b></div><div class="mission-fact"><small>ЕДИНИЦ В СКЛАДЕ</small><b>'+formatNumber(total)+'</b></div><div class="mission-fact"><small>УЧЁТ</small><b>Серверный</b></div></div><div class="resource-grid">'+tiles+'</div>',"ИНВЕНТАРЬ");
}
function renderMarket(){
  const entries=[
    ["engine","Ионный двигатель","Система повышения эффективности полёта","./assets/game-art/modules/engine.webp"],
    ["hull","Усиленный корпус","Дополнительная защита корабля","./assets/game-art/modules/hull.webp"],
    ["drill","Буровой модуль","Специализация на добыче сырья","./assets/game-art/modules/drill.webp"],
    ["navigation","Навигационный блок","Точность расчёта маршрутов","./assets/game-art/modules/navigation-console.webp"],
    ["cargo","Грузовой отсек","Увеличение вместимости","./assets/game-art/modules/cargo-bay.webp"],
    ["shield","Защитный экран","Защита оборудования","./assets/game-art/modules/shield.webp"],["fuel","Топливный резервуар","Запас для дальних маршрутов","./assets/game-art/modules/fuel-tank.webp"],["solar","Солнечная панель","Автономное питание систем","./assets/game-art/modules/solar-panel.webp"]
  ];
  const cards=entries.map((x,i)=>'<article class="market-card"><div class="module-art"><img src="'+x[3]+'" alt="'+x[1]+'"></div><b>'+x[1]+'</b><small>'+x[2]+'</small><span class="market-state">В РАЗРАБОТКЕ</span></article>').join("");
  return panel("ТЕХНОЛОГИЧЕСКИЕ МОДУЛИ",'<div class="market-intro"><div><h2>Модернизация флота</h2><p>Каталог будущих компонентов. Цены и покупка появятся после внедрения серверных правил модификации.</p></div></div><div class="market-grid">'+cards+'</div><div class="notice-banner">Модули пока нельзя приобрести. Мы не показываем вымышленные цены и не списываем ASTRA Coins.</div>');
}
function renderPool(){
  return panel("ПРИНЦИП РАБОТЫ ФОНДА",'<div class="pool-intro"><div class="pool-symbol">AP</div><div><h2>Astra Pool</h2><p>Фонд наград не создаёт доход из игровых балансов. Распределение возможно только при наличии подтверждённой чистой выручки проекта.</p></div></div><div class="mission-facts"><div class="mission-fact"><small>ТЕКУЩИЙ СТАТУС</small><b>Не запущен</b></div><div class="mission-fact"><small>ФИКСИРОВАННАЯ ДОХОДНОСТЬ</small><b>Отсутствует</b></div><div class="mission-fact"><small>ИСТОЧНИК</small><b>Чистая выручка</b></div></div><div class="notice-banner">Реальные деньги, выплаты и платёжные провайдеры не подключены. ASTRA Coins не конвертируются в деньги. Не рассматривай этот раздел как обещание заработка.</div>');
}
function renderProfile(){
  if(!state.authenticated){
    return panel("УЧЁТНАЯ ЗАПИСЬ",'<div class="empty-state"><div class="empty-mark">'+svgIcon("lock")+'</div><b>Профиль недоступен</b>Войди в систему или создай аккаунт, чтобы сохранить игровой прогресс.<div class="page-actions" style="justify-content:center"><button class="primary-button" data-action="login">Войти / регистрация</button></div></div>');
  }
  return panel("ДАННЫЕ ПИЛОТА",'<div class="profile-large"><div class="profile-large-avatar"><img src="./assets/game-art/pilots/pilot-01.webp" alt="Аватар пилота"></div><div><h2>'+escapeHtml(state.profileName)+'</h2><p>'+escapeHtml(state.email)+'</p><span class="status-pill ready">АККАУНТ ПОДТВЕРЖДЁН СЕССИЕЙ</span></div></div><div class="mission-facts"><div class="mission-fact"><small>УРОВЕНЬ</small><b>'+state.level+'</b></div><div class="mission-fact"><small>РАКЕТ В АНГАРЕ</small><b>'+state.playerRockets.length+'</b></div><div class="mission-fact"><small>ОПЫТ</small><b>'+formatNumber(state.xp)+' XP</b></div></div><div class="page-actions"><button class="secondary-button" data-action="refresh">'+svgIcon("refresh")+' Синхронизировать</button><button class="secondary-button" data-action="logout">Выйти из аккаунта</button></div>');
}
function renderMore(){
  const rows=[
    ["О проекте","Версия интерфейса 0.2 · мобильная браузерная игра"],
    ["Игровые балансы","ASTRA Coins и ресурсы используются только внутри игры"],
    ["Astra Pool","Реальные выплаты пока отключены"],
    ["Сохранность данных","Игровые операции выполняются сервером"],
    ["Поддержка","Контакты проекта появятся перед публичным запуском"]
  ];
  return panel("СИСТЕМНАЯ ИНФОРМАЦИЯ",'<div class="compact-list">'+rows.map((r,i)=>'<div class="list-row"><div class="list-left"><span class="list-icon">'+svgIcon(["overview","coin","pool","lock","settings"][i])+'</span><div><b>'+r[0]+'</b><small>'+r[1]+'</small></div></div></div>').join("")+'</div><div class="page-actions"><button class="secondary-button" data-action="login">Управление аккаунтом</button></div>');
}
function render(){
  pageHeading();
  document.querySelectorAll(".nav-link,.mobile-nav-item").forEach(btn=>btn.classList.toggle("active",btn.dataset.page===state.page));
  let content="";
  if(state.page==="spaceport")content=renderHome();
  else if(state.page==="rockets")content=renderRockets();
  else if(state.page==="expeditions")content=renderExpeditions();
  else if(state.page==="inventory")content=renderInventory();
  else if(state.page==="market")content=renderMarket();
  else if(state.page==="pool")content=renderPool();
  else if(state.page==="profile")content=renderProfile();
  else content=renderMore();
  el("page-content").innerHTML=content;
  updateHeader();
}
async function loadAccountData(){
  const session=await window.CryptoAstra.auth.getSession();
  if(!session?.user?.id){
    state.authenticated=false;state.userId=null;state.email="";
    state.profileName="Гость";state.playerRockets=[];state.expeditions=[];
    state.coins=0;state.fuel=0;state.xp=0;state.level=1;
    state.inventory=Object.fromEntries(resources.map(r=>[r.id,0]));
    render();return;
  }
  state.authenticated=true;state.userId=session.user.id;state.email=session.user.email||"";
  try{
    const uid=encodeURIComponent(session.user.id);
    const [profiles,wallets,playerRockets,inventory,expeditions]=await Promise.all([
      window.CryptoAstra.db.rows("profiles","select=id,display_name&id=eq."+uid),
      window.CryptoAstra.db.rows("player_wallets","select=astra_coins,fuel,xp,level&user_id=eq."+uid),
      window.CryptoAstra.db.rows("player_rockets","select=id,rocket_id,is_active&user_id=eq."+uid),
      window.CryptoAstra.db.rows("player_inventory","select=resource_id,quantity&user_id=eq."+uid),
      window.CryptoAstra.db.rows("expeditions","select=id,player_rocket_id,status,started_at,ends_at,completed_at,reward_payload,created_at&user_id=eq."+uid+"&order=created_at.desc")
    ]);
    state.profileName=profiles[0]?.display_name||"Космический пилот";
    if(wallets[0]){
      state.coins=Number(wallets[0].astra_coins);state.fuel=Number(wallets[0].fuel);
      state.xp=Number(wallets[0].xp);state.level=Number(wallets[0].level);
    }
    state.playerRockets=playerRockets;
    state.inventory=Object.fromEntries(resources.map(r=>[r.id,Number(inventory.find(x=>x.resource_id===r.id)?.quantity||0)]));
    state.expeditions=expeditions;
    el("sync-state").textContent="Синхронизировано";
  }catch(error){
    console.error("Account sync failed:",error);
    el("sync-state").textContent="Ошибка";
    el("sync-state").style.color="var(--red)";
  }
  render();
}

hydrateIcons();
render();

document.addEventListener("click",async event=>{
  const nav=event.target.closest("[data-page]");
  if(nav){navigate(nav.dataset.page);return;}
  const go=event.target.closest("[data-go]");
  if(go){navigate(go.dataset.go);return;}
  const action=event.target.closest("[data-action]");
  if(!action)return;
  const type=action.dataset.action;
  try{
    if(type==="login"){openAuth();return;}
    if(type==="refresh"){action.disabled=true;await loadAccountData();action.disabled=false;return;}
    if(type==="logout"){
      await window.CryptoAstra.auth.signOut();
      navigate("spaceport");await loadAccountData();return;
    }
    if(!state.authenticated){openAuth();return;}
    action.disabled=true;
    if(type==="buy"){
      await window.CryptoAstra.db.rpc("purchase_rocket",{p_rocket_id:action.dataset.name,p_idempotency_key:key("buy")});
      await loadAccountData();
    }else if(type==="launch"){
      await window.CryptoAstra.db.rpc("launch_expedition",{p_player_rocket_id:action.dataset.id,p_idempotency_key:key("launch")});
      await loadAccountData();
    }else if(type==="complete"){
      const result=await window.CryptoAstra.db.rpc("complete_expedition",{p_expedition_id:action.dataset.id});
      await loadAccountData();
      const reward=result.reward||{};
      alert("Экспедиция завершена. Получено: "+(reward.resource_name||"ресурс")+" × "+(reward.quantity||1)+" и "+(reward.xp||10)+" XP.");
    }else if(type==="select"){
      navigate("expeditions");
    }
  }catch(error){
    alert(error.message||"Не удалось выполнить действие.");
    action.disabled=false;
  }
});

el("profile-shortcut").addEventListener("click",()=>state.authenticated?navigate("profile"):openAuth());
el("pilot-profile-link").addEventListener("click",()=>navigate("profile"));

let authMode="login";
function openAuth(){
  el("auth-message").textContent="";
  el("auth-dialog").showModal();
}
function setAuthMode(mode){
  authMode=mode;
  const signup=mode==="signup";
  el("auth-title").textContent=signup?"Создать аккаунт":"Войти в Crypto Astra";
  el("auth-description").textContent=signup?"Создай пилота. Игровой прогресс будет сохранён на сервере.":"Войди, чтобы продолжить работу с флотом.";
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
  submit.disabled=true;el("auth-message").textContent="Подключение…";
  try{
    if(authMode==="signup"){
      const result=await window.CryptoAstra.auth.signUp(email,password,name);
      if(!result.access_token){
        el("auth-message").textContent="Аккаунт создан. Проверь почту для подтверждения адреса, затем войди.";
      }else{
        el("auth-dialog").close();await loadAccountData();navigate("spaceport");
      }
    }else{
      await window.CryptoAstra.auth.signIn(email,password);
      el("auth-dialog").close();await loadAccountData();navigate("spaceport");
    }
  }catch(error){
    el("auth-message").textContent=error.message||"Не удалось выполнить вход.";
  }finally{
    submit.disabled=false;
  }
});
setAuthMode("login");
loadAccountData();
