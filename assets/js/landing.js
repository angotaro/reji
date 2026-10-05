// Landing page: language toggle (shared with the app), today's date on the
// stamp, gentle reveal on scroll and a demo video that plays only when visible.
const root = document.documentElement;
root.classList.add('js');
const KEY = 'reji:lang';
let lang = 'ja';
try { lang = localStorage.getItem(KEY) || (/^ja\b/i.test(navigator.language || 'ja') ? 'ja' : 'en'); } catch { /* storage blocked */ }

function apply(next) {
  lang = next === 'en' ? 'en' : 'ja';
  root.dataset.lang = lang;
  root.lang = lang;
  document.title = lang === 'ja' ? 'Reji｜JPYCで受け取る、お店のレジ' : 'Reji | A register for taking JPYC';
}
apply(lang);

document.querySelector('[data-lang-toggle]')?.addEventListener('click', () => {
  apply(lang === 'ja' ? 'en' : 'ja');
  try { localStorage.setItem(KEY, lang); } catch { /* ignore */ }
});

const d = new Date();
for (const el of document.querySelectorAll('[data-today]')) el.textContent = `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
if ('IntersectionObserver' in window && !reduce) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
} else {
  document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
}

const video = document.querySelector('.lp-video video');
if (video && 'IntersectionObserver' in window && !reduce) {
  new IntersectionObserver(([e]) => { if (e.isIntersecting) video.play().catch(() => {}); else video.pause(); }, { threshold: 0.5 }).observe(video);
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
