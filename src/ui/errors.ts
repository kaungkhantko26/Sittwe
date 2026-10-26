/** Full-screen error panel used when the game cannot start or load. */
export function showFatalError(root: HTMLElement, title: string, detail: string): void {
  root.querySelector('.fatal-error')?.remove();
  const el = document.createElement('div');
  el.className = 'fatal-error panel';
  const h = document.createElement('h2');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = detail;
  const btn = document.createElement('button');
  btn.className = 'btn primary';
  btn.textContent = 'Reload';
  btn.onclick = () => location.reload();
  el.append(h, p, btn);
  root.appendChild(el);
}
