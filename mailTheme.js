// HTML version of the mails of the Système Smaragdus, in the colours of the site (dark panel, gold rules, the emblem of the camp).
// Mail clients ignore web fonts and most CSS: the layout is made of tables with inline styles, the images are PNG at an absolute address,
// and everything stays readable when the images are blocked. The plain text is always sent too (multipart).

const C = { bg: '#0b0a0d', card: '#16131a', line: '#4a3d2a', gold: '#c9a96a', text: '#e8e2d4', dim: '#9a927f', red: '#e0452f', ly: '#e6c36a' };
const FONT = 'Georgia,\'Times New Roman\',serif';
const MONO = 'Consolas,\'Courier New\',monospace';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const URL_ONLY = /^https?:\/\/\S+$/;

// the plain text of a mail turned into blocks: paragraphs, bullet lists, a button for a line that is only a link
function blocks(text) {
  const out = [];
  for (const para of String(text).replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = para.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.length === 1 && URL_ONLY.test(lines[0].trim())) { out.push({ type: 'link', url: lines[0].trim() }); continue; }
    // a paragraph may mix lines of text and bullet lines: the bullets become a list of their own
    let run = [], bullets = [];
    const flush = () => { if (run.length) out.push({ type: 'p', lines: run }); if (bullets.length) out.push({ type: 'list', items: bullets }); run = []; bullets = []; };
    for (const l of lines) {
      if (/^[-•]\s/.test(l.trim())) { if (run.length && !bullets.length) { out.push({ type: 'p', lines: run }); run = []; } bullets.push(l.trim().replace(/^[-•]\s+/, '')); }
      else { if (bullets.length) flush(); run.push(l); }
    }
    flush();
  }
  return out;
}

const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" style="color:${C.gold};text-decoration:underline">${u}</a>`);

function button(url, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:6px auto 4px"><tr><td align="center" bgcolor="${C.gold}" style="border:1px solid ${C.gold}">
<a href="${esc(url)}" style="display:inline-block;padding:13px 30px;font-family:${FONT};font-size:15px;letter-spacing:2px;text-transform:uppercase;color:${C.bg};text-decoration:none;font-weight:bold">${esc(label)}</a></td></tr></table>`;
}

// camp: 'loyalist' | 'renegade' | null. options: { title, text, ctaLabel, siteUrl, sigils: [{label, code}] }
export function renderMail({ title, text, ctaLabel = 'Accéder à la console', siteUrl, camp = null, sigils = [] }) {
  const img = (f, w, alt) => `<img src="${siteUrl}/img/deco/${f}" width="${w}" alt="${esc(alt)}" style="display:block;margin:0 auto;border:0;height:auto">`;
  const accent = camp === 'renegade' ? C.red : C.gold;
  const body = blocks(text).map((b) => {
    if (b.type === 'link') return button(b.url, ctaLabel) + `<p style="margin:6px 0 18px;text-align:center;font-size:12px;color:${C.dim};word-break:break-all">${linkify(b.url)}</p>`;
    if (b.type === 'list') return `<ul style="margin:0 0 16px;padding-left:20px">${b.items.map((i) => `<li style="margin:0 0 6px">${linkify(i)}</li>`).join('')}</ul>`;
    return `<p style="margin:0 0 16px">${b.lines.map(linkify).join('<br>')}</p>`;
  }).join('');
  const sigilBoxes = sigils.map((s) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px"><tr><td style="border:1px solid ${C.line};background:#0f0d12;padding:12px 14px">
<div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${C.dim};margin-bottom:6px">${esc(s.label)}</div>
<div style="font-family:${MONO};font-size:20px;letter-spacing:2px;color:${C.gold}">${esc(s.code)}</div>${s.note ? `<div style="font-size:12px;color:${C.dim};margin-top:6px">${esc(s.note)}</div>` : ''}</td></tr></table>`).join('');
  const emblem = camp === 'loyalist' ? img('mail-loyalist.png', 110, 'Loyalistes') : camp === 'renegade' ? img('mail-renegade.png', 60, 'Renégats') : '';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};color:${C.text}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${C.card};border:1px solid ${C.line}">
<tr><td align="center" style="padding:30px 24px 10px">${img('mail-emblem.png', 72, 'Système Smaragdus')}
<div style="font-family:${FONT};font-size:22px;letter-spacing:5px;text-transform:uppercase;color:${C.gold};margin-top:14px">Système Smaragdus</div>
<div style="font-family:${FONT};font-size:12px;letter-spacing:2px;color:${C.dim};margin-top:6px">Console d’archives de la Flotte d’exploration</div></td></tr>
<tr><td style="padding:8px 28px 0"><div style="border-top:1px solid ${accent};height:1px;line-height:1px;font-size:1px">&nbsp;</div></td></tr>
<tr><td style="padding:22px 30px 8px;font-family:${FONT};font-size:16px;line-height:1.65;color:${C.text}">${body}${sigilBoxes}</td></tr>
<tr><td align="center" style="padding:0 30px 20px">${emblem}</td></tr>
<tr><td align="center" style="padding:18px 24px 26px;border-top:1px solid ${C.line}">${img('mail-seal.png', 44, 'Ordo Astronomica')}
<div style="font-family:${FONT};font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${C.dim};margin-top:10px">Omnia videre ◆ Omnia notare ◆ Omnia servire</div>
<div style="font-family:${FONT};font-size:11px;color:${C.dim};margin-top:6px">Ordo Astronomica · Archives du Segmentum Pacificus · M31</div></td></tr>
</table></td></tr></table></body></html>`;
}
