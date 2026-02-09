(function(){
  const img = document.getElementById('cardImg');
  const counter = document.getElementById('counter');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const homeBtn = document.getElementById('homeBtn');
  const stage = document.getElementById('stage');

  let i = 0;
  let touchStartX = null;
  let touchStartY = null;
  let busy = false;

  function setCounter() {
    counter.textContent = (i + 1) + '/' + CARDS.length;
  }

  function show(index, dir) {
    if (busy) return;
    busy = true;

    // clamp
    if (index < 0) index = 0;
    if (index >= CARDS.length) index = CARDS.length - 1;

    const cls = dir === 'next' ? 'slide-left' : 'slide-right';
    img.classList.add(cls);

    // preload next
    const pre = new Image();
    pre.src = 'cards/' + CARDS[index];

    setTimeout(() => {
      i = index;
      img.src = 'cards/' + CARDS[i];
      setCounter();

      // reset animation
      img.classList.remove('slide-left');
      img.classList.remove('slide-right');

      // small fade-in
      img.style.opacity = '0.0';
      requestAnimationFrame(() => {
        img.style.opacity = '1.0';
        busy = false;
      });
    }, 190);
  }

  function next() { show(i + 1, 'next'); }
  function prev() { show(i - 1, 'prev'); }
  function home() { show(0, 'prev'); }

  prevBtn.addEventListener('click', prev);
  nextBtn.addEventListener('click', next);
  homeBtn.addEventListener('click', home);

  // tap left/right on stage
  stage.addEventListener('click', (e) => {
    const rect = stage.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width * 0.45) prev();
    else next();
  });

  // keyboard
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') next();
    if (e.key === 'ArrowLeft') prev();
    if (e.key === 'Home') home();
  });

  // touch swipe
  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, {passive:true});

  stage.addEventListener('touchend', (e) => {
    if (touchStartX == null) return;

    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;

    touchStartX = null;
    touchStartY = null;

    // ignore vertical scroll
    if (Math.abs(dy) > Math.abs(dx)) return;

    if (dx < -35) next();
    if (dx > 35) prev();
  }, {passive:true});

  function parseStartIndex() {
    try {
      // ?card=10 or ?i=10 or #10 or #card=10
      const url = new URL(window.location.href);
      const qp = url.searchParams;
      const q = qp.get('card') || qp.get('i');
      if (q) {
        const n = parseInt(q, 10);
        if (!isNaN(n)) return n - 1; // user uses 1..32
      }

      const h = (window.location.hash || '').replace('#', '').trim();
      if (!h) return 0;

      // allow formats: "10" or "card=10"
      const m = h.match(/(\d+)/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n)) return n - 1;
      }
      return 0;
    } catch (e) {
      return 0;
    }
  }

  // expose small API for app/webview control
  window.MENTAL_DECK = {
    next,
    prev,
    home,
    setCard: (oneBasedIndex) => {
      const n = parseInt(oneBasedIndex, 10);
      if (isNaN(n)) return;
      show(n - 1, 'next');
    },
    getCard: () => i + 1,
    count: () => CARDS.length
  };

  const startIndex = parseStartIndex();
  if (startIndex > 0) {
    show(startIndex, 'next');
  } else {
    setCounter();
  }
})();
