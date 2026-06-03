(function() {
var PIE_COLORS = ["#5470c6","#91cc75","#fac858","#ee6666","#73c0de","#3ba272","#fc8452","#9a60b4","#ea7ccc"];
var MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
var TOKEN_COLORS = {Input:"#58a6ff",Output:"#3fb950","Cache Read":"#79c0ff","Cache Write":"#d2a8ff",Reasoning:"#ffa657"};

var CSS = `
  :host { display:block; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif; -webkit-font-smoothing:antialiased; }
  :host([hidden]) { display:none; }
  .stats { display:flex; flex-wrap:wrap; gap:0; margin-bottom:12px; }
  .stat { flex:1; text-align:center; padding:3px 2px; }
  .stat-value { display:block; font-size:13px; font-weight:600; letter-spacing:-0.3px; }
  .stat-label { font-size:8px; font-weight:400; color:#8b949e; letter-spacing:0.3px; }
  @media (prefers-color-scheme:dark) { .stat-value { color:#e6edf3; } }
  .heatmap_container { display:flex; flex-direction:column; font-size:10px; line-height:10px; align-items:center; }
  .heatmap_content { display:flex; flex-direction:row; align-items:flex-end; overflow-x:auto; overflow-y:hidden; }
  .heatmap_week { display:flex; flex-direction:column; justify-content:flex-start; align-items:flex-end; text-align:right; }
  .heatmap_content > .heatmap_week span { margin-right:0.25rem; margin-top:0; min-width:22px; white-space:nowrap; height:12px; }
  .heatmap_main { display:flex; flex-direction:column; }
  @media(max-width:1200px){ .heatmap_content { width:100%; } }
  .heatmap_month { display:flex; flex-direction:row; justify-content:space-around; align-items:flex-end; text-align:right; margin-bottom:2px; }
  .heatmap { display:flex; flex-direction:row; height:84px; }
  .heatmap_footer { display:flex; margin-top:0.5rem; align-self:flex-end; min-width:113px; white-space:nowrap; margin-left:auto; }
  .heatmap_level { display:flex; gap:2px; margin:0 0.25rem; flex-direction:row; width:max-content; height:10px; align-self:flex-end; }
  .heatmap_level_item { display:block; border-radius:0.125rem; width:10px; height:10px; }
  .heatmap_level_0 { background:var(--ht-lv-0,#ebedf0); }
  .heatmap_level_1 { background:var(--ht-lv-1,#9be9a8); }
  .heatmap_level_2 { background:var(--ht-lv-2,#40c463); }
  .heatmap_level_3 { background:var(--ht-lv-3,#30a14e); }
  .heatmap_level_4 { background:var(--ht-lv-4,#216e39); }
  @media (prefers-color-scheme:dark) {
    .heatmap_level_0 { background:var(--ht-lv-0,#161b22); }
    .heatmap_level_1 { background:var(--ht-lv-1,#0e4429); }
    .heatmap_level_2 { background:var(--ht-lv-2,#006d32); }
    .heatmap_level_3 { background:var(--ht-lv-3,#26a641); }
    .heatmap_level_4 { background:var(--ht-lv-4,#39d353); }
  }
  .heatmap_day { width:10px; height:10px; margin:1px; border-radius:2px; display:inline-block; position:relative; cursor:default; }
  .heatmap_day_level_0 { background:var(--ht-lv-0,#ebedf0); }
  .heatmap_day_level_1 { background:var(--ht-lv-1,#9be9a8); }
  .heatmap_day_level_2 { background:var(--ht-lv-2,#40c463); }
  .heatmap_day_level_3 { background:var(--ht-lv-3,#30a14e); }
  .heatmap_day_level_4 { background:var(--ht-lv-4,#216e39); }
  @media (prefers-color-scheme:dark) {
    .heatmap_day_level_0 { background:var(--ht-lv-0,#161b22); }
    .heatmap_day_level_1 { background:var(--ht-lv-1,#0e4429); }
    .heatmap_day_level_2 { background:var(--ht-lv-2,#006d32); }
    .heatmap_day_level_3 { background:var(--ht-lv-3,#26a641); }
    .heatmap_day_level_4 { background:var(--ht-lv-4,#39d353); }
  }
  .heatmap_tooltip { position:fixed; font-size:12px; line-height:16px; padding:8px; border-radius:3px; white-space:pre-wrap; z-index:10000; text-align:right; pointer-events:none; }
  .heatmap_tooltip_light { background:#fff; color:#333; border:1px solid #ccc; }
  .heatmap_tooltip_dark { background:#333; color:#fff; border:1px solid #555; }
  .heatmap_tooltip_count,.heatmap_tooltip_post { display:inline-block; }
  .heatmap_tooltip_date { display:block; }
  @keyframes grow{0%{transform:scale(0)}60%{transform:scale(1.12)}100%{transform:scale(1)}}
  .heatmap_day_grow{animation:grow .5s cubic-bezier(.34,1.56,.64,1) both}
  .error{text-align:center;padding:60px 0;color:#cf222e;font-size:14px}
  .detail_panel{position:fixed;padding:12px 14px;background:#f6f8fa;border-radius:6px;border:1px solid #d0d7de;box-shadow:0 4px 12px rgba(0,0,0,.12);font-size:12px;color:#24292f;text-align:left;z-index:1000;width:320px;max-width:calc(100vw - 8px);box-sizing:border-box}
  @media(prefers-color-scheme:dark){.detail_panel{background:#161b22;color:#c9d1d9;border-color:#30363d;box-shadow:0 4px 12px rgba(0,0,0,.4)}}
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

function fmtTokens(v) {
  if (v >= 1e9) return (v/1e9).toFixed(1).replace(/\.0$/,"")+"B";
  if (v >= 1e6) return (v/1e6).toFixed(1).replace(/\.0$/,"")+"M";
  if (v >= 1e3) return (v/1e3).toFixed(1).replace(/\.0$/,"")+"K";
  return String(v);
}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function fmtDuration(sec){var h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60);return h?h+"h "+m+"m":m+"m"}
function isDark(){return window.matchMedia('(prefers-color-scheme:dark)').matches}

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

var HeatmapCard = (function(){

var _rootDoc = document;

function HeatmapCard(){
  var self = this instanceof HTMLElement ? this : Reflect.construct(HTMLElement,[],HeatmapCard);
  self._dailyData = {};
  self._dailyMap = {};
  self._donutData = null;
  self._sel = -1;
  return self;
}

var proto = HeatmapCard.prototype = Object.create(HTMLElement.prototype);

proto.connectedCallback = function(){
  var self = this;
  self.attachShadow({mode:'open'});
  var style = document.createElement('style');
  style.textContent = CSS;
  self.shadowRoot.appendChild(style);
  self._render();

  var src = self.getAttribute('src');
  if(src){
    self._fetch(src);
  } else {
    var scriptSrc = document.currentScript && document.currentScript.src;
    if(scriptSrc){
      var base = scriptSrc.substring(0, scriptSrc.lastIndexOf('/'));
      self._fetch(base + '/stats/opencode-tokens.json');
    } else {
      self._fetch('stats/opencode-tokens.json');
    }
  }
};

proto._fetch = function(url){
  var self = this;
  var jsUrl = url.replace(/\.json$/,'.js');
  var check = function(){
    if(window.__OPENCODE_TOKEN_DATA__){
      self._onData(window.__OPENCODE_TOKEN_DATA__);
      return true;
    }
    return false;
  };
  if(check()) return;
  var s = document.createElement('script');
  s.src = jsUrl;
  s.onload = function(){
    if(!check()) self._showError('Data not found in loaded script');
  };
  s.onerror = function(){ self._showError('Cannot load stats data'); };
  document.head.appendChild(s);
};

proto._render = function(){
  var self = this;
  var root = self.shadowRoot;
  root.innerHTML +=
    '<div class="stats" id="stats"></div>'+
    '<div class="heatmap_container">'+
      '<div class="heatmap_content">'+
        '<div class="heatmap_week"><span>Mon</span><span>&nbsp;</span><span>Wed</span><span>&nbsp;</span><span>Fri</span><span>&nbsp;</span><span>Sun</span></div>'+
        '<div class="heatmap_main">'+
          '<div class="month heatmap_month"></div>'+
          '<div id="heatmap_grid" class="heatmap"></div>'+
        '</div>'+
      '</div>'+
      '<div class="heatmap_footer">'+
        '<div class="heatmap_less">Less</div>'+
        '<div class="heatmap_level">'+
          '<span class="heatmap_level_item heatmap_level_0"></span>'+
          '<span class="heatmap_level_item heatmap_level_1"></span>'+
          '<span class="heatmap_level_item heatmap_level_2"></span>'+
          '<span class="heatmap_level_item heatmap_level_3"></span>'+
          '<span class="heatmap_level_item heatmap_level_4"></span>'+
        '</div>'+
        '<div class="heatmap_more">More</div>'+
      '</div>'+
      '<div class="heatmap_tooltip_container"></div>'+
    '</div>';
  self._generateMonthLabels();
  self._generateHeatmapGrid();
};

proto._generateMonthLabels = function(){
  var self = this;
  var monthDiv = self.shadowRoot.querySelector('.month');
  var cd = new Date();
  var si = (cd.getMonth()-11+12)%12;
  for(var i=si;i<si+12;i++){
    var s=document.createElement('span');
    s.textContent=MONTH_NAMES[i%12];
    monthDiv.appendChild(s);
  }
};

proto._generateHeatmapGrid = function(){
  var self = this;
  var container = self.shadowRoot.querySelector('#heatmap_grid');
  var sd = getStartDate();
  var ed = new Date();
  var cw = document.createElement('div'); cw.className='heatmap_week';
  container.appendChild(cw);
  var cd = new Date(sd);
  while(cd<=ed){
    var ds = cd.getFullYear()+'-'+('0'+(cd.getMonth()+1)).slice(-2)+'-'+('0'+cd.getDate()).slice(-2);
    var day = document.createElement('div');
    day.className='heatmap_day heatmap_day_level_0';
    day.setAttribute('data-date',ds);
    self._bindDay(day);
    cw.appendChild(day);
    if(cd.getDay()===0){cw=document.createElement('div');cw.className='heatmap_week';container.appendChild(cw);}
    cd.setDate(cd.getDate()+1);
  }
};

proto._bindDay = function(day){
  var self = this;
  day.addEventListener('mouseenter',function(e){self._showTooltip(day,e);});
  day.addEventListener('mouseleave',function(){self._hideTooltip();});
  day.addEventListener('click',function(e){
    var ds=day.getAttribute('data-date');
    if(ds&&self._dailyMap[ds]){
      e.stopPropagation();
      self._showDetail(ds,day);
    }
  });
};

proto._onData = function(data){
  var self = this;
  self._renderStats(data.stats);
  self._updateHeatmapColors(data.daily,data.stats);
};

proto._renderStats = function(stats){
  var self = this;
  var root = self.shadowRoot;
  var cards = [
    [fmtTokens(stats.lifetime_tokens),"Total Tokens"],
    [fmtTokens(stats.peak_daily_tokens),"Peak Daily"],
    [fmtDuration(stats.longest_turn_sec),"Longest Task"],
    [stats.current_streak_days+"d","Current Streak"],
    [stats.longest_streak_days+"d","Longest Streak"]
  ];
  root.querySelector('#stats').innerHTML = cards.map(function(c,i){
    return '<div class="stat"><span class="stat-value">'+c[0]+'</span><span class="stat-label">'+c[1]+'</span></div>';
  }).join('');
};

proto._updateHeatmapColors = function(daily,stats){
  var self=this;
  daily.forEach(function(d){self._dailyMap[d.date]=d;});
  var allTokens=daily.map(function(d){return d.tokens_input+d.tokens_output}).filter(function(t){return t>0}).sort(function(a,b){return a-b});
  var thresholds=[];
  if(allTokens.length>=4){
    thresholds=[
      allTokens[Math.floor(allTokens.length*0.20)],
      allTokens[Math.floor(allTokens.length*0.40)],
      allTokens[Math.floor(allTokens.length*0.60)],
      allTokens[Math.floor(allTokens.length*0.80)],
    ];
  } else {
    var peak=Math.max(stats.peak_daily_tokens,1);
    thresholds=[peak*0.25,peak*0.50,peak*0.75,peak];
  }
  var days=Array.from(self.shadowRoot.querySelectorAll('.heatmap_day'));
  for(var i=days.length-1;i>0;i--){
    var j=Math.floor(Math.random()*(i+1));
    var tmp=days[i];days[i]=days[j];days[j]=tmp;
  }
  var update=function(day){
    var ds=day.getAttribute('data-date');
    var entry=self._dailyMap[ds];
    if(entry){
      var tokens=entry.tokens_input+entry.tokens_output;
      var lvl=tokenLevel(tokens,thresholds);
      if(lvl>0){
        day.setAttribute('data-count',tokens);
        day.setAttribute('data-sessions',entry.sessions);
        day.style.cursor='pointer';
        day.classList.remove('heatmap_day_level_0');
        day.classList.add('heatmap_day_level_'+lvl,'heatmap_day_grow');
      }
    }
  };
  (function batch(){
    for(var i=0;i<5&&days.length>0;i++)update(days.pop());
    if(days.length>0)setTimeout(batch,10);
  })();
};

proto._showTooltip = function(day,event){
  var self=this;
  var count=day.getAttribute('data-count');
  var sessions=day.getAttribute('data-sessions');
  var date=day.getAttribute('data-date');
  var tip=document.createElement('div');
  tip.className='heatmap_tooltip '+(isDark()?'heatmap_tooltip_dark':'heatmap_tooltip_light');
  var html='';
  if(sessions&&parseInt(sessions,10)!==0)html+='<span class="heatmap_tooltip_post">'+sessions+' sessions</span>';
  if(count&&parseInt(count,10)!==0)html+='<span class="heatmap_tooltip_count"> '+parseInt(count).toLocaleString()+' tokens</span>';
  if(date)html+='<span class="heatmap_tooltip_date">'+date+'</span>';
  tip.innerHTML=html;
  var tc=self.shadowRoot.querySelector('.heatmap_tooltip_container');
  tc.appendChild(tip);
  var pos=function(ev){
    var tr=tip.getBoundingClientRect(),vw=window.innerWidth,vh=window.innerHeight;
    var left=ev.clientX-tr.width/2,top=ev.clientY-tr.height-10;
    if(left+tr.width>vw)left=vw-tr.width;
    if(left<0)left=0;
    if(top<0)top=ev.clientY+10;
    if(top+tr.height>vh)top=ev.clientY-tr.height-10;
    tip.style.left=left+'px';tip.style.top=top+'px';
  };
  pos(event);
  var mm=function(ev){pos(ev);};
  day.addEventListener('mousemove',mm);
  day.addEventListener('mouseleave',function(){day.removeEventListener('mousemove',mm);self._hideTooltip();},{once:true});
};

proto._hideTooltip = function(){
  var tc=this.shadowRoot.querySelector('.heatmap_tooltip_container');
  var tip=tc.querySelector('.heatmap_tooltip');
  if(tip)tc.removeChild(tip);
};

proto._showDetail = function(dateStr,dayEl){
  var self=this;
  var entry=self._dailyMap[dateStr];
  if(!entry)return;
  self._closeDetail();
  self._hideTooltip();
  var totalTokens=entry.tokens_input+entry.tokens_output;
  var models=entry.models||[];
  var totalMsgs=models.reduce(function(s,m){return s+m.messages;},0);
  var fmt=function(v){if(v>=1e6)return(v/1e6).toFixed(1)+"M";if(v>=1e3)return(v/1e3).toFixed(1)+"K";return String(v);};
  var tokenRows=[["Input",entry.tokens_input],["Output",entry.tokens_output],["Cache Read",entry.tokens_cache_read],["Cache Write",entry.tokens_cache_write],["Reasoning",entry.tokens_reasoning]].filter(function(r){return r[1]>0;});
  var tokensHtml="";
  if(tokenRows.length>0){
    var maxVal=Math.max.apply(null,tokenRows.map(function(r){return r[1];}));
    tokensHtml='<div class="token_list">';
    tokenRows.forEach(function(r){
      var h=maxVal>0?(r[1]/maxVal*100):0;
      var color=TOKEN_COLORS[r[0]]||"#8b949e";
      tokensHtml+='<div class="token_col"><span class="token_val">'+fmt(r[1])+'</span><div class="token_bar_wrap"><div class="token_bar" style="height:'+h+'%;background:'+color+'"></div></div><span class="token_label">'+r[0]+'</span></div>';
    });
    tokensHtml+='</div>';
  }
  self._donutData=null;
  var modelsHtml="";
  if(models.length>0&&totalMsgs>0){
    models.sort(function(a,b){return b.messages-a.messages;});
    var R=56,r=30,CX=72,CY=72,gapA=0.05,MIN_PCT=0.02;
    var slices=[],major=[],minor=[];
    models.forEach(function(m){(m.messages/totalMsgs>=MIN_PCT?major:minor).push(m);});
    var visibleCount=major.length+(minor.length>0?1:0);
    function buildSlice(m,idx,isOther){
      var pct=m.messages/totalMsgs,fullRing=visibleCount===1;
      var rawA=pct*2*Math.PI,angle=fullRing?rawA:Math.max(rawA-gapA,0);
      var end=(slices.length===0?-Math.PI/2:slices[slices.length-1]._end+gapA)+angle,start=end-angle,mid=start+angle/2;
      if(fullRing){
        var dR='M'+CX+','+(CY-R)+'A'+R+','+R+' 0 1,1 '+CX+','+(CY+R)+'A'+R+','+R+' 0 1,1 '+CX+','+(CY-R)+'M'+CX+','+(CY-r)+'A'+r+','+r+' 0 1,0 '+CX+','+(CY+r)+'A'+r+','+r+' 0 1,0 '+CX+','+(CY-r)+'Z';
        slices.push({d:dR,_end:end,color:isOther?"#94a3b8":PIE_COLORS[0],label:isOther?"Other":m.model,pct:(pct*100).toFixed(1),msgs:m.messages,tIn:m.tokens_input||0,tOut:m.tokens_output||0,tx:"0",ty:"0",isOther:isOther,children:m._children||[]});
        return;
      }
      var cosS=Math.cos(start),sinS=Math.sin(start),cosE=Math.cos(end),sinE=Math.sin(end);
      var d='M'+(CX+R*cosS).toFixed(1)+','+(CY+R*sinS).toFixed(1)+'A'+R+','+R+' 0 '+(angle>Math.PI?1:0)+',1 '+(CX+R*cosE).toFixed(1)+','+(CY+R*sinE).toFixed(1)+'L'+(CX+r*cosE).toFixed(1)+','+(CY+r*sinE).toFixed(1)+'A'+r+','+r+' 0 '+(angle>Math.PI?1:0)+',0 '+(CX+r*cosS).toFixed(1)+','+(CY+r*sinS).toFixed(1)+'Z';
      slices.push({d:d,_end:end,color:isOther?"#94a3b8":PIE_COLORS[slices.length%PIE_COLORS.length],label:isOther?"Other":m.model,pct:(pct*100).toFixed(1),msgs:m.messages,tIn:m.tokens_input||0,tOut:m.tokens_output||0,tx:(5*Math.cos(mid)).toFixed(1),ty:(5*Math.sin(mid)).toFixed(1),isOther:isOther,children:m._children||[]});
    }
    major.forEach(function(m){buildSlice(m);});
    if(minor.length>0){
      var combined={messages:minor.reduce(function(s,m){return s+m.messages;},0),tokens_input:minor.reduce(function(s,m){return s+(m.tokens_input||0);},0),tokens_output:minor.reduce(function(s,m){return s+(m.tokens_output||0);},0),model:"Other",_children:minor.map(function(m){return{label:m.model,msgs:m.messages,pct:(m.messages/totalMsgs*100).toFixed(1),tIn:m.tokens_input||0,tOut:m.tokens_output||0};})};
      buildSlice(combined,null,true);
    }
    var fid='g'+Date.now();
    self._donutData=slices;
    modelsHtml='<div class="donut-wrap"><svg width="144" height="144" viewBox="0 0 144 144" class="donut-svg"><defs><filter id="'+fid+'"><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/><feColorMatrix in="b" mode="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 22 -11" result="g"/><feComposite in="SourceGraphic" in2="g" operator="atop"/></filter></defs>';
    slices.forEach(function(s,i){
      modelsHtml+='<g class="donut-slice" data-idx="'+i+'"><path d="'+s.d+'" fill="'+s.color+'" filter="url(#'+fid+')" fill-rule="evenodd"/></g>';
    });
    modelsHtml+='</svg></div><div class="model-legend">';
    slices.forEach(function(s,i){
      var tip=s.isOther?s.children.map(function(c){return c.label+": "+c.msgs+" msgs ("+c.pct+"%)";}).join(" | "):fmt(s.tIn)+" in / "+fmt(s.tOut)+" out";
      var name=s.isOther?"Other ("+s.children.length+"): "+s.children.map(function(c){return c.label;}).join(", "):s.label;
      modelsHtml+='<div class="model-legend-row" title="'+tip.replace(/"/g,'&quot;')+'" data-idx="'+i+'"><span class="model-dot" style="background:'+s.color+'"></span><span class="model-name'+(s.isOther?' model-other':'')+'">'+esc(name)+'</span><span class="model-pct">'+s.pct+'%</span></div>';
    });
    modelsHtml+='</div>';
  }
  var summaryHtml='<div class="detail_summary"><span>'+entry.sessions+' sessions</span><span>'+totalTokens.toLocaleString()+' tokens</span>'+(totalMsgs>0?'<span>'+totalMsgs+' messages</span>':'')+'</div>';
  var panel=document.createElement('div');
  panel.className='detail_panel';
  panel.innerHTML='<span class="detail_close">&times;</span><h3>'+dateStr+'</h3>'+summaryHtml+tokensHtml+modelsHtml;
  document.body.appendChild(panel);
  if(!self._closeHandler){
    self._closeHandler = function(e){
      var p = document.querySelector('.detail_panel');
      if(!p) return;
      if(!e.composedPath().some(function(el){return el.classList && el.classList.contains('detail_panel');}))
        p.remove();
    };
    document.addEventListener('click', self._closeHandler);
  }
  panel.querySelector('.detail_close').onclick=function(){panel.remove();};
  if(self._donutData){
    var legend=panel.querySelector('.model-legend');
    function highlight(idx,scroll){
      panel.querySelectorAll('.model-legend-row').forEach(function(r){r.classList.toggle('is-active',parseInt(r.getAttribute('data-idx'))===idx);});
      if(scroll&&legend){
        var a=legend.querySelector('.model-legend-row[data-idx="'+idx+'"]');
        if(a){var lr=legend.getBoundingClientRect(),ar=a.getBoundingClientRect();
          if(ar.top<lr.top)legend.scrollTop+=ar.top-lr.top-4;
          else if(ar.bottom>lr.bottom)legend.scrollTop+=ar.bottom-lr.bottom+4;
        }
      }
    }
    function clearHL(){panel.querySelectorAll('.model-legend-row.is-active').forEach(function(r){r.classList.remove('is-active');});}
    function updateSlice(idx){
      if(self._sel===idx){self._sel=-1;
        panel.querySelectorAll('.donut-slice').forEach(function(p){p.removeAttribute('transform');p.style.opacity='';});
        clearHL();
      } else {self._sel=idx;
        panel.querySelectorAll('.donut-slice').forEach(function(p){var pi=parseInt(p.getAttribute('data-idx'));
          if(pi===idx){var sd=self._donutData[pi];p.setAttribute('transform','translate('+sd.tx+','+sd.ty+')');p.style.opacity='1';}
          else p.style.opacity='0.2';
        });
        highlight(idx,true);
      }
    }
    legend.addEventListener('click',function(e){
      var row=e.target.closest('.model-legend-row');
      if(row)updateSlice(parseInt(row.getAttribute('data-idx')));
    });
    panel.querySelectorAll('.donut-slice').forEach(function(p){
      var pi=parseInt(p.getAttribute('data-idx')),sd=self._donutData[pi];
      p.addEventListener('mouseenter',function(){if(!(self._sel>=0&&self._sel!==pi))p.setAttribute('transform','translate('+sd.tx+','+sd.ty+')');p.classList.add('is-hovered');highlight(pi,true);});
      p.addEventListener('mouseleave',function(){if(self._sel!==pi){p.removeAttribute('transform');p.style.opacity=self._sel>=0?'0.2':'';}p.classList.remove('is-hovered');if(self._sel>=0)highlight(self._sel,false);else clearHL();});
    });
  }
  var dr=dayEl.getBoundingClientRect(),pr=panel.getBoundingClientRect();
  var left=dr.left+dr.width/2+window.scrollX-pr.width/2,top=dr.top+window.scrollY-pr.height-10;
  if(left+pr.width>window.innerWidth)left=window.innerWidth-pr.width-4;
  if(left<4)left=4;
  if(top<4)top=dr.bottom+window.scrollY+10;
  panel.style.left=left+'px';panel.style.top=top+'px';
};

proto._closeDetail = function(){
  var existing=document.querySelector('.detail_panel');
  if(existing)existing.remove();
};

proto._showError = function(msg){
  this.shadowRoot.querySelector('.heatmap_container').innerHTML='<div class="error">'+msg+'</div>';
};

return HeatmapCard;
})();

if(typeof customElements!=='undefined'&&!customElements.get('heatmap-card')){
  customElements.define('heatmap-card',HeatmapCard);
}

if(typeof window!=='undefined'){
  window.HeatmapCard = HeatmapCard;
}

})();
