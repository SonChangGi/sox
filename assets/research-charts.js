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
 on('click',e=>{if(suppress){suppress=false;e.preventDefault();e.stopImmediatePropagation();return;}api.clear();if(api.click?.(e))e.stopImmediatePropagation();},{capture:true});
 on('keydown',e=>{if(e.key==='Escape')api.clear();});
 host.style.touchAction='pan-y';host.style.userSelect='none';host.style.webkitUserSelect='none';return()=>{off.forEach(fn=>fn());};
}

const mounted=new Map();
scope.SoxResearchCharts={
unmount(host){mounted.get(host)?.destroy();mounted.delete(host);},
mount(host,rows,kind,color,onSelect){
 if(!scope.echarts)return false;
 mounted.get(host)?.destroy();host.replaceChildren();host.classList.remove('skeleton-box');host.classList.add('qe-research-chart');host.style.height=kind==='scatter'?'clamp(300px, 40vw, 365px)':'360px';host.tabIndex=0;host.setAttribute('role','group');
 const chart=scope.echarts.init(host,null,{renderer:'svg'});let selected=-1,selectedArea=null,labels;
 const presentation=scope.QuantRangeReadout;
 const selectionLayer=document.createElement('div');selectionLayer.className='sox-chart-selection';
 host.append?.(selectionLayer);
 const output=document.createElement('output');output.className='sox-range-output';output.dataset.quantChartReadout='';output.hidden=true;
 const clear=document.createElement('button');clear.type='button';clear.textContent='구간 해제';clear.hidden=true;
 host.after(output,clear);
 const presenter=presentation?.createRangeReadout(host,output);
 const point=document.createElement('output');point.className='sox-quadrant-point';point.hidden=true;point.setAttribute('aria-live','polite');clear.after(point);
 const refreshPoint=()=>{const row=rows[selected];point.hidden=kind!=='scatter'||!row||!!selectedArea;if(!point.hidden)point.textContent=row.ticker+' · 가격 '+row.x.toFixed(1)+'점 · 실적 '+row.y.toFixed(1)+'점';};
 function geometry(){
  if(!selectedArea)return;
  const band=kind==='scatter'?selectedArea.coordRange[0].map(x=>chart.convertToPixel({xAxisIndex:0},x)):undefined;
  return presentation?.echartsGeometry(chart,band);
 }
 function drawSelection(){
  selectionLayer.replaceChildren();
  const rect=chart.getModel?.()?.getComponent('grid',0)?.coordinateSystem?.getRect();
  if(!selectedArea||!rect)return;
  let a,b;
  if(kind==='scatter'){
   const [[x0,x1],[y0,y1]]=selectedArea.coordRange;
   a=chart.convertToPixel({gridIndex:0},[x0,y1]);b=chart.convertToPixel({gridIndex:0},[x1,y0]);
  }else{
   const axis=chart.getModel().getComponent('yAxis',0).axis;
   const half=axis.getBandWidth()/2;
   const [lo,hi]=selectedArea.coordRange.map(v=>chart.convertToPixel({yAxisIndex:0},Math.max(0,Math.min(rows.length-1,Math.round(v))))).sort((a,b)=>a-b);
   a=[rect.x,lo-half];b=[rect.x+rect.width,hi+half];
  }
  const left=Math.max(rect.x,Math.min(a[0],b[0])),right=Math.min(rect.x+rect.width,Math.max(a[0],b[0]));
  const top=Math.max(rect.y,Math.min(a[1],b[1])),bottom=Math.min(rect.y+rect.height,Math.max(a[1],b[1]));
  if(right<left||bottom<top)return;
  const shade=document.createElement('span');
  Object.assign(shade.style,{left:left+'px',top:top+'px',width:Math.max(1,right-left)+'px',height:Math.max(1,bottom-top)+'px'});
  selectionLayer.append(shade);
 }
 function clearArea(){
  selectedArea=null;delete host.dataset.soxRangeActive;selectionLayer.replaceChildren();
  presenter?.clear();output.hidden=true;clear.hidden=true;refreshPoint();
 }
 clear.onclick=()=>{clearArea();host.focus({preventScroll:true});};
 function showArea(area){
  selectedArea=area;let chosen,items;
  if(kind==='scatter'){
   const [[x1,x2],[y1,y2]]=area.coordRange;
   const xl=Math.min(x1,x2),xh=Math.max(x1,x2),yl=Math.min(y1,y2),yh=Math.max(y1,y2);
   chosen=rows.filter(r=>r.x>=xl&&r.x<=xh&&r.y>=yl&&r.y<=yh);
   items=[{name:'가격 점수',change:xl.toFixed(1)+'–'+xh.toFixed(1)+'점'},{name:'실적 점수',change:yl.toFixed(1)+'–'+yh.toFixed(1)+'점'}];
  }else{
   const [a,b]=area.coordRange.map(v=>Math.max(0,Math.min(rows.length-1,Math.round(v)))).sort((a,b)=>a-b);
   chosen=rows.slice(a,b+1);
   items=kind==='percent'?[{name:'선택 비중 합계',change:chosen.reduce((sum,r)=>sum+r.value,0).toFixed(2)+'%'}]:
    [{name:'점수 범위',change:Math.min(...chosen.map(r=>r.value)).toFixed(2)+'–'+Math.max(...chosen.map(r=>r.value)).toFixed(2)+'점'}];
  }
  const title=chosen.length+'개 종목 선택',note=chosen.map(r=>r.ticker).join(' · ');
  // Keep the native SVG node that received touchstart attached through touchend.
  // The comparison band is DOM chrome; updating ECharts options during touch
  // would replace points or grid lines under the active finger.
  host.dataset.soxRangeActive='';
  chart.dispatchAction({type:'hideTip'});drawSelection();
  if(presenter)presenter.show({title,items,note,dense:chosen.length>4},geometry());
  else{output.textContent=title+' · '+items.map(i=>i.name+' '+i.change).join(' · ')+' · '+note;output.hidden=false;}
  clear.hidden=false;refreshPoint();
 }
 const style=()=>getComputedStyle(document.documentElement);
 function render(){const st=style(),dark=document.documentElement.dataset.theme==='dark',muted=st.getPropertyValue('--qs-muted').trim()||(dark?'#a6b4b6':'#53646c'),line=st.getPropertyValue('--qs-grid').trim()||(dark?'#364247':'#dce3e5'),ink=st.getPropertyValue('--qs-text').trim()||(dark?'#edf3f2':'#172126'),accent=st.getPropertyValue(color).trim()||'#69d3cf';
 const option={animation:false,backgroundColor:'transparent',textStyle:{fontFamily:'Pretendard Variable, sans-serif'},grid:{top:24,right:56,bottom:36,left:16,containLabel:true},tooltip:{trigger:'item',confine:true,hideDelay:0,transitionDuration:0,className:'qe-point-tooltip',backgroundColor:st.getPropertyValue('--qs-raised').trim()||(dark?'#222d42':'#e9eff7'),textStyle:{color:ink},borderColor:line},series:[]};
 option.dataZoom=kind==='scatter'?[{type:'inside',xAxisIndex:0,filterMode:'none',moveOnMouseMove:'alt',preventDefaultMouseMove:false},{type:'inside',yAxisIndex:0,filterMode:'none',moveOnMouseMove:'alt',preventDefaultMouseMove:false}]:[{type:'inside',yAxisIndex:0,filterMode:'none',moveOnMouseMove:'alt',preventDefaultMouseMove:false}];
 if(kind==='scatter'){
  const leader=st.getPropertyValue('--chart-1').trim()||(dark?'#75aaff':'#2664ad');
  option.grid={top:34,left:14,right:18,bottom:38,containLabel:true};
  const tick={type:'value',min:0,max:100,interval:25,nameTextStyle:{color:muted,fontSize:12},axisLabel:{color:muted,fontSize:11},
   axisTick:{show:false},axisLine:{show:true,lineStyle:{color:line}},splitLine:{lineStyle:{color:line,type:'dashed'}}};
  option.xAxis={...tick,name:'가격 모멘텀 (점)',nameLocation:'middle',nameGap:29};
  option.yAxis={...tick,name:'실적 모멘텀 (점)',nameGap:11};
  option.series=[{type:'scatter',data:rows.map((r,i)=>({
    name:r.ticker,value:[r.x,r.y],
    symbolSize:i<5?8:6,
    itemStyle:{color:i<5?leader:muted,opacity:i<5?1:.60},
  })),label:{show:!scope.QuantSoxLabels,formatter:'{b}',color:ink,textBorderWidth:0,fontSize:11},
   emphasis:{scale:1.45,focus:'none',itemStyle:{color:accent,borderColor:ink,borderWidth:1.5,opacity:1}},
   markLine:{silent:true,symbol:'none',label:{show:false},lineStyle:{color:muted,opacity:.62,width:1,type:'dashed'},data:[{xAxis:50},{yAxis:50}]}}];
  option.tooltip.formatter=p=>`${p.name}<br>가격 ${p.value[0].toFixed(1)}점 · 실적 ${p.value[1].toFixed(1)}점`;
 }else{option.xAxis={type:'value',min:0,axisLabel:{color:muted,formatter:v=>v+(kind==='percent'?'%':'')},splitLine:{lineStyle:{color:line,type:'dashed'}}};option.yAxis={type:'category',inverse:true,data:rows.map(r=>r.ticker),axisTick:{show:false},axisLine:{show:false},axisLabel:{color:ink,fontSize:12}};option.series=[{type:'bar',data:rows.map(r=>({name:r.ticker,value:r.value})),barMaxWidth:18,itemStyle:{color:accent,borderRadius:[0,3,3,0]},label:{show:true,position:'right',formatter:p=>p.value.toFixed(1)+(kind==='percent'?'%':''),color:ink,fontSize:11},emphasis:{focus:'none'}}];option.tooltip.formatter=p=>`${p.name} · ${p.value.toFixed(2)}${kind==='percent'?'%':'점'}`;}
 option.toolbox={show:false};const saved=chart.getOption?.()?.dataZoom;if(saved?.length)option.dataZoom=option.dataZoom.map((axis,i)=>({...axis,start:saved[i]?.start,end:saved[i]?.end}));chart.setOption(option,true);
 if(kind==='scatter'){
   labels??=scope.QuantSoxLabels?.mount(host,chart,rows.map((r,i)=>({ticker:r.ticker,value:[r.x,r.y],leader:i<5,radius:6})),rows[selected]?.ticker);
   labels?.schedule();
 }
 if(selectedArea)showArea(selectedArea);if(selected>=0)chart.dispatchAction({type:'highlight',seriesIndex:0,dataIndex:selected});
 }
 const coordinate=e=>{const rect=host.getBoundingClientRect();return kind==='scatter'?chart.convertFromPixel({gridIndex:0},[e.clientX-rect.left,e.clientY-rect.top]).map(v=>Math.max(0,Math.min(100,v))):chart.convertFromPixel({yAxisIndex:0},e.clientY-rect.top);};
 const disposeDrag=directDrag(host,{dragging(active){if(active)chart.dispatchAction({type:'hideTip'});},point:coordinate,clear:clearArea,click(e){
   const r=host.getBoundingClientRect(),i=labels?.hit(e.clientX-r.left,e.clientY-r.top);
   if(i===undefined)return false;
   onSelect(rows[i].ticker);return true;
 },select(a,b){showArea({coordRange:kind==='scatter'?[[Math.max(0,Math.min(a[0],b[0])),Math.min(100,Math.max(a[0],b[0]))],[Math.max(0,Math.min(a[1],b[1])),Math.min(100,Math.max(a[1],b[1]))]]:[a,b]});}});
 const touchCleanup=scope.QuantTouchChart?.bindTouchChart(host,{
   axis:kind==='scatter'?'x':'y',
   hit:(p,clamp)=>clamp||chart.containPixel({gridIndex:0},p)?coordinate({clientX:p[0]+host.getBoundingClientRect().left,clientY:p[1]+host.getBoundingClientRect().top}):null,
   inspect:(value,pixel)=>{
     let i=labels?.hit(...(pixel||[]));
     if(i===undefined&&Array.isArray(value)){
       const p=chart.convertToPixel({gridIndex:0},value);let best=24;
       rows.forEach((row,index)=>{const q=chart.convertToPixel({gridIndex:0},[row.x,row.y]),d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d<best){best=d;i=index;}});
     }
     if(i===undefined&&Number.isInteger(value))i=value;
     if(rows[i]){onSelect(rows[i].ticker);if(kind!=='scatter')chart.dispatchAction({type:'showTip',seriesIndex:0,dataIndex:i});}
   },
   compare:(a,b)=>showArea({coordRange:kind==='scatter'?[[Math.min(a[0],b[0]),Math.max(a[0],b[0])],[Math.min(a[1],b[1]),Math.max(a[1],b[1])]]:[a,b]}),
   clear:clearArea,rangeReadout:()=>output,
   navigate:(a,b)=>scope.QuantTouchChart.navigateECharts(chart,a,b,kind==='scatter'?2:Math.min(50,200/rows.length))
 });
 const reset=document.createElement('button');reset.type='button';reset.dataset.quantResetView='';reset.textContent='전체 범위';reset.hidden=true;clear.after(reset);
 reset.onclick=()=>chart.dispatchAction({type:'dataZoom',batch:(chart.getOption?.()?.dataZoom||[]).map((_,dataZoomIndex)=>({dataZoomIndex,start:0,end:100}))});
 chart.on('datazoom',()=>{labels?.schedule();drawSelection();presenter?.place(geometry());reset.hidden=!(chart.getOption?.()?.dataZoom||[]).some(z=>z.start>0||z.end<100);});
 host.ondblclick=reset.onclick;
 chart.on('click',p=>{if(rows[p.dataIndex])onSelect(rows[p.dataIndex].ticker);});
 host.onkeydown=e=>{if(e.key==='0'){reset.click();e.preventDefault();return;}if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Escape'].includes(e.key))return;e.preventDefault();if(e.key==='Escape'){clear.onclick();onSelect('');return;}selected=e.key==='Home'?0:e.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,selected+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1)));onSelect(rows[selected].ticker);if(kind!=='scatter')chart.dispatchAction({type:'showTip',seriesIndex:0,dataIndex:selected});};
 const resize=new ResizeObserver(()=>{chart.resize();labels?.schedule();drawSelection();presenter?.place(geometry());});resize.observe(host);const theme=new MutationObserver(render);theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
 const api={select(ticker){selected=rows.findIndex(r=>r.ticker===ticker);labels?.setSelected(ticker);chart.dispatchAction({type:'downplay'});if(selected>=0)chart.dispatchAction({type:'highlight',seriesIndex:0,dataIndex:selected});refreshPoint();host.setAttribute('aria-label',kind==='scatter'?'가격·실적 모멘텀 0–100점, '+rows.length+'개 종목. 점선 50점. 방향키로 종목을 확인합니다.':rows.map(r=>`${r.ticker} ${r.value.toFixed(2)}${kind==='percent'?'%':'점'}`).join('; '));},destroy(){touchCleanup?.();disposeDrag();host.ondblclick=null;reset.remove();resize.disconnect();theme.disconnect();presenter?.destroy();labels?.destroy();selectionLayer.remove();chart.dispose();output.remove();point.remove();clear.remove();}};mounted.set(host,api);render();api.select('');return true;
},select(ticker){for(const item of mounted.values())item.select(ticker);}
};
})(window);
