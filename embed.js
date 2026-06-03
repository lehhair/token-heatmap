var PIE_COLORS = ["#5470c6","#91cc75","#fac858","#ee6666","#73c0de","#3ba272","#fc8452","#9a60b4","#ea7ccc"];
var MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
var TOKEN_COLORS = {Input:"#58a6ff",Output:"#3fb950","Cache Read":"#79c0ff","Cache Write":"#d2a8ff",Reasoning:"#ffa657"};

function fmtTokens(v) {
  if (v >= 1e9) return (v/1e9).toFixed(1).replace(/\.0$/,"")+"B";
  if (v >= 1e6) return (v/1e6).toFixed(1).replace(/\.0$/,"")+"M";
  if (v >= 1e3) return (v/1e3).toFixed(1).replace(/\.0$/,"")+"K";
  return String(v);
}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function fmtDuration(sec){var h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60);return h?h+"h "+m+"m":m+"m"}

function tokenLevel(tokens,thresholds){
  if(tokens<=0)return 0;
  if(tokens<=thresholds[0])return 1;
  if(tokens<=thresholds[1])return 2;
  if(tokens<=thresholds[2])return 3;
  return 4;
}
function getStartDate(){
  var today=new Date();
  var sd=new Date(today.getFullYear(),today.getMonth()-11,1);
  while(sd.getDay()!==1)sd.setDate(sd.getDate()+1);
  return sd;
}
function isDark(){
  var theme=document.documentElement.getAttribute('data-theme');
  if(theme&&theme!=='light')return true;
  if(theme==='light')return false;
  var scheme=document.documentElement.getAttribute('data-color-scheme');
  if(scheme==='dark')return true;
  if(scheme==='light')return false;
  return window.matchMedia('(prefers-color-scheme:dark)').matches;
}

class OpenCodeTokenHeatmap extends HTMLElement {
  constructor() {
    super();
    this._dailyMap = {};
    this._donutData = null;
    this._sel = -1;
    this._themeObserver = null;
    this._themeListenerAttached = false;
    this._colorSchemeMediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    this._handleThemeChange = this._updateTheme.bind(this);
    this.attachShadow({mode:'open'});
  }
  connectedCallback() {
    var css = `
:host{--ht-main:#334155;--ht-stat:#24292f;--ht-tooltip:#24292f;--ht-tooltip-bg:#fff;--ht-tooltip-border:#ccc;--ht-detail-bg:#f6f8fa;--ht-detail-fg:#24292f;--ht-detail-border:#d0d7de;--ht-detail-shadow:rgba(0,0,0,.12);--ht-lv-0:#ebedf0;--ht-lv-1:#9be9a8;--ht-lv-2:#40c463;--ht-lv-3:#30a14e;--ht-lv-4:#216e39;display:block;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;width:100%;max-width:960px;text-align:left;background:transparent!important;color:var(--ht-main)}
:host([data-theme="dark"]){--ht-main:#94a3b8;--ht-stat:#e6edf3;--ht-tooltip:#fff;--ht-tooltip-bg:#333;--ht-tooltip-border:#555;--ht-detail-bg:#161b22;--ht-detail-fg:#c9d1d9;--ht-detail-border:#30363d;--ht-detail-shadow:rgba(0,0,0,.4);--ht-lv-0:#161b22;--ht-lv-1:#0e4429;--ht-lv-2:#006d32;--ht-lv-3:#26a641;--ht-lv-4:#39d353}
.stats{display:flex;flex-wrap:nowrap;gap:0;margin-bottom:12px;background:transparent;width:100%}
.stat{flex:1 0 0;min-width:88px;text-align:center;padding:3px 2px;box-sizing:border-box}
.stat-value{display:block;font-size:13px;font-weight:600;letter-spacing:-0.3px;color:var(--ht-stat)}
.stat-label{font-size:8px;font-weight:400;color:#8b949e;letter-spacing:0.3px}
.heatmap_container{display:flex;flex-direction:column;font-size:10px;line-height:10px;align-items:flex-start;max-width:fit-content;background:transparent;color:var(--ht-main)}
.heatmap_content{display:flex;flex-direction:row;align-items:flex-end;overflow-x:auto;overflow-y:hidden;background:transparent}
.heatmap_week{display:flex;flex-direction:column;justify-content:flex-start;align-items:flex-end;text-align:right}
.heatmap_content>.heatmap_week span{margin-right:0.25rem;margin-top:0;min-width:22px;white-space:nowrap;height:12px}
.heatmap_main{display:flex;flex-direction:column}
@media(max-width:1200px){.heatmap_content{max-width:100%}}
.heatmap_month{display:flex;flex-direction:row;justify-content:space-around;align-items:flex-end;text-align:right;margin-bottom:2px}
.heatmap{display:flex;flex-direction:row;height:84px}
.heatmap_footer{display:flex;margin-top:0.5rem;align-self:flex-end;min-width:113px;white-space:nowrap;margin-left:auto}
.heatmap_level{display:flex;gap:2px;margin:0 0.25rem;flex-direction:row;width:max-content;height:10px;align-self:flex-end}
.heatmap_level_item{display:block;border-radius:0.125rem;width:10px;height:10px}
.heatmap_level_0,.heatmap_day_level_0{background:var(--ht-lv-0)}
.heatmap_level_1,.heatmap_day_level_1{background:var(--ht-lv-1)}
.heatmap_level_2,.heatmap_day_level_2{background:var(--ht-lv-2)}
.heatmap_level_3,.heatmap_day_level_3{background:var(--ht-lv-3)}
.heatmap_level_4,.heatmap_day_level_4{background:var(--ht-lv-4)}
.heatmap_day{width:10px;height:10px;margin:1px;border-radius:2px;display:inline-block;position:relative;cursor:default}
.heatmap_tooltip{position:fixed;font-size:12px;line-height:16px;padding:8px;border-radius:3px;white-space:pre-wrap;z-index:10000;text-align:right;pointer-events:none;background:var(--ht-tooltip-bg);color:var(--ht-tooltip);border:1px solid var(--ht-tooltip-border)}
@keyframes grow{0%{transform:scale(0)}60%{transform:scale(1.12)}100%{transform:scale(1)}}
.heatmap_day_grow{animation:grow .5s cubic-bezier(.34,1.56,.64,1) both}
.error{text-align:center;padding:60px 0;color:#cf222e;font-size:14px}
.detail_panel{position:fixed;padding:12px 14px;background:var(--ht-detail-bg);border-radius:6px;border:1px solid var(--ht-detail-border);box-shadow:0 4px 12px var(--ht-detail-shadow);font-size:12px;color:var(--ht-detail-fg);text-align:left;z-index:1000;width:320px;max-width:calc(100vw - 8px);box-sizing:border-box}
.detail_panel h3{font-size:12px;font-weight:600;margin-bottom:8px}
.detail_summary{display:flex;gap:10px;margin-bottom:8px;flex-wrap:wrap}
.detail_summary span{white-space:nowrap}
.token_list{display:flex;gap:4px;margin-bottom:8px;align-items:flex-end;height:40px}
.token_col{flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end}
.token_bar_wrap{width:100%;flex:1;display:flex;align-items:flex-end;justify-content:center}
.token_bar{width:100%;border-radius:2px;min-height:2px}
.token_label{font-size:8px;color:#8b949e;margin-top:2px;white-space:nowrap}
.token_val{font-size:9px;font-weight:600;margin-bottom:1px}
.donut-wrap{display:flex;flex-direction:column;align-items:center;width:100%;margin:0 0 6px}
.donut-svg{overflow:visible;display:block}
.donut-slice{cursor:pointer;transition:transform .25s cubic-bezier(.34,1.56,.64,1),filter .2s ease,opacity .2s ease}
.donut-slice.is-hovered{filter:drop-shadow(0 4px 12px rgba(0,0,0,.3))}
.model-legend{max-height:130px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;padding-right:2px}
.model-legend::-webkit-scrollbar{width:4px}
.model-legend::-webkit-scrollbar-thumb{background:#8b949e;border-radius:2px}
.model-legend-row{display:flex;align-items:center;gap:6px;padding:1px 0;cursor:pointer;transition:opacity .2s ease}
.model-legend-row:hover{opacity:.8}
.model-legend-row.is-active{background:rgba(84,112,198,.12);border-radius:4px;padding-left:4px}
.model-other{opacity:.75;font-style:italic}
.model-dot{width:8px;height:8px;border-radius:2px;flex-shrink:0}
.model-name{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.model-pct{font-size:11px;font-weight:600;flex-shrink:0;width:42px;text-align:right}
.detail_close{float:right;cursor:pointer;font-size:16px;opacity:.5;margin-left:12px}
.detail_close:hover{opacity:1}
`;
    this.shadowRoot.innerHTML = '<style>'+css+'</style>'+this._buildHTML();
    this._generateMonthLabels();
    this._generateGrid();
    this._startThemeSync();
    this._fetch();
  }
  disconnectedCallback() {
    if(this._themeObserver){this._themeObserver.disconnect();this._themeObserver=null;}
    if(this._themeListenerAttached&&this._colorSchemeMediaQuery){
      if(this._colorSchemeMediaQuery.removeEventListener)this._colorSchemeMediaQuery.removeEventListener('change',this._handleThemeChange);
      else if(this._colorSchemeMediaQuery.removeListener)this._colorSchemeMediaQuery.removeListener(this._handleThemeChange);
      this._themeListenerAttached=false;
    }
  }
  _buildHTML() {
    var h = '';
    h += '<div class="heatmap_container">';
    h += '<div class="heatmap_content">';
    h += '<div class="heatmap_week"><span>Mon</span><span>&nbsp;</span><span>Wed</span><span>&nbsp;</span><span>Fri</span><span>&nbsp;</span><span>Sun</span></div>';
    h += '<div class="heatmap_main">';
    h += '<div class="stats" id="stats"></div>';
    h += '<div class="month heatmap_month"></div>';
    h += '<div id="heatmap_grid" class="heatmap"></div>';
    h += '</div></div>';
    h += '<div class="heatmap_footer">';
    h += '<div class="heatmap_less">Less</div>';
    h += '<div class="heatmap_level">';
    h += '<span class="heatmap_level_item heatmap_level_0"></span>';
    h += '<span class="heatmap_level_item heatmap_level_1"></span>';
    h += '<span class="heatmap_level_item heatmap_level_2"></span>';
    h += '<span class="heatmap_level_item heatmap_level_3"></span>';
    h += '<span class="heatmap_level_item heatmap_level_4"></span>';
    h += '</div>';
    h += '<div class="heatmap_more">More</div>';
    h += '</div></div>';
    h += '<div class="heatmap_tooltip_container"></div>';
    return h;
  }
  _startThemeSync() {
    this._updateTheme();
    if(this._colorSchemeMediaQuery&&!this._themeListenerAttached){
      if(this._colorSchemeMediaQuery.addEventListener)this._colorSchemeMediaQuery.addEventListener('change',this._handleThemeChange);
      else if(this._colorSchemeMediaQuery.addListener)this._colorSchemeMediaQuery.addListener(this._handleThemeChange);
      this._themeListenerAttached=true;
    }
    if(!this._themeObserver&&window.MutationObserver){
      this._themeObserver=new MutationObserver(this._handleThemeChange);
      this._themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-color-scheme']});
    }
  }
  _updateTheme() {
    var theme=document.documentElement.getAttribute('data-theme');
    var scheme=document.documentElement.getAttribute('data-color-scheme');
    if(theme)theme=theme==='light'?'light':'dark';
    else if(scheme==='light'||scheme==='dark')theme=scheme;
    else theme=this._colorSchemeMediaQuery&&this._colorSchemeMediaQuery.matches?'dark':'light';
    this.setAttribute('data-theme',theme);
  }
  _generateMonthLabels() {
    var el = this.shadowRoot.querySelector('.month');
    var cd = new Date(), si = (cd.getMonth()-11+12)%12;
    for(var i=si;i<si+12;i++){ var s=document.createElement('span'); s.textContent=MONTH_NAMES[i%12]; el.appendChild(s); }
  }
  _generateGrid() {
    var container = this.shadowRoot.querySelector('#heatmap_grid');
    var sd = getStartDate(), ed = new Date();
    var cw = document.createElement('div'); cw.className='heatmap_week';
    container.appendChild(cw);
    var cd = new Date(sd);
    var self = this;
    while(cd <= ed) {
      var ds = cd.getFullYear()+'-'+('0'+(cd.getMonth()+1)).slice(-2)+'-'+('0'+cd.getDate()).slice(-2);
      var day = document.createElement('div');
      day.className = 'heatmap_day heatmap_day_level_0';
      day.setAttribute('data-date', ds);
      (function(d){
        d.addEventListener('mouseenter',function(e){self._showTooltip(d,e);});
        d.addEventListener('mouseleave',function(){self._hideTooltip();});
        d.addEventListener('click',function(e){
          if(self._dailyMap[d.getAttribute('data-date')]){ e.stopPropagation(); self._showDetail(d.getAttribute('data-date'),d,e); }
        });
      })(day);
      cw.appendChild(day);
      if(cd.getDay()===0){cw=document.createElement('div');cw.className='heatmap_week';container.appendChild(cw);}
      cd.setDate(cd.getDate()+1);
    }
  }
  _fetch() {
    var self = this;
    var url = this.getAttribute('src') || this.getAttribute('data-src') || '';
    if(!url) {
      var scripts = document.querySelectorAll('script[src*="embed.js"]');
      if(scripts.length) {
        var base = scripts[scripts.length-1].src.replace(/\/embed\.js.*$/,'');
        url = base+'/stats/opencode-tokens.json';
      }
    }
    if(!url) return;
    fetch(url, {mode:'cors'})
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function(d){ self._onData(d); })
      .catch(function(e){ self._showError('Cannot load stats: '+e.message); });
  }
  _onData(data) {
    this._renderStats(data.stats);
    this._updateHeatmap(data.daily, data.stats);
  }
  _renderStats(stats) {
    var cards = [
      [fmtTokens(stats.lifetime_tokens),"Total Tokens"],
      [fmtTokens(stats.peak_daily_tokens),"Peak Daily"],
      [fmtDuration(stats.longest_turn_sec),"Longest Task"],
      [stats.current_streak_days+"d","Current Streak"],
      [stats.longest_streak_days+"d","Longest Streak"]
    ];
    this.shadowRoot.querySelector('#stats').innerHTML = cards.map(function(c){
      return '<div class="stat"><span class="stat-value">'+c[0]+'</span><span class="stat-label">'+c[1]+'</span></div>';
    }).join('');
  }
  _updateHeatmap(daily, stats) {
    var self = this;
    daily.forEach(function(d){self._dailyMap[d.date]=d;});
    var vals = daily.map(function(d){return d.tokens_input+d.tokens_output}).filter(function(t){return t>0}).sort(function(a,b){return a-b});
    var thr = [];
    if(vals.length>=4) thr=[vals[Math.floor(vals.length*0.20)],vals[Math.floor(vals.length*0.40)],vals[Math.floor(vals.length*0.60)],vals[Math.floor(vals.length*0.80)]];
    else { var pk=Math.max(stats.peak_daily_tokens,1); thr=[pk*0.25,pk*0.50,pk*0.75,pk]; }
    var days = Array.from(this.shadowRoot.querySelectorAll('.heatmap_day'));
    for(var i=days.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=days[i];days[i]=days[j];days[j]=t;}
    (function batch(){
      for(var i=0;i<5&&days.length>0;i++){(function(d){
        var e=self._dailyMap[d.getAttribute('data-date')];
        if(e){var t=e.tokens_input+e.tokens_output,l=tokenLevel(t,thr);
          if(l>0){d.setAttribute('data-count',t);d.setAttribute('data-sessions',e.sessions);d.style.cursor='pointer';d.className='heatmap_day heatmap_day_level_'+l+' heatmap_day_grow';}
        }
      })(days.pop());}
      if(days.length>0)setTimeout(batch,10);
    })();
  }
  _showTooltip(day, event) {
    var count=day.getAttribute('data-count'),sessions=day.getAttribute('data-sessions'),date=day.getAttribute('data-date');
    var tip=document.createElement('div');
    tip.className='heatmap_tooltip';
    var h='';
    if(sessions&&parseInt(sessions,10)!==0)h+='<span class="heatmap_tooltip_post">'+sessions+' sessions</span>';
    if(count&&parseInt(count,10)!==0)h+='<span class="heatmap_tooltip_count"> '+parseInt(count).toLocaleString()+' tokens</span>';
    if(date)h+='<span class="heatmap_tooltip_date">'+date+'</span>';
    tip.innerHTML=h;
    this.shadowRoot.querySelector('.heatmap_tooltip_container').appendChild(tip);
    var pos=function(ev){
      var tr=tip.getBoundingClientRect(),vw=window.innerWidth,vh=window.innerHeight;
      var l=ev.clientX-tr.width/2,t=ev.clientY-tr.height-10;
      if(l+tr.width>vw)l=vw-tr.width;if(l<0)l=0;if(t<0)t=ev.clientY+10;if(t+tr.height>vh)t=ev.clientY-tr.height-10;
      tip.style.left=l+'px';tip.style.top=t+'px';
    };
    pos(event);
    var self=this;
    var mm=function(ev){pos(ev);};
    day.addEventListener('mousemove',mm);
    day.addEventListener('mouseleave',function(){day.removeEventListener('mousemove',mm);self._hideTooltip();},{once:true});
  }
  _hideTooltip() {
    var tc=this.shadowRoot.querySelector('.heatmap_tooltip_container');
    var tip=tc.querySelector('.heatmap_tooltip'); if(tip)tc.removeChild(tip);
  }
  _showDetail(dateStr, dayEl, event) {
    var self=this;
    var entry=this._dailyMap[dateStr]; if(!entry)return;
    var old=this.shadowRoot.querySelector('.detail_panel'); if(old)old.remove();
    this._hideTooltip();
    var totalTokens=entry.tokens_input+entry.tokens_output;
    var models=entry.models||[], totalMsgs=models.reduce(function(s,m){return s+m.messages;},0);
    var fmt=function(v){if(v>=1e6)return(v/1e6).toFixed(1)+"M";if(v>=1e3)return(v/1e3).toFixed(1)+"K";return String(v);};
    var tRows=[["Input",entry.tokens_input],["Output",entry.tokens_output],["Cache Read",entry.tokens_cache_read],["Cache Write",entry.tokens_cache_write],["Reasoning",entry.tokens_reasoning]].filter(function(r){return r[1]>0;});
    var tHtml="";
    if(tRows.length>0){
      var mV=Math.max.apply(null,tRows.map(function(r){return r[1];}));
      tHtml='<div class="token_list">';
      tRows.forEach(function(r){var h=mV>0?(r[1]/mV*100):0,c=TOKEN_COLORS[r[0]]||"#8b949e";tHtml+='<div class="token_col"><span class="token_val">'+fmt(r[1])+'</span><div class="token_bar_wrap"><div class="token_bar" style="height:'+h+'%;background:'+c+'"></div></div><span class="token_label">'+r[0]+'</span></div>';});
      tHtml+='</div>';
    }
    this._donutData=null;
    var mHtml="";
    if(models.length>0&&totalMsgs>0){
      models.sort(function(a,b){return b.messages-a.messages;});
      var R=56,r=30,CX=72,CY=72,gapA=0.05,MIN_PCT=0.02;
      var slices=[],major=[],minor=[];
      models.forEach(function(m){(m.messages/totalMsgs>=MIN_PCT?major:minor).push(m);});
      var visCount=major.length+(minor.length>0?1:0);
      function buildSlice(m,isOther){
        var pct=m.messages/totalMsgs,fullRing=visCount===1;
        var rawA=pct*2*Math.PI,a=fullRing?rawA:Math.max(rawA-gapA,0);
        var end=(slices.length===0?-Math.PI/2:slices[slices.length-1]._end+gapA)+a,start=end-a,mid=start+a/2;
        if(fullRing){
          var dr='M'+CX+','+(CY-R)+'A'+R+','+R+' 0 1,1 '+CX+','+(CY+R)+'A'+R+','+R+' 0 1,1 '+CX+','+(CY-R)+'M'+CX+','+(CY-r)+'A'+r+','+r+' 0 1,0 '+CX+','+(CY+r)+'A'+r+','+r+' 0 1,0 '+CX+','+(CY-r)+'Z';
          slices.push({d:dr,_end:end,color:isOther?"#94a3b8":PIE_COLORS[0],label:isOther?"Other":m.model,pct:(pct*100).toFixed(1),msgs:m.messages,tIn:m.tokens_input||0,tOut:m.tokens_output||0,tx:"0",ty:"0",isOther:isOther,children:m._children||[]});
          return;
        }
        slices.push({d:'M'+(CX+R*Math.cos(start)).toFixed(1)+','+(CY+R*Math.sin(start)).toFixed(1)+'A'+R+','+R+' 0 '+(a>Math.PI?1:0)+',1 '+(CX+R*Math.cos(end)).toFixed(1)+','+(CY+R*Math.sin(end)).toFixed(1)+'L'+(CX+r*Math.cos(end)).toFixed(1)+','+(CY+r*Math.sin(end)).toFixed(1)+'A'+r+','+r+' 0 '+(a>Math.PI?1:0)+',0 '+(CX+r*Math.cos(start)).toFixed(1)+','+(CY+r*Math.sin(start)).toFixed(1)+'Z',_end:end,color:isOther?"#94a3b8":PIE_COLORS[slices.length%PIE_COLORS.length],label:isOther?"Other":m.model,pct:(pct*100).toFixed(1),msgs:m.messages,tIn:m.tokens_input||0,tOut:m.tokens_output||0,tx:(5*Math.cos(mid)).toFixed(1),ty:(5*Math.sin(mid)).toFixed(1),isOther:isOther,children:m._children||[]});
      }
      major.forEach(function(m){buildSlice(m,false);});
      if(minor.length>0){
        var comb={messages:minor.reduce(function(s,m){return s+m.messages;},0),tokens_input:minor.reduce(function(s,m){return s+(m.tokens_input||0);},0),tokens_output:minor.reduce(function(s,m){return s+(m.tokens_output||0);},0),model:"Other",_children:minor.map(function(m){return{label:m.model,msgs:m.messages,pct:(m.messages/totalMsgs*100).toFixed(1),tIn:m.tokens_input||0,tOut:m.tokens_output||0};})};
        buildSlice(comb,true);
      }
      var fid='g'+Date.now();
      this._donutData=slices;
      mHtml='<div class="donut-wrap"><svg width="144" height="144" viewBox="0 0 144 144" class="donut-svg"><defs><filter id="'+fid+'"><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/><feColorMatrix in="b" mode="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 22 -11" result="g"/><feComposite in="SourceGraphic" in2="g" operator="atop"/></filter></defs>';
      slices.forEach(function(s,i){mHtml+='<g class="donut-slice" data-idx="'+i+'"><path d="'+s.d+'" fill="'+s.color+'" filter="url(#'+fid+')" fill-rule="evenodd"/></g>';});
      mHtml+='</svg></div><div class="model-legend">';
      slices.forEach(function(s,i){
        var tip=s.isOther?s.children.map(function(c){return c.label+": "+c.msgs+" msgs ("+c.pct+"%)";}).join(" | "):fmt(s.tIn)+" in / "+fmt(s.tOut)+" out";
        var name=s.isOther?"Other ("+s.children.length+"): "+s.children.map(function(c){return c.label;}).join(", "):s.label;
        mHtml+='<div class="model-legend-row" title="'+tip.replace(/"/g,'&quot;')+'" data-idx="'+i+'"><span class="model-dot" style="background:'+s.color+'"></span><span class="model-name'+(s.isOther?' model-other':'')+'">'+esc(name)+'</span><span class="model-pct">'+s.pct+'%</span></div>';
      });
      mHtml+='</div>';
    }
    var panel=document.createElement('div');
    panel.className='detail_panel';
    panel.innerHTML='<span class="detail_close">&times;</span><h3>'+dateStr+'</h3><div class="detail_summary"><span>'+entry.sessions+' sessions</span><span>'+totalTokens.toLocaleString()+' tokens</span>'+(totalMsgs>0?'<span>'+totalMsgs+' messages</span>':'')+'</div>'+tHtml+mHtml;
    this.shadowRoot.appendChild(panel);
    var closeHandler=function(e){var p=self.shadowRoot.querySelector('.detail_panel');var path=e.composedPath?e.composedPath():[];if(p&&path.indexOf(p)===-1&&!p.contains(e.target)){p.remove();document.removeEventListener('click',closeHandler);}};
    document.addEventListener('click',closeHandler);
    panel.querySelector('.detail_close').onclick=function(){panel.remove();document.removeEventListener('click',closeHandler);};
    if(this._donutData){
      var legend=panel.querySelector('.model-legend');
      function hl(idx,sc){
        panel.querySelectorAll('.model-legend-row').forEach(function(r){r.classList.toggle('is-active',parseInt(r.getAttribute('data-idx'))===idx);});
        if(sc&&legend){var a=legend.querySelector('.model-legend-row[data-idx="'+idx+'"]');if(a){var lr=legend.getBoundingClientRect(),ar=a.getBoundingClientRect();if(ar.top<lr.top)legend.scrollTop+=ar.top-lr.top-4;else if(ar.bottom>lr.bottom)legend.scrollTop+=ar.bottom-lr.bottom+4;}}
      }
      function us(idx){
        if(self._sel===idx){self._sel=-1;panel.querySelectorAll('.donut-slice').forEach(function(p){p.removeAttribute('transform');p.style.opacity='';});panel.querySelectorAll('.model-legend-row.is-active').forEach(function(r){r.classList.remove('is-active');});}
        else{self._sel=idx;panel.querySelectorAll('.donut-slice').forEach(function(p){var pi=parseInt(p.getAttribute('data-idx'));if(pi===idx){var sd=self._donutData[pi];p.setAttribute('transform','translate('+sd.tx+','+sd.ty+')');p.style.opacity='1';}else p.style.opacity='0.2';});hl(idx,true);}
      }
      legend.addEventListener('click',function(e){var row=e.target.closest('.model-legend-row');if(row)us(parseInt(row.getAttribute('data-idx')));});
      panel.querySelectorAll('.donut-slice').forEach(function(p){
        var pi=parseInt(p.getAttribute('data-idx')),sd=self._donutData[pi];
        p.addEventListener('mouseenter',function(){if(!(self._sel>=0&&self._sel!==pi))p.setAttribute('transform','translate('+sd.tx+','+sd.ty+')');p.classList.add('is-hovered');hl(pi,true);});
        p.addEventListener('mouseleave',function(){if(self._sel!==pi){p.removeAttribute('transform');p.style.opacity=self._sel>=0?'0.2':'';}p.classList.remove('is-hovered');if(self._sel>=0)hl(self._sel,false);else panel.querySelectorAll('.model-legend-row.is-active').forEach(function(r){r.classList.remove('is-active');});});
      });
    }
    var dr=dayEl.getBoundingClientRect(),pr=panel.getBoundingClientRect();
    var x=event?event.clientX:dr.left+dr.width/2,y=event?event.clientY:dr.top+dr.height/2;
    var l=x-pr.width/2,t=y-pr.height-12;
    if(l+pr.width>window.innerWidth)l=window.innerWidth-pr.width-4;
    if(l<4)l=4;if(t<4)t=y+12;
    if(t+pr.height>window.innerHeight)t=Math.max(4,window.innerHeight-pr.height-4);
    panel.style.left=l+'px';panel.style.top=t+'px';
  }
  _showError(msg) {
    var c=this.shadowRoot.querySelector('.heatmap_container');
    if(c)c.innerHTML='<div class="error">'+msg+'</div>';
  }
}

if(typeof customElements!=='undefined'&&!customElements.get('opencode-token-heatmap')){
  customElements.define('opencode-token-heatmap',OpenCodeTokenHeatmap);
}
window.OpenCodeTokenHeatmap = OpenCodeTokenHeatmap;
