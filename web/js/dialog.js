/* In-app dialogs: replace the browser's plain confirm()/prompt() pop-ups.
   OR.confirm(message, onYes, opts)   opts: {ok:'Delete', title:'..', danger:true, cancel:'Keep'}
   OR.ask(title, value, onDone, opts) onDone(text) only when the rider presses Save */
(function () {
  const OR = window.OR;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let cur = null;
  function close(run) {
    if (!cur) return;
    const c = cur; cur = null;
    c.el.classList.add('out');
    setTimeout(() => c.el.remove(), 160);
    document.removeEventListener('keydown', c.key, true);
    if (run) run();
  }
  function open(html, opts, onOk, onCancel) {
    close();
    const el = document.createElement('div');
    el.id = 'orDlg'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = '<div class="dbox' + (opts.danger ? ' danger' : '') + '">' + html +
      '<div class="dbtns"><button class="dno" type="button">' + esc(opts.cancel || 'Cancel') + '</button>' +
      '<button class="dyes" type="button">' + esc(opts.ok || 'OK') + '</button></div></div>';
    const key = e => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(onCancel); }
      else if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); yes(); }
    };
    const yes = () => close(onOk);
    cur = { el, key };
    el.querySelector('.dno').onclick = () => close(onCancel);
    el.querySelector('.dyes').onclick = yes;
    el.addEventListener('click', e => { if (e.target === el) close(onCancel); });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(el);
    const f = el.querySelector('input') || el.querySelector('.dyes');
    setTimeout(() => { try { f.focus(); if (f.select) f.select(); } catch (e) {} }, 30);
    return el;
  }
  OR.confirm = function (msg, onYes, opts) {
    opts = opts || {};
    if (opts.danger == null) opts.danger = /^(delete|remove|clear|leave|end|put back)/i.test(opts.ok || '');
    open((opts.title ? '<h3>' + esc(opts.title) + '</h3>' : '') + '<p>' + esc(msg) + '</p>', opts, () => onYes && onYes(), opts.onNo);
  };
  OR.ask = function (title, value, onDone, opts) {
    opts = Object.assign({ ok: 'Save' }, opts || {});
    const el = open('<h3>' + esc(title) + '</h3><input type="text" maxlength="80" value="' + esc(value) + '" autocomplete="off">', opts,
      () => onDone && onDone(el.querySelector('input').value));
  };
})();
