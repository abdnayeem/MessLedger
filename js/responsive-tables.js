/*
 * responsive-tables.js
 * ---------------------------------------------------------------
 * Presentation-only helper. app.js renders many <table> elements
 * dynamically via innerHTML. On narrow screens css/style.css turns
 * each row into a stacked "receipt line" card, and uses the CSS
 * `content: attr(data-label)` trick to print each cell's column
 * header next to its value.
 *
 * That trick needs a data-label attribute on every <td>. Rather than
 * editing every render*() function in app.js (risking the business
 * logic they contain), this script watches #content and #who-box
 * and stamps data-label attributes onto any table it finds, reading
 * the label straight from that table's own <thead>. It never reads
 * or changes any application data — purely cosmetic markup.
 * ---------------------------------------------------------------
 */
(function () {
  function labelTable(table) {
    if (table.dataset.mlLabeled === '1') return; // already done, skip re-work
    const headerCells = table.querySelectorAll('thead th');
    if (!headerCells.length) return;
    const labels = Array.from(headerCells).map(th => th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach(tr => {
      Array.from(tr.children).forEach((td, i) => {
        if (labels[i] && !td.hasAttribute('data-label')) {
          td.setAttribute('data-label', labels[i]);
        }
      });
    });
    table.dataset.mlLabeled = '1';
  }

  function labelAll(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('table').forEach(labelTable);
  }

  function watch(rootId) {
    const root = document.getElementById(rootId);
    if (!root) return;
    labelAll(root);
    const observer = new MutationObserver(() => labelAll(root));
    observer.observe(root, { childList: true, subtree: true });
  }

  function start() {
    watch('content');
    watch('who-box');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();