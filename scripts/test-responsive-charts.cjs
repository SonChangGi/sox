const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const outputs=[],handlers={};let option,disposed=0;
function element(tag){const button={textContent:''};const e={style:{},classList:{remove(){},add(){}},replaceChildren(){},setAttribute(){},before(){},after(){},remove(){},focus(){},querySelector(){return button;}};if(tag==='output')outputs.push(e);return e;}
const chart={setOption(o){option=o;},on(k,f){handlers[k]=f;},dispatchAction(){},resize(){},dispose(){disposed++;}};
const ctx={window:{echarts:{init:()=>chart}},document:{documentElement:{dataset:{theme:'dark'}},createElement:element},getComputedStyle:()=>({getPropertyValue:()=>''}),ResizeObserver:class{observe(){}disconnect(){}},MutationObserver:class{observe(){}disconnect(){}}};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../assets/research-charts.js'),'utf8'),ctx);
const api=ctx.window.SoxResearchCharts,host=element('div');const rows=[{ticker:'A',value:1},{ticker:'B',value:2}],before=JSON.stringify(rows);let selected;
assert(api.mount(host,rows,'percent','--accent',s=>selected=s));assert.equal(option.xAxis.min,0);assert.deepEqual(Array.from(option.series[0].data,p=>p.value),[1,2]);
handlers.brushEnd({areas:[{coordRange:[0,1]}]});assert.equal(outputs.at(-1).textContent,'A, B · 합계 3.00%');handlers.click({dataIndex:1});assert.equal(selected,'B');assert.equal(JSON.stringify(rows),before);api.unmount(host);assert.equal(disposed,1);
api.mount(host,[{ticker:'A',x:20,y:30},{ticker:'B',x:80,y:90}],'scatter','--accent',()=>{});assert.equal(option.xAxis.max,100);assert.equal(option.yAxis.max,100);handlers.brushEnd({areas:[{coordRange:[[10,40],[10,50]]}]});assert(outputs.at(-1).textContent.endsWith('1종목 · A'));api.unmount(host);assert.equal(disposed,2);
console.log('PASS responsive SOX charts: immutable values, fixed axes, selection, interval sum, region members and disposal');
