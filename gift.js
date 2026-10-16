(() => {
  const G = window.GIFT;
  const $ = id => document.getElementById(id);
  const preview = new URLSearchParams(location.search).has('preview');
  const stages = ['countdown', 'pass', 'made', 'excited', 'hearts', 'memories', 'letter', 'wish'];
  let content = null;                 // letter + photos, returned by the server after the passcode
  const opened = new Set();

  // receiver's name inside the pages (textContent = safe against HTML injection)
  $('cdWho').textContent = `A birthday surprise for ${G.receiver} \u{1F382}`;
  $('passHi').textContent = `Hi ${G.receiver}, enter the 4-digit secret passcode`;
  $('heartTip').textContent = `${G.receiver}, tap on a mystery box to unlock your gifts!`;

  function show(name) {
    document.querySelectorAll('.stage').forEach(s => s.classList.remove('active'));
    $('s-' + name).classList.add('active');
  }

  /* ------------------------------------------------ 1. countdown to 12:00 AM */
  function target() {                                    // birthday at 00:00 local time
    const [, m, d] = G.birthday.split('-').map(Number);
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let t = new Date(now.getFullYear(), m - 1, d, 0, 0, 0);
    if (t < startToday) t = new Date(now.getFullYear() + 1, m - 1, d, 0, 0, 0);
    return t;
  }
  const T = target();
  const pad = n => String(n).padStart(2, '0');
  let done = false, timer;

  function tick() {
    const now = new Date();
    const left = Math.max(0, T - now);
    const totalH = Math.floor(left / 3.6e6);
    $('digits').textContent = (totalH >= 100 ? totalH : pad(totalH)) + ':' + pad(Math.floor(left / 6e4) % 60) + ':' + pad(Math.floor(left / 1e3) % 60);
    // analog clock shows the real time and sweeps to 12:00
    const s = now.getSeconds(), m = now.getMinutes() + s / 60, h = (now.getHours() % 12) + m / 60;
    if (left === 0) { $('hH').style.transform = $('hM').style.transform = $('hS').style.transform = 'rotate(0deg)'; }
    else {
      $('hS').style.transform = `rotate(${s * 6}deg)`; $('hM').style.transform = `rotate(${m * 6}deg)`; $('hH').style.transform = `rotate(${h * 30}deg)`;
    }
    const days = Math.floor(left / 864e5);
    $('cdNote').textContent = left === 0 ? "It's 12:00 — happy birthday!" :
      (days ? `${days} day${days > 1 ? 's' : ''} to go · ` : '') + 'Watch the clock strike 12:00';
    if (left === 0 && !done) { done = true; clearInterval(timer); unlock(); }
  }
  function unlock() {
    $('s-countdown').classList.add('opened');             // curtains open
    burst();
    setTimeout(() => show('pass'), 2600);
  }

  /* ------------------------------------------------ 2. passcode (checked by Python) */
  let code = '';
  const dots = [...$('dots').children];
  function paint() { dots.forEach((d, i) => d.classList.toggle('on', i < code.length)); }
  async function submitCode() {
    if (code.length < 4) return;
    try {
      const r = await fetch(`/api/g/${G.id}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      if (!r.ok) throw 0;
      content = await r.json();
      $('passMsg').textContent = '';
      show('made');
    } catch {
      $('passMsg').textContent = 'Wrong passcode, try again';
      $('dots').classList.add('shake'); setTimeout(() => $('dots').classList.remove('shake'), 400);
      code = ''; paint();
    }
  }
  $('keypad').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const k = b.dataset.k;
    if (k === 'del') code = code.slice(0, -1);
    else if (k === 'ok') return submitCode();
    else if (code.length < 4) code += b.textContent.trim();
    paint(); if (code.length === 4 && !k) submitCode();
  });
  document.addEventListener('keydown', e => {
    if (!$('s-pass').classList.contains('active')) return;
    if (/^\d$/.test(e.key) && code.length < 4) { code += e.key; paint(); if (code.length === 4) submitCode(); }
    if (e.key === 'Backspace') { code = code.slice(0, -1); paint(); }
  });

  /* ------------------------------------------------ 3. "I made something for you" */
  $('s-made').querySelector('h2').textContent = `I have made something for you, ${G.receiver}`;
  $('yes1').onclick = () => show('excited');
  const no = $('no1'); let tries = 0;
  const dodge = e => {
    e.preventDefault(); tries++;
    const x = (Math.random() - .5) * Math.min(window.innerWidth - 120, 260), y = (Math.random() - .5) * 180;
    no.style.transform = `translate(${x}px,${y}px) rotate(${(Math.random() - .5) * 30}deg)`;
    $('s-made').querySelector('.small').textContent = ['Do you wanna see it ?', 'Are you sure? 🥺', 'Please say YES! 💗', 'The NO button is broken 😜', 'Just press YES 😘'][Math.min(tries, 4)];
  };
  no.addEventListener('mouseenter', dodge); no.addEventListener('touchstart', dodge, { passive: false }); no.addEventListener('click', dodge);

  /* ------------------------------------------------ 4. excited */
  $('yes2').onclick = $('yes3').onclick = () => { burst(); setTimeout(() => show('hearts'), 500); };

  /* ------------------------------------------------ 5. hearts → memories → letter → wish */
  const order = ['memories', 'letter', 'wish'];
  $('hearts').addEventListener('click', e => {
    const h = e.target.closest('.heart'); if (!h || h.classList.contains('done')) return;
    const i = +h.dataset.i;
    if (opened.size !== i && !opened.has(i)) { /* any heart opens the next gift in order */ }
    const next = order[opened.size]; opened.add(i); h.classList.add('done');
    burst(); openGift(next);
  });
  function backToHearts() {
    if (opened.size >= 3) return;
    $('heartTip').textContent = opened.size === 2 ? `${G.receiver}, one last mystery box is waiting for you!` : `Great, ${G.receiver}! Tap another mystery box!`;
    show('hearts');
  }
  function openGift(name) {
    show(name);
    if (name === 'memories') buildMemories();
    if (name === 'letter') typeLetter();
    if (name === 'wish') buildCake();
  }

  /* ---- memories */
  function buildMemories() {
    $('memTitle').textContent = 'M E M O R I E S';
    const defaults = [{ e: '🌸', c: 'Our first smile' }, { e: '🍕', c: 'Late night snacks' }, { e: '🌅', c: 'Sunsets together' }];
    const photos = (content.photos.length ? content.photos : defaults.map(d => ({ emoji: d.e, caption: d.c })));
    const box = $('polaroids'); box.innerHTML = '';
    photos.forEach(p => {
      const b = document.createElement('button'); b.className = 'pol';
      const ph = document.createElement('span'); ph.className = 'ph'; ph.style.display = 'grid';
      if (p.src) { ph.style.backgroundImage = `url("${p.src}")`; } else ph.textContent = p.emoji;
      const cap = document.createElement('span'); cap.className = 'cap'; cap.textContent = p.caption || '♥';
      b.append(ph, cap);
      b.onclick = () => { const lb = $('lbImg'); lb.style.backgroundImage = p.src ? `url("${p.src}")` : 'none'; lb.textContent = p.src ? '' : p.emoji; $('lbCap').textContent = p.caption || ''; $('lightbox').hidden = false; };
      box.append(b);
    });
  }
  document.querySelector('#s-memories [data-close]').onclick = backToHearts;
  document.querySelector('[data-lbclose]').onclick = () => $('lightbox').hidden = true;
  $('lightbox').onclick = e => { if (e.target === $('lightbox')) $('lightbox').hidden = true; };

  /* ---- letter (typewriter) */
  function typeLetter() {
    const text = `Dear ${G.receiver},\n\n` + content.letter + `\n\n— ${G.sender} ♥`;
    const el = $('letterText'); el.textContent = ''; $('letterNext').hidden = true;
    let i = 0;
    const t = setInterval(() => { el.textContent = text.slice(0, ++i); if (i >= text.length) { clearInterval(t); $('letterNext').hidden = false; } }, 28);
    $('letterNext').onclick = () => { clearInterval(t); backToHearts(); };
  }

  /* ---- wish cake */
  function buildCake() {
    const wrap = $('candles'); wrap.innerHTML = ''; $('final').hidden = true; $('wishTip').hidden = false;
    let lit = 5;
    for (let i = 0; i < 5; i++) {
      const c = document.createElement('div'); c.className = 'candle';
      c.onclick = () => {
        if (c.classList.contains('out')) return;
        c.classList.add('out'); lit--;
        if (lit === 0) {
          $('wishTip').hidden = true; $('final').hidden = false;
          $('finalMsg').textContent = `Happy Birthday, ${G.receiver}! May all your wishes come true. With love, ${G.sender} 💖`;
          burst(220); setTimeout(() => burst(160), 900);
        }
      };
      wrap.append(c);
    }
  }

  /* ------------------------------------------------ confetti */
  const cv = $('confetti'), cx = cv.getContext('2d'); let parts = [], raf;
  const fit = () => { cv.width = innerWidth; cv.height = innerHeight; }; fit(); addEventListener('resize', fit);
  function burst(n = 90) {
    const cols = ['#ff5c8a', '#ffd34d', '#6fd3ff', '#9b7bff', '#5fe3a1', '#fff'];
    for (let i = 0; i < n; i++) parts.push({ x: innerWidth / 2, y: innerHeight * .4, vx: (Math.random() - .5) * 14, vy: -Math.random() * 13 - 3, g: .3, s: Math.random() * 7 + 4, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: cols[i % cols.length], life: 140 + Math.random() * 60 });
    if (!raf) loop();
  }
  function loop() {
    cx.clearRect(0, 0, cv.width, cv.height);
    parts = parts.filter(p => p.life-- > 0 && p.y < cv.height + 20);
    parts.forEach(p => { p.vy += p.g; p.x += p.vx; p.y += p.vy; p.vx *= .99; p.r += p.vr; cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.fillStyle = p.c; cx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); cx.restore(); });
    raf = parts.length ? requestAnimationFrame(loop) : null;
  }
  /* ------------------------------------------------ start (must stay last: unlock() uses code defined above) */
  if (preview) { $('cdNote').textContent = 'Preview mode — skipping the wait'; setTimeout(unlock, 900); }
  else { tick(); timer = setInterval(tick, 1000); }
})();