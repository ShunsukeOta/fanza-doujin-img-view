(() => {
const body=document.body,feed=document.getElementById('feed'),works=[...document.querySelectorAll('.feed-item')],activeWork=document.getElementById('activeWork'),sheet=document.getElementById('filterSheet'),toast=document.getElementById('toast');let toastTimer;
const showToast=m=>{if(!toast)return;toast.textContent=m;toast.classList.add('is-show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('is-show'),1500)};
const openSheet=()=>{body.classList.add('sheet-open');sheet?.setAttribute('aria-hidden','false')},closeSheet=()=>{body.classList.remove('sheet-open');sheet?.setAttribute('aria-hidden','true')};
document.getElementById('filterOpen')?.addEventListener('click',openSheet);document.getElementById('emptyFilterOpen')?.addEventListener('click',openSheet);document.getElementById('filterClose')?.addEventListener('click',closeSheet);document.getElementById('sheetBackdrop')?.addEventListener('click',closeSheet);document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSheet()});
document.getElementById('resetFilters')?.addEventListener('click',()=>{const f=document.getElementById('filterForm');f.asset_type.value='all';f.genre_id.value='';f.min_samples.value='10';f.min_reviews.value='10';f.min_rating.value='4.5'});
if(!works.length)return;
const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting&&e.intersectionRatio>=.62){activeWork.textContent=String(Number(e.target.dataset.workIndex)+1);e.target.querySelector('img[loading="lazy"]')?.setAttribute('loading','eager')}}),{root:feed,threshold:[.62]});works.forEach(w=>observer.observe(w));
works.forEach(work=>{
 const track=work.querySelector('[data-preview-track]'),pages=[...track.querySelectorAll('.preview-page')],current=work.querySelector('[data-current-page]'),status=work.querySelector('[data-load-status]'),total=pages.length;let loaded=0,failed=0,ticking=false;
 const renderLoad=()=>{status.textContent=`API ${total}P · 読込 ${loaded}/${total}${failed?` · 失敗 ${failed}`:''}`;status.classList.toggle('has-error',failed>0)};
 pages.forEach(page=>{const img=page.querySelector('img');let counted=false;const ok=()=>{if(counted)return;counted=true;loaded++;renderLoad()},ng=()=>{if(counted)return;counted=true;failed++;page.classList.add('is-error');renderLoad()};if(img.complete){img.naturalWidth?ok():ng()}else{img.addEventListener('load',ok,{once:true});img.addEventListener('error',ng,{once:true})}});renderLoad();
 const pageIndex=()=>Math.max(0,Math.min(total-1,Math.round(track.scrollLeft/Math.max(1,track.clientWidth))));
 const sync=()=>{const i=pageIndex();current.textContent=String(i+1);pages[i+1]?.querySelector('img[loading="lazy"]')?.setAttribute('loading','eager')};
 track.addEventListener('scroll',()=>{if(ticking)return;ticking=true;requestAnimationFrame(()=>{sync();ticking=false})},{passive:true});
 const go=i=>{i=Math.max(0,Math.min(total-1,i));track.classList.remove('is-dragging');track.scrollTo({left:i*track.clientWidth,behavior:'smooth'});current.textContent=String(i+1)};
 let startX=0,startY=0,startScroll=0,startTime=0,axis='';
 track.addEventListener('touchstart',e=>{if(e.touches.length!==1)return;const t=e.touches[0];startX=t.clientX;startY=t.clientY;startScroll=track.scrollLeft;startTime=performance.now();axis='';track.classList.remove('is-dragging')},{passive:true});
 track.addEventListener('touchmove',e=>{if(e.touches.length!==1)return;const t=e.touches[0],dx=t.clientX-startX,dy=t.clientY-startY;if(!axis&&Math.max(Math.abs(dx),Math.abs(dy))>8)axis=Math.abs(dx)>Math.abs(dy)*1.12?'x':'y';if(axis!=='x')return;e.preventDefault();track.classList.add('is-dragging');track.scrollLeft=startScroll-dx},{passive:false});
 track.addEventListener('touchend',e=>{if(axis!=='x'){axis='';return}const t=e.changedTouches[0],dx=t.clientX-startX,elapsed=Math.max(1,performance.now()-startTime),velocity=Math.abs(dx)/elapsed;let target=Math.round(startScroll/Math.max(1,track.clientWidth));if(Math.abs(dx)>48||velocity>.45)target+=dx<0?1:-1;go(target);axis=''},{passive:true});
 track.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();go(pageIndex()+(e.key==='ArrowRight'?1:-1))}});
 const cid=work.dataset.cid,key=t=>`fanza-preview:${t}:${cid}`,like=work.querySelector('[data-like]'),save=work.querySelector('[data-save]'),share=work.querySelector('[data-share]');
 const syncLocal=(b,t)=>b?.classList.toggle('is-active',localStorage.getItem(key(t))==='1');syncLocal(like,'like');syncLocal(save,'save');
 const toggle=(b,t,on,off)=>{const active=localStorage.getItem(key(t))==='1';active?localStorage.removeItem(key(t)):localStorage.setItem(key(t),'1');b.classList.toggle('is-active',!active);showToast(active?off:on)};
 like?.addEventListener('click',()=>toggle(like,'like','いいねしました','いいね解除'));save?.addEventListener('click',()=>toggle(save,'save','保存しました','保存解除'));
 share?.addEventListener('click',async()=>{const url=work.dataset.url||location.href;try{navigator.share?await navigator.share({title:work.dataset.title,url}):(await navigator.clipboard.writeText(url),showToast('リンクをコピーしました'))}catch(e){if(e?.name!=='AbortError')showToast('共有できませんでした')}});
});
let wheelLock=false;feed.addEventListener('wheel',e=>{if(wheelLock||Math.abs(e.deltaY)<18)return;e.preventDefault();const i=Math.round(feed.scrollTop/feed.clientHeight),n=Math.max(0,Math.min(works.length-1,i+(e.deltaY>0?1:-1)));works[n].scrollIntoView({behavior:'smooth',block:'start'});wheelLock=true;setTimeout(()=>wheelLock=false,420)},{passive:false});
})();
