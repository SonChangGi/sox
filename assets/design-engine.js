import {createEngine} from './quant-engine/engine/index.js';
const root=document.documentElement;
const readTheme=()=>root.dataset.theme==='dark'?'dark':'light';
const engine=createEngine(root,{theme:readTheme()});
root.dataset.quantEngineVersion='0.4.0';
new MutationObserver(()=>{const theme=readTheme();if(engine.getTheme()!==theme)engine.setTheme(theme);}).observe(root,{attributes:true,attributeFilter:['data-theme']});
window.quantDesignEngine=engine;

const aliases={'qd-bg':'bg','qd-surface':'surface','qd-surface-2':'raised','qd-text':'text','qd-muted':'muted','qd-border':'border','qd-accent':'accent','bg':'bg','panel':'surface','surface':'raised','text':'text','ink':'text','muted':'muted','line':'border','accent':'accent'};
for(const element of [root,document.body])for(const [alias,token] of Object.entries(aliases))element.style.setProperty('--'+alias,'var(--qe-'+token+')','important');

