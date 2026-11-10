/* 0.4.1: shared plotting grammar, unchanged scores and semantic colours. */
(function(scope){
'use strict';
/* Direct range gesture: pointer drag, Alt-pan, two-touch pan/pinch; vertical touch stays native. */
function directDrag(host,api){
 let drag=null,suppress=false;const off=[];
 const on=(name,fn,opts)=>{host.addEventListener(name,fn,opts);off.push(()=>host.removeEventListener(name,fn,opts));};
 const point=e=>({x:e.clientX,y:e.clientY});
 on('pointerdown',e=>{if(e.button>0||e.pointerType==='touch')return;suppress=false;drag={...point(e),id:e.pointerId,pan:e.altKey,active:false,origin:api.point(e),view:api.view?.()};},{capture:true});
 on('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(!drag.active){if(Math.hypot(dx,dy)<6)return;drag.active=true;api.dragging?.(true);host.setPointerCapture?.(e.pointerId);}e.preventDefault();suppress=true;if(drag.pan)api.pan?.(dx,dy,drag.view);else api.select(drag.origin,api.point(e));},{capture:true});
 on('pointerup',()=>{drag=null;api.dragging?.(false);});on('pointercancel',()=>{drag=null;api.dragging?.(false);});
 on('click',e=>{if(suppress){suppress=false;e.preventDefault();e.stopImmediatePropagation();return;}api.clear();},{capture:true});
 on('keydown',e=>{if(e.key==='Escape')api.clear();});
 host.style.touchAction='pan-y';host.style.userSelect='none';host.style.webkitUserSelect='none';return()=>{off.forEach(fn=>fn());};
}

const mounted=new Map();
scope.SoxResearchCharts={
unmount(host){mounted.get(host)?.destroy();mounted.delete(host);},
mount(host,rows,kind,color,onSelect){
 if(!scope.echarts)return false;
 mounted.get(host)?.destroy();host.replaceChildren();host.classList.remove('skeleton-box');host.classList.add('qe-research-chart');host.style.height=kind==='scatter'?'350px':'360px';host.tabIndex=0;host.setAttribute('role','img');
 const chart=scope.echarts.init(host,null,{renderer:'svg'});let selected=-1,selectedArea=null;
 const output=document.createElement('output');output.className='sox-range-output';output.dataset.quantChartReadout='';output.hidden=true;
 const clear=document.createElement('button');clear.type='button';clear.textContent='구간 해제';clear.hidden=true;
 host.after(output,clear);
 const brushType=kind==='scatter'?'rect':'lineY';
 clear.onclick=()=>{selectedArea=null;chart.dispatchAction({type:'brush',areas:[]});output.hidden=true;clear.hidden=true;host.focus();};
 function showArea(area){selectedArea=area;let chosen;
  if(kind==='scatter'){const [[x1,x2],[y1,y2]]=area.coordRange;chosen=rows.filter(r=>r.x>=Math.min(x1,x2)&&r.x<=Math.max(x1,x2)&&r.y>=Math.min(y1,y2)&&r.y<=Math.max(y1,y2));output.textContent=`가격 ${Math.min(x1,x2).toFixed(1)}–${Math.max(x1,x2).toFixed(1)}점 · 실적 ${Math.min(y1,y2).toFixed(1)}–${Math.max(y1,y2).toFixed(1)}점 · ${chosen.length}종목${chosen.length?' · '+chosen.map(r=>r.ticker).join(', '):''}`;}
  else{const [a,b]=area.coordRange.map(v=>Math.max(0,Math.min(rows.length-1,Math.round(v)))).sort((a,b)=>a-b);chosen=rows.slice(a,b+1);output.textContent=chosen.map(r=>r.ticker).join(', ')+' · '+(kind==='percent'?`합계 ${chosen.reduce((sum,r)=>sum+r.value,0).toFixed(2)}%`:`${Math.min(...chosen.map(r=>r.value)).toFixed(2)}–${Math.max(...chosen.map(r=>r.value)).toFixed(2)}점`);}
  output.hidden=false;clear.hidden=false;
  chart.dispatchAction({type:'brush',areas:[{...area,brushType,...(kind==='scatter'?{xAxisIndex:0,yAxisIndex:0}:{yAxisIndex:0})}]});
 }
 const style=()=>getComputedStyle(document.documentElement);
 function render(){const st=style(),dark=document.documentElement.dataset.theme==='dark',muted=st.getPropertyValue('--qs-muted').trim()||(dark?'#a6b4b6':'#53646c'),line=st.getPropertyValue('--qs-grid').trim()||(dark?'#364247':'#dce3e5'),ink=st.getPropertyValue('--qs-text').trim()||(dark?'#edf3f2':'#172126'),accent=st.getPropertyValue(color).trim()||'#69d3cf';
 const option={animation:false,backgroundColor:'transparent',textStyle:{fontFamily:'Pretendard Variable, sans-serif'},grid:{top:24,right:56,bottom:36,left:16,containLabel:true},tooltip:{trigger:'item',confine:true,hideDelay:0,transitionDuration:0,className:'qe-point-tooltip',backgroundColor:st.getPropertyValue('--qs-raised').trim()||(dark?'#222d42':'#e9eff7'),textStyle:{color:ink},borderColor:line},series:[]};
 option.dataZoom=kind==='scatter'?[{type:'inside',xAxisIndex:0,filterMode:'none',moveOnMouseMove:'alt',preventDefaultMouseMove:false},{type:'inside',yAxisIndex:0,filterMode:'none',moveOnMouseMove:'alt',preventDefaultMouseMove:false}]:[{type:'inside',yAxisIndex:0,filterMode:'none',moveOnMouseMove:'alt',preventDefaultMouseMove:false}];
 if(kind==='scatter'){option.grid={top:28,left:18,right:24,bottom:40,containLabel:true};option.xAxis={type:'value',min:0,max:100,name:'가격 모멘텀',nameLocation:'middle',nameGap:28,nameTextStyle:{color:muted},axisLabel:{color:muted},splitLine:{lineStyle:{color:line,type:'dashed'}}};option.yAxis={type:'value',min:0,max:100,name:'실적 모멘텀',nameTextStyle:{color:muted},axisLabel:{color:muted},splitLine:{lineStyle:{color:line,type:'dashed'}}};option.series=[{type:'scatter',data:rows.map(r=>({name:r.ticker,value:[r.x,r.y]})),symbolSize:10,itemStyle:{color:accent,opacity:.8},emphasis:{scale:1.6,label:{show:true,formatter:'{b}',color:ink}},markLine:{silent:true,symbol:'none',label:{show:false},lineStyle:{color:line},data:[{xAxis:50},{yAxis:50}]}}];option.tooltip.formatter=p=>`${p.name}<br>가격 ${p.value[0].toFixed(1)}점 · 실적 ${p.value[1].toFixed(1)}점`;
 }else{option.xAxis={type:'value',min:0,axisLabel:{color:muted,formatter:v=>v+(kind==='percent'?'%':'')},splitLine:{lineStyle:{color:line,type:'dashed'}}};option.yAxis={type:'category',inverse:true,data:rows.map(r=>r.ticker),axisTick:{show:false},axisLine:{show:false},axisLabel:{color:ink,fontSize:12}};option.series=[{type:'bar',data:rows.map(r=>({name:r.ticker,value:r.value})),barMaxWidth:18,itemStyle:{color:accent,borderRadius:[0,3,3,0]},label:{show:true,position:'right',formatter:p=>p.value.toFixed(1)+(kind==='percent'?'%':''),color:ink,fontSize:11},emphasis:{focus:'none'}}];option.tooltip.formatter=p=>`${p.name} · ${p.value.toFixed(2)}${kind==='percent'?'%':'점'}`;}
 option.brush={brushType,brushMode:'single',transformable:false,toolbox:[],...(kind==='scatter'?{xAxisIndex:0,yAxisIndex:0}:{yAxisIndex:0}),brushStyle:{color:'#69d3cf22',borderColor:'#69d3cf'}};option.toolbox={show:false};const saved=chart.getOption?.()?.dataZoom;if(saved?.length)option.dataZoom=option.dataZoom.map((axis,i)=>({...axis,start:saved[i]?.start,end:saved[i]?.end}));chart.setOption(option,true);if(selectedArea)showArea(selectedArea);if(selected>=0)chart.dispatchAction({type:'highlight',seriesIndex:0,dataIndex:selected});
 }
 const coordinate=e=>{const rect=host.getBoundingClientRect();return kind==='scatter'?chart.convertFromPixel({gridIndex:0},[e.clientX-rect.left,e.clientY-rect.top]).map(v=>Math.max(0,Math.min(100,v))):chart.convertFromPixel({yAxisIndex:0},e.clientY-rect.top);};
 const disposeDrag=directDrag(host,{dragging(active){chart.setOption({tooltip:{showContent:!active}});chart.dispatchAction({type:'hideTip'});},point:coordinate,clear:()=>clear.onclick(),select(a,b){showArea({coordRange:kind==='scatter'?[[Math.max(0,Math.min(a[0],b[0])),Math.min(100,Math.max(a[0],b[0]))],[Math.max(0,Math.min(a[1],b[1])),Math.min(100,Math.max(a[1],b[1]))]]:[a,b]});}});
 const touchCleanup=scope.QuantTouchChart?.bindTouchChart(host,{
   axis:kind==='scatter'?'x':'y',
   hit:(p,clamp)=>clamp||chart.containPixel({gridIndex:0},p)?coordinate({clientX:p[0]+host.getBoundingClientRect().left,clientY:p[1]+host.getBoundingClientRect().top}):null,
   inspect:value=>{let i=Number.isInteger(value)?value:-1;if(Array.isArray(value)){const p=chart.convertToPixel({gridIndex:0},value);let best=24;rows.forEach((row,index)=>{const q=chart.convertToPixel({gridIndex:0},[row.x,row.y]),d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d<best){best=d;i=index;}});}if(rows[i]){onSelect(rows[i].ticker);chart.dispatchAction({type:'showTip',seriesIndex:0,dataIndex:i});}},
   compare:(a,b)=>showArea({coordRange:kind==='scatter'?[[Math.min(a[0],b[0]),Math.max(a[0],b[0])],[Math.min(a[1],b[1]),Math.max(a[1],b[1])]]:[a,b]}),
   clear:()=>clear.onclick(),rangeReadout:()=>output,
   navigate:(a,b)=>scope.QuantTouchChart.navigateECharts(chart,a,b,kind==='scatter'?2:Math.min(50,200/rows.length))
 });
 const reset=document.createElement('button');reset.type='button';reset.dataset.quantResetView='';reset.textContent='전체 범위';reset.hidden=true;clear.after(reset);
 reset.onclick=()=>chart.dispatchAction({type:'dataZoom',batch:(chart.getOption?.()?.dataZoom||[]).map((_,dataZoomIndex)=>({dataZoomIndex,start:0,end:100}))});
 chart.on('datazoom',()=>{reset.hidden=!(chart.getOption?.()?.dataZoom||[]).some(z=>z.start>0||z.end<100);});
 host.ondblclick=reset.onclick;
 chart.on('click',p=>{if(rows[p.dataIndex])onSelect(rows[p.dataIndex].ticker);});
 host.onkeydown=e=>{if(e.key==='0'){reset.click();e.preventDefault();return;}if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Escape'].includes(e.key))return;e.preventDefault();if(e.key==='Escape'){clear.onclick();onSelect('');return;}selected=e.key==='Home'?0:e.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,selected+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1)));onSelect(rows[selected].ticker);chart.dispatchAction({type:'showTip',seriesIndex:0,dataIndex:selected});};
 const resize=new ResizeObserver(()=>chart.resize());resize.observe(host);const theme=new MutationObserver(render);theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
 const api={select(ticker){selected=rows.findIndex(r=>r.ticker===ticker);chart.dispatchAction({type:'downplay'});if(selected>=0)chart.dispatchAction({type:'highlight',seriesIndex:0,dataIndex:selected});host.setAttribute('aria-label',kind==='scatter'?'가격·실적 모멘텀, 0–100점. '+rows.map(r=>`${r.ticker} ${r.x.toFixed(1)}, ${r.y.toFixed(1)}`).join('; '):rows.map(r=>`${r.ticker} ${r.value.toFixed(2)}${kind==='percent'?'%':'점'}`).join('; '));},destroy(){touchCleanup?.();disposeDrag();host.ondblclick=null;reset.remove();resize.disconnect();theme.disconnect();chart.dispose();output.remove();clear.remove();}};mounted.set(host,api);render();api.select('');return true;
},select(ticker){for(const item of mounted.values())item.select(ticker);}
};
})(window);
