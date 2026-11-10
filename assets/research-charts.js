/* 0.4.1: shared plotting grammar, unchanged scores and semantic colours. */
(function(scope){
'use strict';
const mounted=new Map();
scope.SoxResearchCharts={
mount(host,rows,kind,color,onSelect){
 if(!scope.echarts)return false;
 mounted.get(host)?.destroy();host.replaceChildren();host.classList.remove('skeleton-box');host.classList.add('qe-research-chart');host.style.height=kind==='scatter'?'350px':'360px';host.tabIndex=0;host.setAttribute('role','img');
 const chart=scope.echarts.init(host,null,{renderer:'svg'});let selected=-1;
 const style=()=>getComputedStyle(document.documentElement);
 function render(){const st=style(),dark=document.documentElement.dataset.theme==='dark',muted=st.getPropertyValue('--muted').trim()||(dark?'#a6b4b6':'#53646c'),line=st.getPropertyValue('--line').trim()||(dark?'#364247':'#dce3e5'),ink=st.getPropertyValue('--text').trim()||(dark?'#edf3f2':'#172126'),accent=st.getPropertyValue(color).trim()||'#69d3cf';
 const option={animation:false,backgroundColor:'transparent',textStyle:{fontFamily:'Pretendard Variable, sans-serif'},grid:{top:24,right:56,bottom:36,left:16,containLabel:true},tooltip:{trigger:'item',confine:true,backgroundColor:dark?'#20282c':'#fff',textStyle:{color:ink},borderColor:line},series:[]};
 if(kind==='scatter'){option.grid={top:28,left:18,right:24,bottom:40,containLabel:true};option.xAxis={type:'value',min:0,max:100,name:'가격 모멘텀',nameLocation:'middle',nameGap:28,nameTextStyle:{color:muted},axisLabel:{color:muted},splitLine:{lineStyle:{color:line,type:'dashed'}}};option.yAxis={type:'value',min:0,max:100,name:'실적 모멘텀',nameTextStyle:{color:muted},axisLabel:{color:muted},splitLine:{lineStyle:{color:line,type:'dashed'}}};option.series=[{type:'scatter',data:rows.map(r=>({name:r.ticker,value:[r.x,r.y]})),symbolSize:10,itemStyle:{color:accent,opacity:.8},emphasis:{scale:1.6,label:{show:true,formatter:'{b}',color:ink}},markLine:{silent:true,symbol:'none',label:{show:false},lineStyle:{color:line},data:[{xAxis:50},{yAxis:50}]}}];option.tooltip.formatter=p=>`${p.name}<br>가격 ${p.value[0].toFixed(1)}점 · 실적 ${p.value[1].toFixed(1)}점`;
 }else{option.xAxis={type:'value',min:0,axisLabel:{color:muted,formatter:v=>v+(kind==='percent'?'%':'')},splitLine:{lineStyle:{color:line,type:'dashed'}}};option.yAxis={type:'category',inverse:true,data:rows.map(r=>r.ticker),axisTick:{show:false},axisLine:{show:false},axisLabel:{color:ink,fontSize:12}};option.series=[{type:'bar',data:rows.map(r=>({name:r.ticker,value:r.value})),barMaxWidth:18,itemStyle:{color:accent,borderRadius:[0,3,3,0]},label:{show:true,position:'right',formatter:p=>p.value.toFixed(1)+(kind==='percent'?'%':''),color:ink,fontSize:11},emphasis:{focus:'none'}}];option.tooltip.formatter=p=>`${p.name} · ${p.value.toFixed(2)}${kind==='percent'?'%':'점'}`;}
 chart.setOption(option,true);if(selected>=0)chart.dispatchAction({type:'highlight',seriesIndex:0,dataIndex:selected});
 }
 chart.on('click',p=>{if(rows[p.dataIndex])onSelect(rows[p.dataIndex].ticker);});
 host.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Escape'].includes(e.key))return;e.preventDefault();if(e.key==='Escape'){onSelect('');return;}selected=e.key==='Home'?0:e.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,selected+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1)));onSelect(rows[selected].ticker);chart.dispatchAction({type:'showTip',seriesIndex:0,dataIndex:selected});};
 const resize=new ResizeObserver(()=>chart.resize());resize.observe(host);const theme=new MutationObserver(render);theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
 const api={select(ticker){selected=rows.findIndex(r=>r.ticker===ticker);chart.dispatchAction({type:'downplay'});if(selected>=0)chart.dispatchAction({type:'highlight',seriesIndex:0,dataIndex:selected});host.setAttribute('aria-label',kind==='scatter'?'가격·실적 모멘텀, 0–100점. '+rows.map(r=>`${r.ticker} ${r.x.toFixed(1)}, ${r.y.toFixed(1)}`).join('; '):rows.map(r=>`${r.ticker} ${r.value.toFixed(2)}${kind==='percent'?'%':'점'}`).join('; '));},destroy(){resize.disconnect();theme.disconnect();chart.dispose();}};mounted.set(host,api);render();api.select('');return true;
},select(ticker){for(const item of mounted.values())item.select(ticker);}
};
})(window);
