import { chooseLanguage,supportedLanguage,LANGUAGE_STORAGE_KEY,LEGACY_LANGUAGE_STORAGE_KEY,translate,uiLocale,diagnosticText } from './ui-language.js';
import { renderForecastMethod } from './forecast-method-view.js';
import { predictionFromArchive } from './reset-forecast.js';
import { renderResetForecastSummary } from './reset-forecast-summary.js';
import { renderUsageStrategies } from './components/usage-strategies.js';
import { createUsagePlannerState,updateUsagePlanner,activePlannerPrediction } from './usage-planner-state.js';
import { layoutStrategyTree, renderStrategyTree } from './strategy-tree-layout.js';
import { COMPACT_TIMELINE_WIDTH } from './strategy-time-layout.js';
import { workspaceLayout } from './workspace-layout.js';
import { syncPlannerMetadata } from './page-metadata.js';
import { pluginPageClient } from './plugin-page-client.js';
import { BRAND_MARK_SVG } from './brand-mark.js';
import { HOMES,PRODUCT_DOMAIN,PRODUCT_NAME,PRODUCT_NAME_ZH } from './planner-name.js';
import { cardImage,prefersSystemShare,xPostUrl,downloadBlob,copyImage } from './share-card.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const STORAGE_KEY = 'usage-planner-intensity-v1';
const LEGACY_STORAGE_KEYS = ['codex4ever-intensity-v1','pace-simple-input-v4'];
let savedLanguage;
try {savedLanguage=localStorage.getItem(LANGUAGE_STORAGE_KEY)??localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY);}catch {/* Optional storage. */}
const plugin=pluginPageClient();
// /zh/ is the Chinese page whatever was saved; / follows the visitor.
let language=globalThis.location?.pathname===HOMES['zh-CN'] && !plugin ? 'zh-CN' : chooseLanguage({saved:savedLanguage,
  browserLanguages:typeof navigator==='undefined' ? [] : navigator.languages,
  browserLanguage:typeof navigator==='undefined' ? undefined : navigator.language});
const t=(source,values)=>translate(language,source,values);
let statusMessage=null,lastError=null;
const setStatus=message=>{statusMessage=message;$('#status').textContent=t(message);};

// Keep the address on the page for the shown language, so a shared link opens
// in that language. The plugin page has a single local route.
function syncLanguagePath() {
  const path=globalThis.location?.pathname;
  if(plugin||!Object.values(HOMES).includes(path)||path===HOMES[language])return;
  history.replaceState?.(history.state,'',HOMES[language]+location.search+location.hash);
}

function renderStaticLanguage() {
  syncLanguagePath();
  const metadata=syncPlannerMetadata(document,language);
  const heading=$('.brand h1');if(heading)heading.textContent=language==='zh-CN' ? PRODUCT_NAME_ZH : PRODUCT_NAME;
  document.documentElement?.setAttribute('lang',language);
  for(const [selector,label] of [['.affiliation-notice','OpenAI Codex 的非官方可视化用量规划工具。与 OpenAI 无隶属关系。'],['#github-star','GitHub'],['#follow-x','X'],
['#source-code','GitHub 开源'],['[data-credit-label]','感谢'],['[data-credit-suffix]','提供 reset 数据'],['[data-follow-label]','如果你喜欢这个作品，欢迎在 '],['[data-follow-or]',' 或'],['#creator-xiaohongshu','小红书'],['[data-follow-tail]','关注我，或者'],['#share-site','分享给朋友'],['[data-follow-end]','。'],['#calculate','↻ 更新计划'],['[data-plugin-hint]','可安装成 Codex 插件，自动读取以上数据。'],['#plugin-install','安装方法 →'],['#overuse-hint','用量过度提醒（仅 Codex 插件）：在 Codex 里说“打开用量过度提醒”。之后你用得比计划快时，会直接在对话里提醒你。']])
    {const element=$(selector);if(element)element.textContent=t(label);}
  $('#planner-guide').textContent=language==='zh-CN' ? '使用说明' : 'How it works';
  $('#planner-guide').setAttribute?.('href',language==='zh-CN' ? '/zh/guide/' : '/guide/');
  for(const [selector,label] of [['#inputs','算法输入'],['#forecast','预测依据'],['#output','算法输出']])
    $(selector)?.setAttribute?.('aria-label',t(label));
  $('#language-switch').setAttribute?.('aria-label',t('语言'));
  $('#language-switch').innerHTML=[['en','English'],['zh-CN','中文']].map(([value,label])=>
    `<button type="button" data-language="${value}" lang="${value}" aria-pressed="${language===value}">${label}</button>`).join('');
  if(statusMessage)$('#status').textContent=t(statusMessage);
  if(lastError)$('#error').textContent=diagnosticText(language,lastError,'input');
}

let timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
let pluginRevision=null,manualDraft=false;
const localDate = date => new Intl.DateTimeFormat('en-CA', { timeZone,
  year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const today = localDate(new Date());
let input = { weeklyRemaining: 40, weeklyResetDays: 4, weeklyResetHours: 0,
  resetDates: [] };
let renderedWidth=0;
let forecastSource = { available: false, reason: '预测数据暂不可用' };
let calculationRun = 0;
let visibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calendarOpen = false;
let savedPlannerPreferences;
try {
  const saved = JSON.parse([STORAGE_KEY,...LEGACY_STORAGE_KEYS].map(key=>localStorage.getItem(key)).find(Boolean)??'null');
  if (saved) for (const key of Object.keys(input)) if (key in saved) input[key] = saved[key];
  savedPlannerPreferences=saved;
} catch { /* Corrupt local storage falls back to example values. */ }
input.weeklyRemaining = Number(input.weeklyRemaining);
input.weeklyResetDays = Number(input.weeklyResetDays);
input.weeklyResetHours = Number(input.weeklyResetHours);
if (!Number.isInteger(input.weeklyResetDays) || input.weeklyResetDays < 0 || input.weeklyResetDays > 7) input.weeklyResetDays = 2;
if (!Number.isInteger(input.weeklyResetHours) || input.weeklyResetHours < 0 || input.weeklyResetHours > 23) input.weeklyResetHours = 0;
if (input.weeklyResetDays * 24 + input.weeklyResetHours > 168) input.weeklyResetHours = 0;
input.resetDates = [...new Set((Array.isArray(input.resetDates) ? input.resetDates : []).filter(date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today))].slice(0, 8);
// Plans start from the observed pace; a slider value saved by older versions is ignored.
let planner=createUsagePlannerState({timeZone,
  forecastEnabled:savedPlannerPreferences?.forecastEnabled,usageStrategy:savedPlannerPreferences?.usageStrategy,
  // "Assume no reset" replaced the cautious/optimistic choice; an old saved
  // cautious mode would otherwise stick with no control to leave it.
  alertsEnabled:savedPlannerPreferences?.alertsEnabled});

const monthIndex = date => date.getFullYear() * 12 + date.getMonth();
const monthDistance = () => monthIndex(visibleMonth) - monthIndex(new Date());

function calendar() {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const first = new Date(year, month, 1);
  const monthLabel=new Intl.DateTimeFormat(uiLocale(language),{year:'numeric',month:'long'}).format(first);
  const blanks = (first.getDay() + 6) % 7;
  const count = new Date(year, month + 1, 0).getDate();
  const maxDate = localDate(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 365));
  const dates = Array.from({ length: blanks }, () => '<span class="empty-day"></span>');
  for (let day = 1; day <= count; day++) {
    const date = localDate(new Date(year, month, day));
    const backup = input.resetDates.includes(date);
    const disabled = date < today || date > maxDate;
    dates.push(`<button type="button" data-calendar-date="${date}" aria-label="${date}${backup ? t('，备用 reset 到期日') : ''}" aria-pressed="${backup}" ${disabled ? 'disabled' : ''}>${day}</button>`);
  }
  return `<div class="reset-actions"><div class="calendar-summary">${input.resetDates.length ? input.resetDates.slice().sort().map(date => `<button type="button" data-remove-date="${escape(date)}" aria-label="${escape(t('移除备用 reset {date}',{date}))}">${escape(date)} ×</button>`).join('') : ''}</div>
    <button type="button" data-toggle-calendar aria-expanded="${calendarOpen}" aria-controls="reset-calendar">${t(calendarOpen ? '收起日历' : '＋ 添加日期')}</button></div>
  ${calendarOpen ? `<div class="calendar-panel" id="reset-calendar">
    <div class="calendar-head"><strong>${monthLabel}</strong><div><button type="button" data-month-nav="-1" aria-label="${t('上个月')}" ${monthDistance() <= 0 ? 'disabled' : ''}>‹</button><button type="button" data-month-nav="1" aria-label="${t('下个月')}" ${monthDistance() >= 11 ? 'disabled' : ''}>›</button></div></div>
    <div class="month-grid" role="group" aria-label="${t('{month}备用 reset 到期日历',{month:monthLabel})}">${(uiLocale(language)==='zh-CN' ? ['一','二','三','四','五','六','日'] : ['M','T','W','T','F','S','S']).map(day => `<span class="weekday">${day}</span>`).join('')}${dates.join('')}</div>
    <p class="hint">${t('点日期添加或取消；同一天最多一个，到期按当天结束估算。')}</p>
  </div>` : ''}`;
}

// One − / + stepper for every number the user types: quota and refresh time.
function delayControl(field, label, unit, max, {id='',step='1'}={}) {
  return `<div class="delay-control"><button type="button" data-delay-step="${field}" data-delta="-1" aria-label="${t('减少{label}',{label:t(label)})}">−</button><input type="number"${id ? ` id="${id}"` : ''} data-field="${field}" aria-label="${t(label)}" min="0" max="${max}" step="${step}" value="${escape(input[field])}"><span>${t(unit)}</span><button type="button" data-delay-step="${field}" data-delta="1" aria-label="${t('增加{label}',{label:t(label)})}">＋</button></div>`;
}

function renderInputs() {
  $('#inputs').innerHTML = `<div class="compact-form">
    <fieldset class="calendar-field"><legend>${t('备用 reset · {count} 个',{count:input.resetDates.length})}</legend>${calendar()}</fieldset>
    <fieldset class="simple-fields"><legend>${t('当前状态')}</legend>
      <label for="weekly-remaining">${t('本周额度还剩')}</label>${delayControl('weeklyRemaining','本周额度还剩多少 %','%',100,{id:'weekly-remaining',step:'any'})}
      <div class="refresh-row"><div class="refresh-label">${t('正常刷新还有')}</div><div class="delay-controls">${delayControl('weeklyResetDays', '正常刷新剩余天数', '天', 7)}${delayControl('weeklyResetHours', '正常刷新剩余小时', '小时', 23)}</div></div>
    </fieldset>
  </div>`;
}

// Editing only greys the plan; recalculating every step makes the steppers
// lag. The update button then appears over the greyed plan, where you look.
function markChanged() {
  manualDraft=true;
  calculationRun++;
  $('#result').classList.add('stale');
  if($('#calculate'))$('#calculate').hidden=false;
  planner=updateUsagePlanner(planner,{type:'invalidate'});
  renderStrategyControls();
}

function renderStrategyControls() {
  $('#strategy-controls').innerHTML=`<div class="control-heading"><h3 id="strategy-controls-title">${t('用量策略')}</h3><span class="instant-label">${t('即时更新')}</span></div>${renderUsageStrategies({
    selected:planner.intent.usageStrategy,locale:language,disabled:!planner.result?.available},escape)}${forecastSource.available ? `<button type="button" class="no-reset-toggle" role="switch" data-toggle-forecast aria-checked="${!planner.intent.forecastEnabled}"${planner.result?.available ? '' : ' disabled'} title="${escape(t('按下后隐藏预测的 reset，所有策略都按没有额外 reset 来规划。'))}"><span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span>${escape(t('假设没有 reset'))}</button>` : ''}`;
}

function saveInput() {
  if(plugin&&!manualDraft)return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({...input,
    forecastEnabled:planner.intent.forecastEnabled,
    usageStrategy:planner.intent.usageStrategy,availabilityMode:planner.intent.availabilityMode,alertsEnabled:planner.intent.alertsEnabled})); }
  catch { /* Local storage is optional. */ }
}

const round = value => Number(value.toFixed(1));
const MOBILE_TIMELINE_WIDTH=640;
// The stamp is added to shared pictures only, not shown on the page: the
// domain tells people where to go, and in Chinese the Chinese name too,
// which is what people search on Xiaohongshu.
const brandStamp=()=>`<div class="brand-stamp" aria-hidden="true"><span>${BRAND_MARK_SVG}</span>${language==='zh-CN' ? `<em><b>${PRODUCT_NAME_ZH}</b><i>·</i>` : '<em>'}${PRODUCT_DOMAIN}</em></div>`;

// One-tap sharing of the forecast card as a picture (it carries the stamp).
const shareControl=()=>`<div class="share-control" data-share-control><button type="button" class="share-card-button" aria-haspopup="menu" aria-expanded="false">${t('分享')}</button>
  <div class="share-menu" role="menu" hidden><button type="button" role="menuitem" data-share-action="x">${t('发到 X')}</button><button type="button" role="menuitem" data-share-action="copy">${t('复制图片')}</button><button type="button" role="menuitem" data-share-action="download">${t('下载图片')}</button>${globalThis.navigator?.canShare ? `<button type="button" role="menuitem" data-share-action="system">${t('更多…')}</button>` : ''}</div></div>`;
// The public page in the shown language; the plugin page lives on localhost.
const publicPageUrl=()=>`${plugin||!globalThis.location?.origin ? `https://${PRODUCT_DOMAIN}` : location.origin}${HOMES[language]}`;
let sharedCard=null;

// On the page the odds read "Chance of a reset in the next / 12h"; alone in a
// picture they read better as a title carrying the unit, with "within 12h"
// over each bare figure.
function shareWording(frame) {
  const title=frame.querySelector('[data-forecast-glance="next-hours"]>dt');
  if(title&&!frame.querySelector('[data-forecast-horizon=announced]'))title.textContent=t('额外 reset 的概率（%）');
  for(const item of frame.querySelectorAll('[data-forecast-horizon]')) {
    const hours=item.dataset.forecastHorizon;
    if(!/^\d+$/.test(hours))continue;
    item.querySelector('small').textContent=t('{hours} 小时内',{hours});
    // The unit sits once in the title, not after every figure.
    const figure=item.querySelector('b');figure.textContent=figure.textContent.replace(/%$/,'');
  }
}

async function shareForecastCard(button) {
  const control=button.closest('[data-share-control]'),menu=control.querySelector('.share-menu');
  if(!menu.hidden) {menu.hidden=true;button.setAttribute('aria-expanded','false');return;}
  button.setAttribute('aria-busy','true');
  try {
    const blob=await cardImage($('#forecast'),{stamp:brandStamp(),adjust:shareWording});
    const file=new File([blob],language==='zh-CN' ? '赛博牛马规划器.png' : 'usage-planner.png',{type:'image/png'});
    sharedCard={blob,file,text:t('Codex 下次 reset 大概什么时候来、每天用多少，用赛博牛马规划器看看'),url:publicPageUrl()};
    if(prefersSystemShare(file)) {
      try {await navigator.share({files:[file],text:`${sharedCard.text} ${sharedCard.url}`});}
      catch { /* Dismissed share sheet: nothing to do. */ }
      return;
    }
    menu.hidden=false;button.setAttribute('aria-expanded','true');
    menu.querySelector('button')?.focus();
  } catch {
    button.textContent=t('生成图片失败');setTimeout(()=>{button.textContent=t('分享');},2500);
  } finally {button.removeAttribute('aria-busy');}
}

async function runShareAction(action,item) {
  if(!sharedCard)return;
  const {blob,file,text,url}=sharedCard,label=item.textContent;
  const flash=message=>{item.textContent=message;setTimeout(()=>{item.textContent=label;},2500);};
  if(action==='download')downloadBlob(blob,file.name);
  else if(action==='copy')flash(t(await copyImage(blob) ? '已复制图片' : '复制失败，请下载'));
  else if(action==='x') {
    // X post links carry text only: copy the picture first so it can be pasted.
    const copied=await copyImage(blob);
    globalThis.open?.(xPostUrl(text,url),'_blank','noopener');
    flash(t(copied ? '图片已复制，在 X 里粘贴' : '请先下载图片'));
  } else if(action==='system') {
    try {await navigator.share({files:[file],text:`${text} ${url}`});}catch { /* Dismissed. */ }
  }
}

$('#forecast')?.addEventListener?.('click',event=>{
  const button=event.target.closest?.('.share-card-button');
  if(button) {shareForecastCard(button);return;}
  const item=event.target.closest?.('[data-share-action]');
  if(item)runShareAction(item.dataset.shareAction,item);
});
document.addEventListener?.('click',event=>{
  if(event.target.closest?.('[data-share-control]'))return;
  for(const menu of document.querySelectorAll?.('.share-menu:not([hidden])')??[]) {
    menu.hidden=true;menu.previousElementSibling?.setAttribute('aria-expanded','false');
  }
});
document.addEventListener?.('keydown',event=>{
  if(event.key!=='Escape')return;
  const menu=document.querySelector?.('.share-menu:not([hidden])');
  if(menu) {menu.hidden=true;menu.previousElementSibling?.setAttribute('aria-expanded','false');menu.previousElementSibling?.focus();}
});

function renderForecastCard(graph=null) {
  const planningPrediction=activePlannerPrediction(planner),planningNow=new Date(planner.snapshot.now);
  // The chance tiles stay while "Assume no reset" is on: the forecast still
  // exists, the plan just does not count it, and the card keeps its height.
  const forecastSummary = renderResetForecastSummary({ source: forecastSource, prediction: planner.snapshot.prediction,
    timeZone, now: planningNow,locale:language });
  $('#forecast').innerHTML = `<div class="forecast-control" ${planningPrediction ? `data-forecast-48-probability="${planningPrediction.next48Probability}"` : ''}><span>${t('额外 reset 预测')}</span></div>${forecastSummary}${shareControl()}`;
}

// Keep pace is the one strategy built on the current pace, so only it notes
// when that pace rests on under an hour of use, or on none yet.
const paceNote=result=>result.usageStrategy!=='balanced' ? ''
  : result.shortHistory ? `<p class="pace-note">${t('本轮使用不到 1 小时，当前速度可能不具代表性。')}</p>`
    : result.evenSplit ? `<p class="pace-note">${t('本轮还没用过额度，先按平均分配到正常刷新来算。')}</p>` : '';

// The plan's conclusion in one line: what to do from now. Later stretches
// depend on resets arriving, and the slope below already shows them.
function planSummary(result) {
  const day=value=>new Intl.DateTimeFormat(uiLocale(language),{timeZone,month:language==='zh-CN' ? 'numeric' : 'short',day:'numeric'})
    .format(new Date(value)).replace(/月/,'/').replace(/日/,'');
  const stretches=[];
  for(const phase of result.phasePlans??[]) {
    const kind=phase.plannedRest ? 'rest' : phase.dailyPercent>0.05 ? 'use' : 'out';
    const percent=Number(phase.dailyPercent.toFixed(1)),last=stretches.at(-1);
    if(last&&last.kind===kind&&(kind!=='use'||last.percent===percent))last.endAt=phase.endAt;
    else stretches.push({kind,percent,startAt:phase.startAt,endAt:phase.endAt});
  }
  const [now,...later]=stretches;
  if(!now)return '';
  const next=later.find(stretch=>stretch.kind==='use');
  // The daily figure is the answer: set it in bold within the sentence.
  const mark='\u0000',figure=percent=>`<b class="plan-figure">${percent}%</b>`;
  const [key,values]=now.kind==='use' ? ['现在到 {date}，每天用 {percent}%',{date:day(Date.parse(now.endAt)-1),percent:now.percent}]
    : now.kind==='rest' ? next ? ['今天不用，{date} 起每天 {percent}%',{date:day(next.startAt),percent:next.percent}] : ['今天不用',{}]
      : next ? ['额度已用完，{date} 补满后每天 {percent}%',{date:day(next.startAt),percent:next.percent}] : ['额度已用完，等补满',{}];
  const text=escape(t(key,{...values,percent:mark})).replace(`${mark}%`,()=>figure(values.percent));
  return `<p class="plan-summary"><strong>${t('建议：')}</strong>${text}</p>`;
}

function renderResult(availableWidth=$('#result').clientWidth) {
  const result=planner.result;
  if(!result)return;
  const planningPrediction=activePlannerPrediction(planner),planningNow=new Date(planner.snapshot.now);
  $('#result').classList.remove('stale');
  const workspace=workspaceLayout(availableWidth);
  renderedWidth=workspace.width;
  renderStrategyControls();
  if (!result.available) {
    renderForecastCard();
    $('#result').innerHTML = `<p class="empty-result">${escape(diagnosticText(language,result.reason,'input'))}</p>`;
    $('#method').innerHTML='';
    return;
  }
  const graph = layoutStrategyTree(result, { expandedLevel: null, prediction: planningPrediction,
    // Phones fit the whole horizon to the screen (lane names move above their
    // rows); mid widths keep a wider canvas that scrolls sideways.
    viewportWidth:availableWidth<COMPACT_TIMELINE_WIDTH ? workspace.timelineWidth
      : Math.max(workspace.timelineWidth,availableWidth<680 ? MOBILE_TIMELINE_WIDTH : 0),
    displayEndHours:planner.displayEndHours,locale:language });
  renderForecastCard(graph);
  const policyData=result.recommendation ? ` data-policy-search="${result.recommendation.method}"${result.recommendation.primary ? ' data-plan-basis="predicted-extra-resets-first"' : ''}` : '';
  $('#result').innerHTML = `<section class="strategy-panel" aria-label="${t('用量计划')}"${policyData} style="--panel-padding:${workspace.panelPadding}px">
    ${result.recommendation&&!result.recommendation.primary ? `<div class="timeline-toolbar"><span>${t('假设没有额外 reset')}</span></div>` : ''}
    ${paceNote(result)}
    ${planSummary(result)}
    ${renderStrategyTree(graph, escape)}
    </section>`;
  $('#method').innerHTML=renderForecastMethod({source:forecastSource,prediction:planningPrediction,result,timeZone,locale:language},escape);
}


// The switch's square, turning until a plan is ready (index.html shows the
// same square page-wide on first load, before any script runs).
const loadingResult=()=>`<div class="plan-loading" role="status"><span class="busy-square" aria-hidden="true"></span>${escape(t('正在计算…'))}</div>`;

// Replanning takes a moment: paint the busy marker first, then compute, so a
// click never looks ignored. Without a browser frame (tests) it runs at once.
function busyDispatch(action) {
  const host=$('#strategy-controls');
  const run=()=>{dispatchPlanning(action);saveInput();host.removeAttribute?.('aria-busy');};
  if(typeof requestAnimationFrame!=='function')return run();
  host.setAttribute('aria-busy','true');
  requestAnimationFrame(()=>setTimeout(run,0));
}

function dispatchPlanning(action) {
  planner=updateUsagePlanner(planner,action);
  renderResult();
}

async function bundledPrediction(now) {
  // Local server → snapshot precomputed by the static site build → bundled archive.
  // A static host may answer a missing path with the HTML page and status 200,
  // so only a parsed JSON archive counts; anything else falls through.
  const local=!globalThis.location||/^(localhost|127\.0\.0\.1|\[::1\])$/.test(globalThis.location.hostname);
  const paths=['/api/reset-evidence','/data/reset-evidence.json','/experiments/public-reset-events.json'].slice(local ? 0 : 1);
  for(const path of paths) {
    let archive=null;
    try {
      const response=await fetch(path);
      if(response.ok)archive=await response.json();
    } catch { archive=null; }
    if(Array.isArray(archive?.events))return predictionFromArchive({ archive, now, timeZone });
  }
  return { available: false, reason: '历史数据加载失败，暂不预测' };
}

async function calculate() {
  const run = ++calculationRun;
  $('#error').hidden = true;
  lastError=null;
  try {
    if(plugin&&!manualDraft) {
      const update=await plugin.refresh({timeZone,language,usageStrategy:planner.intent.usageStrategy,
        paceMultiplier:planner.intent.targetMultiplier,forecastEnabled:planner.intent.forecastEnabled,
        availabilityMode:planner.intent.availabilityMode,alertsEnabled:planner.intent.alertsEnabled});
      if(run===calculationRun)importPluginPlan(update);
      return;
    }
    const now = new Date();
    let publicForecast = { available: false, reason: '预测数据暂不可用' };
    try { publicForecast = await bundledPrediction(now); } catch { /* Keep the known-resource plan. */ }
    if (run !== calculationRun) return;
    forecastSource = publicForecast;
    planner=updateUsagePlanner(planner,{type:'new-snapshot',input,now,prediction:publicForecast.prediction});
    renderResult();
    if($('#calculate'))$('#calculate').hidden=true;
    setStatus('');
    saveInput();
  } catch (error) {
    if (run !== calculationRun) return;
    planner=updateUsagePlanner(planner,{type:'invalidate'});
    $('#result').classList.add('stale');
    renderStrategyControls();
    lastError=error.message;
    $('#error').textContent=diagnosticText(language,lastError,'input');
    $('#error').hidden = false;
    setStatus('请检查输入');
  }
}

function importPluginPlan({revision,session}) {
  if(!session)return;
  planner=updateUsagePlanner(planner,{type:'import-mcp-plan',session});
  pluginRevision=revision;manualDraft=false;timeZone=planner.timeZone;
  if(!savedLanguage&&supportedLanguage(session.language))language=session.language;
  input=structuredClone(planner.snapshot.input);
  forecastSource=session.forecastSource;
  lastError=null;$('#error').hidden=true;
  renderStaticLanguage();renderInputs();renderResult();
  setStatus(language==='zh-CN' ? '已连接本地 MCP' : 'Connected to local MCP');
}

async function startPluginPage() {
  try {
    const update=await plugin.read();
    importPluginPlan(update.session ? update : await plugin.refresh());
  }catch(error){
    $('#error').hidden=false;$('#error').textContent=error.message;
    setStatus(language==='zh-CN' ? '请从 Codex 重新打开规划页' : 'Reopen the planner from Codex');
  }
  // Poll only the in-memory result revision, never the account or public sites.
  const poll=async()=>{
    try {if(!document.hidden) {
      const update=await plugin.read(pluginRevision);
      if(update.session&&update.revision!==pluginRevision)importPluginPlan(update);
    }}catch {setStatus(language==='zh-CN' ? 'MCP 已断开 · 当前为上次结果' : 'MCP disconnected · Last snapshot');}
    setTimeout(poll,5000);
  };
  setTimeout(poll,5000);
}

$('#inputs').addEventListener('input', event => {
  const field = event.target.dataset.field;
  if (!Object.hasOwn(input,field)) return;
  input[field] = event.target.value === '' ? NaN : Number(event.target.value);
  markChanged();
});

$('#inputs').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || !$('#inputs').contains(button)) return;
  const data = button.dataset;
  if (data.delayStep === 'weeklyRemaining') {
    const current = Number.isFinite(input.weeklyRemaining) ? Math.round(input.weeklyRemaining) : 0;
    input.weeklyRemaining = Math.max(0, Math.min(100, current + Number(data.delta)));
    renderInputs();
    markChanged();
    return;
  }
  if (data.delayStep) {
    const total = input.weeklyResetDays * 24 + input.weeklyResetHours + Number(data.delta) * (data.delayStep === 'weeklyResetDays' ? 24 : 1);
    if (Number.isInteger(total) && total >= 1 && total <= 168) {
      input.weeklyResetDays = Math.floor(total / 24);
      input.weeklyResetHours = total % 24;
      renderInputs();
      markChanged();
    }
    return;
  }
  if (data.toggleCalendar !== undefined) calendarOpen = !calendarOpen;
  else if (data.monthNav) visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + Number(data.monthNav), 1);
  else if (data.calendarDate) {
    const index = input.resetDates.indexOf(data.calendarDate);
    if (index >= 0) input.resetDates.splice(index, 1);
    else {
      if (input.resetDates.length >= 8) { setStatus('最多选择 8 个备用 reset 日期'); return; }
      input.resetDates.push(data.calendarDate);
    }
    calendarOpen = false;
  } else if (data.removeDate) input.resetDates = input.resetDates.filter(date => date !== data.removeDate);
  else return;
  renderInputs();
  if (!data.monthNav && data.toggleCalendar === undefined) markChanged();
});

// The refresh button spins the same square as the no-reset switch while the
// plan is recomputed, then hides once the new plan is shown.
$('#calculate').addEventListener('click',async()=>{
  const button=$('#calculate');
  if(button.getAttribute?.('aria-busy')==='true')return;
  if(typeof requestAnimationFrame!=='function')return calculate();
  button.setAttribute('aria-busy','true');button.textContent=t('更新中…');
  await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
  try {await calculate();}
  finally {button.removeAttribute('aria-busy');button.textContent=t('↻ 更新计划');}
});
// Share: the system sheet where there is one, otherwise copy the link.
$('#share-site')?.addEventListener?.('click',async()=>{
  // The plugin page lives on localhost; share the public site instead.
  const origin=plugin||!globalThis.location?.origin ? `https://${PRODUCT_DOMAIN}` : location.origin;
  const url=origin+HOMES[language];
  try {
    if(navigator.share)await navigator.share({title:language==='zh-CN' ? PRODUCT_NAME_ZH : PRODUCT_NAME,url});
    else {await navigator.clipboard.writeText(url);$('#share-site').textContent=t('已复制链接');
      setTimeout(()=>{$('#share-site').textContent=t('分享给朋友');},2000);}
  } catch { /* Dismissed share sheet or blocked clipboard: nothing to do. */ }
});
function handlePlanClick(event) {
  if (!planner.result) return;
  const availability=event.target.closest('button[data-availability-mode]');
  if(availability) {
    dispatchPlanning({type:'set-availability-mode',mode:availability.dataset.availabilityMode});
    saveInput();return;
  }
  const strategy=event.target.closest('[data-usage-strategy]');
  if(strategy) {busyDispatch({type:'set-strategy',strategy:strategy.dataset.usageStrategy});return;}
  if (event.target.closest('[data-toggle-forecast]')) {busyDispatch({type:'toggle-forecast'});return;}
  const assumptionButton=event.target.closest('[data-assume-reset]');
  if(assumptionButton) {
    dispatchPlanning({type:'toggle-assumption',sequence:assumptionButton.dataset.assumptionSequence});
    return;
  }
  const backup = event.target.closest('[data-backup-choice]');
  if (backup) {
    dispatchPlanning({type:'toggle-bank',index:backup.dataset.backupChoice});
    return;
  }
}
$('#result').addEventListener('click',handlePlanClick);
$('#strategy-controls').addEventListener('click',handlePlanClick);
$('#forecast').addEventListener('click',handlePlanClick);
const resizeResult=width=>{
  if(planner.result&&width>0&&Math.abs(width-renderedWidth)>=2)renderResult(width);
};
if(typeof ResizeObserver==='function')new ResizeObserver(entries=>{
  const width=Math.round(entries[0]?.contentRect.width??0);
  resizeResult(width);
}).observe($('#result'));
if(typeof window!=='undefined')window.addEventListener('resize',()=>resizeResult($('#result').clientWidth));
// Keep lane labels in view while a scrollable timeline moves underneath them.
$('#result').addEventListener?.('scroll',event=>{
  const scroller=event.target;
  if(!scroller.classList?.contains('tree-scroll'))return;
  const shift=scroller.scrollLeft ? `translateX(${scroller.scrollLeft}px)` : '';
  const labels=scroller.querySelectorAll('.timeline-lane-label');
  let cover=scroller.querySelector('.lane-cover');
  if(!cover&&labels.length) {
    cover=document.createElement('div');cover.className='lane-cover';
    cover.style.width=`${labels[0].offsetLeft+labels[0].offsetWidth+8}px`;
    scroller.querySelector('.strategy-graph')?.prepend(cover);
  }
  if(cover){cover.hidden=!shift;cover.style.transform=shift;}
  for(const label of labels)label.style.transform=shift;
},true);
$('#language-switch').addEventListener('click',event=>{
  const button=event.target.closest('[data-language]');
  const selected=supportedLanguage(button?.dataset.language);
  if(!selected||selected===language)return;
  language=selected;
  savedLanguage=selected;
  try {localStorage.setItem(LANGUAGE_STORAGE_KEY,language);}catch {/* Optional storage. */}
  renderStaticLanguage();
  renderInputs();
  if(planner.result)renderResult();
  else {
    renderStrategyControls();
    $('#result').innerHTML=statusMessage==='已修改，请重新计算' ? t(statusMessage) : loadingResult();
  }
});
renderStaticLanguage();
renderStrategyControls();
renderInputs();
// The plugin reads quota itself; the install hint is for the website.
if(plugin&&$('#plugin-hint'))$('#plugin-hint').hidden=true;
if(plugin&&$('#overuse-hint'))$('#overuse-hint').hidden=false;
// The page stays behind its loader until the first plan or error is ready.
// Planning blocks the main thread for a few seconds, so paint a frame first:
// once started, the square keeps turning on the compositor during the work.
const nextFrame=()=>new Promise(resolve=>typeof requestAnimationFrame==='function'
  ? requestAnimationFrame(()=>setTimeout(resolve,0)) : resolve());
nextFrame().then(()=>plugin ? startPluginPage() : calculate())
  .finally(()=>document.body?.removeAttribute?.('data-loading'));
