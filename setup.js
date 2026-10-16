(() => {
  const form = document.getElementById('form');
  const bday = document.getElementById('birthday');
  const pass = document.getElementById('passcode');
  const hint = document.getElementById('countdownHint');
  let passEdited = false;

  // Next 12:00 AM (local) of the birthday's month/day; today counts if it's the birthday.
  function nextMidnight(iso) {
    const [, m, d] = iso.split('-').map(Number);
    const now = new Date();
    let t = new Date(now.getFullYear(), m - 1, d, 0, 0, 0);
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (t < startToday) t = new Date(now.getFullYear() + 1, m - 1, d, 0, 0, 0);
    return t;
  }
  const fmt = t => t.toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  pass.addEventListener('input', () => { passEdited = true; pass.value = pass.value.replace(/\D/g, '').slice(0, 4); });
  bday.addEventListener('change', () => {
    if (!bday.value) return;
    const [, m, d] = bday.value.split('-');
    if (!passEdited) pass.value = d + m;                       // auto passcode DDMM
    hint.textContent = 'Auto-set: unlocks at ' + fmt(nextMidnight(bday.value)) + '.';
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    form.querySelectorAll('.err').forEach(x => x.textContent = '');
    const btn = document.getElementById('submitBtn');
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const res = await fetch('/api/create', { method: 'POST', body: new FormData(form) });
      const data = await res.json();
      if (!data.ok) {
        for (const [k, v] of Object.entries(data.errors || {})) {
          const el = form.querySelector(`.err[data-for="${k}"]`); if (el) el.textContent = v;
        }
        return;
      }
      document.getElementById('link').value = data.url;
      document.getElementById('codeShow').textContent = pass.value;
      document.getElementById('unlockText').textContent = fmt(nextMidnight(bday.value));
      document.getElementById('preview').href = data.url + '?preview=1';
      const r = document.getElementById('result'); r.hidden = false; r.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      alert('Could not reach the server. Is app.py running?');
    } finally {
      btn.disabled = false; btn.innerHTML = 'Create the gift &#127873;';
    }
  });

  document.getElementById('copy').addEventListener('click', async () => {
    const l = document.getElementById('link'); l.select();
    try { await navigator.clipboard.writeText(l.value); } catch { document.execCommand('copy'); }
    document.getElementById('copy').textContent = 'Copied!';
  });
})();
