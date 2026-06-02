/* Shared site behaviour: mobile menu + scroll reveal */
(function(){
  // ---- mobile full-screen menu ----
  function bindMenu(){
    var toggle = document.querySelector('.nav-toggle');
    var overlay = document.getElementById('navOverlay');
    if(!toggle || !overlay) return;
    var closeBtn = overlay.querySelector('.nav-ov-close');
    function open(){ overlay.classList.add('open'); document.body.classList.add('menu-open'); toggle.setAttribute('aria-expanded','true'); }
    function close(){ overlay.classList.remove('open'); document.body.classList.remove('menu-open'); toggle.setAttribute('aria-expanded','false'); }
    toggle.addEventListener('click', open);
    if(closeBtn) closeBtn.addEventListener('click', close);
    overlay.querySelectorAll('a').forEach(function(a){ a.addEventListener('click', close); });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape') close(); });
  }

  // ---- scroll reveal ----
  function bindReveal(){
    var els = document.querySelectorAll('.reveal');
    if(!('IntersectionObserver' in window)){ els.forEach(function(el){ el.classList.add('in'); }); return; }
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold:0.12 });
    els.forEach(function(el){ io.observe(el); });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ bindMenu(); bindReveal(); });
  else { bindMenu(); bindReveal(); }
})();
