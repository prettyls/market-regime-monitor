import { baseStyles } from "./styles.js";
export const calendarHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Realized P/L Calendar</title><style>${baseStyles}
.chart-scroll {overflow-x:auto} #pnl-chart {display:block;width:100%;min-width:520px;height:auto} #pnl-chart text {font-family:inherit;font-size:12px;fill:var(--muted)}
.calendar {display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.day {min-height:90px;border:1px solid var(--border);border-radius:6px;padding:8px;display:grid;align-content:start;gap:6px;font-size:13px}
.weekday {text-align:center;color:var(--muted);padding:8px 0;font-size:12px}
.gain {color:var(--normal)} .loss {color:var(--alert)} .note {color:var(--muted);font-size:13px}
.day.today {outline:2px solid #2563eb} .amount {font-weight:650;overflow-wrap:anywhere}
@media(max-width:600px){main{padding:10px}.day{padding:4px;min-height:78px;font-size:11px}.note{font-size:11px}}
</style></head><body><header><h1>Realized P/L Calendar</h1><a href="/">Back to monitor</a></header>
<main><section><h2>Author’s account · estimated realized gains and losses</h2><p class="note">USD · America/New_York. FIFO estimates from actual account transactions, including reported fees. Syncs after the market closes. This page refreshes hourly. Open-position gains and losses are excluded.</p>
<p id="coverage" class="note"></p><div class="controls"><button id="previous" aria-label="Previous month">←</button><label>Month<input id="month" type="month"></label><button id="next" aria-label="Next month">→</button><button id="refresh" class="secondary">Refresh</button></div>
<p id="message" role="status" aria-live="polite"></p><h2 id="total"></h2><div id="calendar" class="calendar" aria-label="Daily realized profit and loss"></div><p class="note">— means no transaction data is available. Incomplete means cost basis or transaction support is missing. $0.00 means observed transactions produced no realized gain or loss.</p></section><section><h2>Aggregate realized gain/loss</h2><p class="note">Cumulative estimated USD realized P/L within the available transaction history through the selected month. Hover or focus a point for its date and total.</p><p id="chart-message" role="status"></p><div class="chart-scroll"><svg id="pnl-chart" viewBox="0 0 900 340" role="img" aria-label="Cumulative realized gain and loss over time"></svg></div></section></main>
<script>
(function(){
var $=function(id){return document.getElementById(id)}, version=0;
var today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
$('month').value=today.slice(0,7);
function money(value){if(value===null)return 'Incomplete';return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',signDisplay:'exceptZero'}).format(Number(value));}
function node(tag,text,cls){var n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;}
function chart(series){
series=series.filter(function(p){return p.realizedPnl!==null});var svg=$('pnl-chart');svg.replaceChildren();$('chart-message').textContent=series.length?'':'No complete transaction history available to chart.';
if(!series.length)return;
function shape(tag,attrs,text){var n=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.keys(attrs).forEach(function(k){n.setAttribute(k,attrs[k]);});if(text!==undefined)n.textContent=text;svg.append(n);return n;}
var values=series.map(function(p){return Number(p.realizedPnl)}), low=Math.min(0,...values), high=Math.max(0,...values);
if(low===high){low-=1;high+=1;}
var padding=(high-low)*0.08;low-=padding;high+=padding;
var start=Date.parse(series[0].date+'T00:00:00Z'), end=Date.parse(series[series.length-1].date+'T00:00:00Z');
function x(p){return end===start?480:100+(Date.parse(p.date+'T00:00:00Z')-start)/(end-start)*760;}
function y(v){return 270-(v-low)/(high-low)*240;}
for(var i=0;i<=4;i++){var value=low+(high-low)*i/4, pos=y(value);shape('line',{x1:100,x2:860,y1:pos,y2:pos,stroke:'#e5e7eb'});shape('text',{x:90,y:pos+4,'text-anchor':'end'},money(value));}
shape('line',{x1:100,x2:860,y1:y(0),y2:y(0),stroke:'#9ca3af','stroke-dasharray':'4 4'});
shape('polyline',{points:series.map(function(p){return x(p)+','+y(Number(p.realizedPnl))}).join(' '),fill:'none',stroke:'#2563eb','stroke-width':2.5});
series.forEach(function(p){var label=p.date+': '+money(p.realizedPnl), point=shape('circle',{cx:x(p),cy:y(Number(p.realizedPnl)),r:4,fill:'#2563eb',tabindex:0,'aria-label':label});var title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=label;point.append(title);});
var ticks=[series[0]];if(series.length>2)ticks.push(series[Math.floor((series.length-1)/2)]);if(series.length>1)ticks.push(series[series.length-1]);
ticks.forEach(function(p){shape('text',{x:x(p),y:292,'text-anchor':'middle'},p.date);});
shape('text',{x:480,y:326,'text-anchor':'middle'},'Time (trading date)');shape('text',{x:100,y:16},'Aggregate gain/loss (USD)');
}
async function load(){
var month=$('month').value;if(!/^\\d{4}-(0[1-9]|1[0-2])$/.test(month))return;
var current=++version;$('message').textContent='Loading account transactions…';$('total').textContent='';$('coverage').textContent='';$('calendar').replaceChildren();$('pnl-chart').replaceChildren();$('chart-message').textContent='Loading…';
try{var response=await fetch('/api/v1/trading/calendar?month='+encodeURIComponent(month));if(!response.ok)throw new Error('Unable to load account P/L. Please try again later.');var data=await response.json();if(current!==version)return;
var parts=month.split('-').map(Number), first=new Date(Date.UTC(parts[0],parts[1]-1,1)), count=new Date(Date.UTC(parts[0],parts[1],0)).getUTCDate();
['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(function(d){$('calendar').append(node('div',d,'weekday'));});
for(var blank=0;blank<first.getUTCDay();blank++)$('calendar').append(node('div',''));
for(var day=1;day<=count;day++){var date=month+'-'+String(day).padStart(2,'0'), record=data.days.find(function(d){return d.date===date}), cell=node('div','','day'+(date===today?' today':''));cell.append(node('span',String(day)));cell.append(node('span',record?money(record.realizedPnl):'—','amount'+(record?(record.realizedPnl!==null && Number(record.realizedPnl)>0?' gain':record.realizedPnl!==null && Number(record.realizedPnl)<0?' loss':''):'')));if(record)cell.append(node('span',record.closingTrades+' closing trades','note'));cell.setAttribute('aria-label',date+': '+(record?money(record.realizedPnl):'No transaction data'));$('calendar').append(cell);}
chart(data.cumulativeSeries);$('coverage').textContent='History starts '+data.historyStart+' · Last synced '+data.updatedAt+'. '+data.warning;
$('total').textContent='Month estimated realized P/L: '+money(data.totalRealizedPnl);$('message').textContent=data.days.length?'Days with observed transactions: '+data.days.length:'No observed transactions for this month.';
}catch(error){if(current===version){$('message').textContent=error.message;$('chart-message').textContent='Chart unavailable. Please refresh to try again.';}}}
function move(offset){var parts=$('month').value.split('-').map(Number), d=new Date(Date.UTC(parts[0],parts[1]-1+offset,1));$('month').value=d.toISOString().slice(0,7);load();}
$('previous').onclick=function(){move(-1)};$('next').onclick=function(){move(1)};$('month').onchange=load;$('refresh').onclick=load;setInterval(load,3600000);load();
})();
</script></body></html>`;
