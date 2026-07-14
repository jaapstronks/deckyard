export function makeDragGhost({ num, title, typeLabel }) {
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.innerHTML = `
    <div class="row">
      <div class="ghost-num">${String(num)}</div>
      <div class="ghost-title">${String(title)}</div>
    </div>
    <div class="ghost-type">${String(typeLabel)}</div>
  `;
  document.body.appendChild(ghost);
  return ghost;
}
