import { serve } from "bun";

const port = Number(process.env.PORT ?? 4178);

function page(mode: "broken" | "fixed"): string {
	const broken = mode === "broken";
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Delayed completion fixture · ${mode}</title>
<style>
:root{font:16px/1.5 system-ui;color:#18212f;background:#f4f7fb}body{margin:0;display:grid;min-height:100vh;place-items:center}.card{width:min(620px,calc(100vw - 48px));background:#fff;border:1px solid #d9e1ec;border-radius:18px;padding:28px;box-shadow:0 18px 50px #22334b18}h1{margin:0 0 8px;font-size:26px}.muted{color:#68758a}.row{display:flex;gap:12px;align-items:center;margin-top:20px}button{border:0;border-radius:10px;background:#315fdd;color:#fff;padding:11px 18px;font:inherit;font-weight:650;cursor:pointer}button:disabled{opacity:.55;cursor:not-allowed}.status{margin-top:22px;border-radius:12px;background:#f4f7fb;padding:16px;min-height:72px}.badge{display:inline-flex;border-radius:999px;padding:3px 9px;font-size:12px;font-weight:700;background:#dce7ff;color:#244aaf}.badge.complete{background:#dcf7e9;color:#16643b}.badge.resumed{background:#ffdfdf;color:#962c2c}#details{margin-top:8px;font-family:ui-monospace,monospace;font-size:14px}.foot{margin-top:22px;color:#8390a3;font-size:13px}</style>
</head>
<body>
<main class="card">
<h1>Assistant response</h1>
<p class="muted">Start a response and observe its lifecycle.</p>
<div class="row"><button id="start">Start response</button><button id="new">New response</button></div>
<section class="status" aria-live="polite">
<span id="badge" class="badge">idle</span>
<div id="details">No response started.</div>
</section>
<p class="foot">Fixture build: <strong>${mode}</strong></p>
</main>
<script>
const mode=${JSON.stringify(mode)};
const broken=${JSON.stringify(broken)};
const start=document.querySelector('#start');
const fresh=document.querySelector('#new');
const badge=document.querySelector('#badge');
const details=document.querySelector('#details');
const render=(state,text)=>{badge.className='badge '+state;badge.textContent=state;details.textContent=text;document.body.dataset.state=state};
let timer;
function begin(){clearTimeout(timer);start.disabled=true;render('working','Generating response…');setTimeout(()=>{start.disabled=false;render('complete','Response complete.');sessionStorage.setItem('fixture:completed','yes');if(broken){sessionStorage.setItem('fixture:pendingResume',String(Date.now()+2200));timer=setTimeout(()=>{render('resumed','Unexpected continuation arrived after completion.');sessionStorage.removeItem('fixture:pendingResume');sessionStorage.removeItem('fixture:completed')},2200)}},700)}
start.addEventListener('click',begin);
fresh.addEventListener('click',()=>{clearTimeout(timer);sessionStorage.removeItem('fixture:pendingResume');start.disabled=false;render('idle','No response started.')});
const completed=sessionStorage.getItem('fixture:completed')==='yes';
const pending=Number(sessionStorage.getItem('fixture:pendingResume')||0);
if(completed){sessionStorage.removeItem('fixture:completed');render('complete','Response complete.');if(pending&&broken){const remaining=pending-Date.now();if(remaining>0){timer=setTimeout(()=>{render('resumed','Unexpected continuation arrived after completion.');sessionStorage.removeItem('fixture:pendingResume')},remaining)}else{sessionStorage.removeItem('fixture:pendingResume')}}else{sessionStorage.removeItem('fixture:pendingResume')}}
</script>
</body>
</html>`;
}

serve({
	port,
	fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/health") return Response.json({ ok: true });
		if (url.pathname === "/broken") return new Response(page("broken"), { headers: { "content-type": "text/html; charset=utf-8" } });
		if (url.pathname === "/fixed") return new Response(page("fixed"), { headers: { "content-type": "text/html; charset=utf-8" } });
		return Response.redirect(new URL("/broken", url), 302);
	},
});

console.log(`exp-014 fixture listening on http://127.0.0.1:${port}`);
