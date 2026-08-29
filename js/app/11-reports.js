// ---------------------------------------------------------------------------
// 11-reports.js  (originally app.js lines 4227-4710)
// Printable report building blocks (header/avatar/stat/shell) and the day/personal-month report HTML generators + downloads
// ---------------------------------------------------------------------------
const MEAL_TYPE_LABEL = {
  lunch: 'Lunch',
  dinner: 'Dinner'
};

function buildMemberLedger(memberId) {
  const entries = [];
  Object.keys(state.days).sort().forEach(date => {
    const meals = state.days[date].meals || {};
    const rec = meals[memberId];
    if (!rec) return;
    const month = date.slice(0, 7);
    const rate = monthMealRate(month);
    ['lunch', 'dinner'].forEach(type => {
      const qty = rec[type] || 0;
      if (qty > 0) {
        entries.push({
          kind: 'meal',
          date,
          mealType: type,
          qty,
          rate,
          amount: qty * rate,
          addedBy: rec[type + 'By'] || '',
          createdAt: rec[type + 'At'] || null
        });
      }
    });
  });
  state.expenses.filter(e => e.memberIds.includes(memberId)).forEach(e => {
    entries.push({
      kind: 'expense',
      date: e.date,
      title: e.title || 'Shared expense',
      description: e.description || '',
      amount: expenseShareFor(e, memberId),
      addedBy: e.addedBy || '',
      createdAt: e.createdAt || null,
      splitType: e.splitType,
      mealTypeSplit: e.mealTypeSplit,
      isEveryoneFallback: e.memberIds.length === state.members.length
    });
  });
  state.deposits.filter(d => d.memberId === memberId).forEach(d => {
    entries.push({
      kind: 'deposit',
      date: d.date,
      note: d.note || '',
      amount: Number(d.amount),
      type: d.type || 'deposit',
      addedBy: d.addedBy || '',
      createdAt: d.createdAt || null
    });
  });
  entries.sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    // Same date: fall back to actual recorded time so deposits made earlier
    // in the day are applied before same-day deductions (and vice versa),
    // instead of always ordering by kind (meal -> expense -> deposit).
    // Entries without a createdAt (older data, before this field existed)
    // sort before ones that have it, keeping old behavior for them.
    const at = a.createdAt || 0;
    const bt = b.createdAt || 0;
    return at - bt;
  });
  let running = 0;
  entries.forEach(e => {
    e.balanceBefore = running;
    running += (e.kind === 'deposit') ? e.amount : -e.amount;
    e.balanceAfter = running;
  });
  return entries;
}

/* ---------------- PERSONAL DOWNLOADABLE REPORTS (Dashboard) ----------------
   Client-side only: builds a printable HTML page in a new tab which the
   member can Print → Save as PDF. Uses the exact same buildMemberLedger()
   entries (and therefore the exact same rates/amounts) already used
   throughout the app, so figures always match History/Dashboard.
   Visual style matches the "Person Based Daily Meal Rate" mockup: dark
   slate-blue headers, avatar bubble, rate×qty breakdown under costs, a
   Daily-Summary grid, a dark Grand Total bar, and a green rate-comparison
   callout. */
const REPORT_HEADER_BG = '#2F4A5E';
const REPORT_AVATAR_PALETTE = ['#6366F1', '#F59E0B', '#16A34A', '#DB2777', '#0EA5E9', '#8B5CF6', '#DC2626', '#0D9488'];

function formatLongDateStr(dateStr) {
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (e) {
    return dateStr;
  }
}

function reportAvatarColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % REPORT_AVATAR_PALETTE.length;
  return REPORT_AVATAR_PALETTE[Math.abs(h)];
}

function messLedgerReportHeader(subtitle) {
  return `
    <div style="display:flex; align-items:center; gap:14px; padding-bottom:14px; margin-bottom:16px; border-bottom:1px solid #E5E7EB;">
      <div style="width:44px; height:44px; min-width:44px; border-radius:10px; background:${REPORT_HEADER_BG}; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:20px;">M</div>
      <div>
        <div style="font-size:22px; font-weight:800; color:#111827;">MessLedger</div>
        <div style="font-size:13px; color:#6B7280;">${subtitle}</div>
      </div>
    </div>`;
}

function reportPersonBar(me, dateLabel) {
  const initial = (me && me.name ? me.name[0] : '?').toUpperCase();
  const color = reportAvatarColor(me ? me.name : '?');
  return `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:8px;">
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="width:34px; height:34px; min-width:34px; border-radius:8px; background:${color}; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:14px;">${initial}</div>
        <div>
          <div style="font-size:16px; font-weight:800; color:#111827;">${me?me.name:''}</div>
          <div style="font-size:12.5px; color:#6B7280;">${dateLabel}</div>
        </div>
      </div>
      <div style="font-size:11.5px; color:#6B7280;">Generated ${formatBDDateTime(nowTimestamp())}</div>
    </div>`;
}

function reportStatBox(label, value, bg, border) {
  return `<div style="flex:1; min-width:140px; background:${bg}; border:0.75px solid ${border}; border-radius:8px; padding:10px 13px;">
    <div style="font-size:8.5px; letter-spacing:.3px; text-transform:uppercase; color:#6B7280;">${label}</div>
    <div style="font-size:16px; font-weight:800; color:#111827; margin-top:3px;">${value}</div>
  </div>`;
}

function reportShell(bodyHtml, docTitle) {
  // Rendered as an in-page overlay (see openPrintableReport) rather than a
  // full HTML document opened via window.open(). On iOS home-screen web
  // apps, window.open('_blank') kicks the user out of the standalone PWA
  // and into Safari with no way back short of force-closing and reopening
  // the app. Keeping the report inside the same document avoids that.
  return `
    <div id="msledger-report-overlay" role="dialog" aria-label="${docTitle || 'MessLedger Report'}">
      <div class="msledger-report-topbar no-print">
        <div class="msledger-report-title">${docTitle || 'MessLedger Report'}</div>
        <div class="msledger-report-actions">
          <button type="button" onclick="window.print()">🖨️ Print / Save as PDF</button>
          <button type="button" onclick="closePrintableReport()">✕ Close</button>
        </div>
      </div>
      <div class="msledger-report-body">
        ${bodyHtml}
      </div>
    </div>`;
}

function ensureReportOverlayStyles() {
  if (document.getElementById('msledger-report-overlay-styles')) return;
  const style = document.createElement('style');
  style.id = 'msledger-report-overlay-styles';
  style.textContent = `
    #msledger-report-overlay{ position:fixed; inset:0; background:#fff; color-scheme:light; z-index:99999; overflow:auto;
      font-family: Arial, Helvetica, sans-serif; color:#111827; -webkit-overflow-scrolling:touch; }
    #msledger-report-overlay table{ width:100%; border-collapse:collapse; }
    #msledger-report-overlay th, #msledger-report-overlay td{ border-bottom: 1px solid #E5E7EB; }
    #msledger-report-overlay .msledger-report-topbar{ position:sticky; top:0; display:flex; gap:8px;
      justify-content:space-between; align-items:center; padding:10px 16px; background:#fff;
      border-bottom:1px solid #E5E7EB; z-index:2; }
    #msledger-report-overlay .msledger-report-title{ font-weight:700; font-size:13.5px; color:#111827; }
    #msledger-report-overlay .msledger-report-actions{ display:flex; gap:8px; flex-shrink:0; }
    #msledger-report-overlay .msledger-report-actions button{ border:none; padding:8px 14px; border-radius:6px;
      font-size:13px; cursor:pointer; white-space:nowrap; }
    #msledger-report-overlay .msledger-report-actions button:first-child{ background:${REPORT_HEADER_BG}; color:#fff; }
    #msledger-report-overlay .msledger-report-actions button:last-child{ background:#F3F4F6; color:#111827; }
    #msledger-report-overlay .msledger-report-body{ padding:24px; }
    body.msledger-report-open{ overflow:hidden; }
    @media print {
      body.msledger-report-open > *:not(#msledger-report-overlay){ display:none !important; }
      #msledger-report-overlay{ position:static !important; overflow:visible !important; }
      #msledger-report-overlay .no-print{ display:none !important; }
      #msledger-report-overlay .msledger-report-body{ padding:0; }
      @page{ margin: 14mm; }
    }`;
  document.head.appendChild(style);
}

let _reportOverlayHistoryPushed = false;

function _handleReportOverlayPopstate() {
  closePrintableReport(false);
}

function openPrintableReport(html) {
  ensureReportOverlayStyles();
  closePrintableReport(false); // remove any existing overlay first, without touching history
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  const overlay = wrapper.firstElementChild;
  document.body.appendChild(overlay);
  document.body.classList.add('msledger-report-open');
  window.addEventListener('popstate', _handleReportOverlayPopstate);
  // Push a history entry so the device/browser back button closes the
  // report overlay instead of leaving the app with nothing to "go back" to.
  try {
    history.pushState({ msledgerReport: true }, '');
    _reportOverlayHistoryPushed = true;
  } catch (e) {
    _reportOverlayHistoryPushed = false;
  }
}

function closePrintableReport(goBack) {
  const overlay = document.getElementById('msledger-report-overlay');
  window.removeEventListener('popstate', _handleReportOverlayPopstate);
  if (!overlay) return;
  overlay.remove();
  document.body.classList.remove('msledger-report-open');
  if (goBack !== false && _reportOverlayHistoryPushed) {
    _reportOverlayHistoryPushed = false;
    history.back();
  } else {
    _reportOverlayHistoryPushed = false;
  }
}

function reportSectionTitle(text) {
  return `<div style="font-size:12.5px; font-weight:700; margin:18px 0 6px; color:#111827;">${text}</div>`;
}

function reportGrandTotalBar(label, value) {
  return `<div style="margin-top:16px; background:${REPORT_HEADER_BG}; color:#fff; border-radius:8px; padding:13px 16px; display:flex; justify-content:space-between; align-items:center;">
    <div style="font-weight:700; font-size:13.5px;">${label}</div><div style="font-size:19px; font-weight:800;">${value}</div>
  </div>`;
}

function reportRateCallout(title, formula, rateStr, aboveMonthAvg) {
  const good = aboveMonthAvg === false;
  const bg = aboveMonthAvg === null ? '#F3F4F6' : (good ? '#E7F6EC' : '#FFEDD5');
  const border = aboveMonthAvg === null ? '#E5E7EB' : (good ? '#BBE5C8' : '#FCD9A8');
  const textColor = aboveMonthAvg === null ? '#374151' : (good ? '#166534' : '#9A3412');
  const tag = aboveMonthAvg === null ? '' : (good ? '<div style="font-size:11px; margin-top:2px;">▼ Below your month average</div>' : '<div style="font-size:11px; margin-top:2px;">▲ Above your month average</div>');
  return `<div style="margin-top:10px; background:${bg}; border:1px solid ${border}; border-radius:8px; padding:12px 16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
    <div><div style="font-weight:700; color:${textColor};">${title}</div>
      <div style="font-size:11.5px; color:${textColor};">${formula}</div>${tag}</div>
    <div style="font-size:19px; font-weight:800; color:${textColor};">${rateStr}</div>
  </div>`;
}

function reportSummaryGrid(pairs) {
  const rowsHtml = pairs.map(([l1, v1, l2, v2]) => `
    <tr>
      <td style="padding:9px 10px; font-weight:700; color:#3E5A70; font-size:9px; border-right:0.5px solid #E5E7EB;">${l1}</td>
      <td style="padding:9px 10px; text-align:right; font-size:9.5px; border-right:0.5px solid #E5E7EB;">${v1}</td>
      <td style="padding:9px 10px; font-weight:700; color:#3E5A70; font-size:9px;">${l2}</td>
      <td style="padding:9px 10px; text-align:right; font-size:9.5px;">${v2}</td>
    </tr>`).join('');
  return `<table style="border:0.6px solid #E5E7EB; border-collapse:collapse;"><tbody>${rowsHtml}</tbody></table>`;
}

function reportProgressBar(pct) {
  const clamped = Math.max(0, Math.min(100, pct));
  return `<div style="width:60px; height:6px; border-radius:3px; background:#E5E7EB; overflow:hidden; margin:0 auto 3px;">
    <div style="width:${clamped}%; height:100%; background:#6366F1;"></div>
  </div><div style="font-size:9.5px; text-align:center; color:#374151;">${pct.toFixed(1)}%</div>`;
}

function reportAvatarNameCell(name) {
  const initial = (name || '?')[0].toUpperCase();
  const color = reportAvatarColor(name || '?');
  return `<div style="display:flex; align-items:center; gap:8px;">
    <div style="width:22px; height:22px; min-width:22px; border-radius:6px; background:${color}; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:10px;">${initial}</div>
    <span style="font-weight:700;">${name}</span>
  </div>`;
}

function buildAllMembersDayReportHtml(dateStr) {
  const month = dateStr.slice(0, 7);
  const groceryRate = monthMealRate(month);
  const dayCost = dayTotalCost(dateStr);

  // "Today's Costs" — every raw grocery/shared-expense entry logged for this
  // date, exactly as shown on the Dashboard's Total Expenses card.
  const costRows = [
    ...dayCost.costItems.map(c => ({
      type: MEAL_TIME_LABEL[c.mealType || 'other'],
      detail: c.note || '—',
      by: c.addedBy || '—',
      amount: Number(c.amount || 0)
    })),
    ...dayCost.expenseItems.map(e => ({
      type: 'Shared Expense',
      detail: e.title + (e.description ? ` — ${e.description}` : ''),
      by: e.addedBy || '—',
      amount: Number(e.amount || 0)
    })),
  ];
  const costRowsHtml = costRows.length ? costRows.map((r, i) => `
    <tr style="${i%2? 'background:#F8F9FA;':''}">
      <td style="padding:8px;">${r.type}</td><td style="padding:8px;">${r.detail}</td>
      <td style="padding:8px;">${r.by}</td><td style="text-align:right; padding:8px;">${fmtMoney(r.amount)}</td>
    </tr>`).join('') : `<tr><td colspan="4" style="padding:10px 8px; color:#6B7280;">Nothing logged for this day yet.</td></tr>`;

  // Per-member breakdown — grocery cost uses the same monthly meal rate used
  // everywhere else in the app; shared-expense share uses the same
  // expenseShareFor() split already used for balances.
  const activeIds = new Set(activeMemberIdsForMonth(month));
  const dayMeals = (state.days[dateStr] && state.days[dateStr].meals) || {};
  const todaysExpenses = state.expenses.filter(e => e.date === dateStr);
  const memberRows = state.members.filter(m => activeIds.has(m.id)).map(m => {
    const rec = dayMeals[m.id] || {};
    const lunch = rec.lunch || 0,
      dinner = rec.dinner || 0;
    const totalMealsForMember = lunch + dinner;
    const groceryCost = totalMealsForMember * groceryRate;
    const myExpenses = todaysExpenses.filter(e => e.memberIds.includes(m.id));
    const sharedCost = myExpenses.reduce((s, e) => s + expenseShareFor(e, m.id), 0);
    const sharedDetail = myExpenses.map(e => {
      const share = expenseShareFor(e, m.id);
      const isMealSplit = e.shares && e.shares[m.id] !== undefined;
      return isMealSplit ?
        `${e.title}: ${fmtMoney(share)} (by meal count)` :
        `${e.title}: ${fmtMoney(e.amount)} \u00f7 ${e.memberIds.length} = ${fmtMoney(share)}`;
    });
    const totalCost = groceryCost + sharedCost;
    const personalRate = totalMealsForMember > 0 ? totalCost / totalMealsForMember : null;
    return {
      member: m,
      lunch,
      dinner,
      totalMealsForMember,
      groceryCost,
      sharedCost,
      sharedDetail,
      totalCost,
      personalRate
    };
  });

  const dayTotalMeals = memberRows.reduce((s, r) => s + r.totalMealsForMember, 0);
  const dayGrandTotal = memberRows.reduce((s, r) => s + r.totalCost, 0);
  const dayAvgRate = dayTotalMeals > 0 ? dayGrandTotal / dayTotalMeals : null;
  const maxCost = memberRows.length ? Math.max(...memberRows.map(r => r.totalCost)) : 0;
  const maxMeals = memberRows.length ? Math.max(...memberRows.map(r => r.totalMealsForMember)) : 0;

  const memberRowsHtml = memberRows.length ? memberRows.map((r, i) => {
    const groc = r.totalMealsForMember > 0 ? `<div>${fmtMoney(r.groceryCost)}</div><div style="font-size:9px; color:#6B7280;">${fmtMoney(groceryRate)} &times; ${r.totalMealsForMember}</div>` : '&mdash;';
    const shr = r.sharedCost > 0 ?
      `<div>${fmtMoney(r.sharedCost)}</div><div style="font-size:9px; color:#6B7280;">${r.sharedDetail.join('<br>')}</div>` :
      '&mdash;';
    let rateHtml = '&mdash;';
    if (r.personalRate !== null) {
      const above = dayAvgRate !== null && r.personalRate > dayAvgRate + 0.005;
      const below = dayAvgRate !== null && r.personalRate < dayAvgRate - 0.005;
      const color = above ? '#D97706' : (below ? '#16A34A' : '#111827');
      const tag = above ? '▲ Above avg' : (below ? '▼ Below avg' : '≈ On avg');
      rateHtml = `<div style="color:${color}; font-weight:700;">${fmtMoney(r.personalRate)}</div><div style="font-size:9px; color:${color};">${tag}</div>`;
    }
    const pct = dayGrandTotal > 0 ? (r.totalCost / dayGrandTotal * 100) : 0;
    let badge = '';
    if (r.totalCost > 0 && r.totalCost === maxCost) badge = '💸 Top Spender';
    else if (r.totalMealsForMember > 0 && r.totalMealsForMember === maxMeals) badge = '🍽️ Most Meals';
    else if (r.personalRate !== null && dayAvgRate !== null && r.personalRate < dayAvgRate) badge = '🌱 Budget Friendly';
    else if (r.totalMealsForMember > 0) badge = '✅ Regular';
    return `<tr style="${i%2? 'background:#F8F9FA;':''}">
      <td style="padding:7px 8px;">${reportAvatarNameCell(r.member.name)}</td>
      <td style="text-align:center; padding:7px 8px;">${r.lunch}</td>
      <td style="text-align:center; padding:7px 8px;">${r.dinner}</td>
      <td style="text-align:center; padding:7px 8px;">${r.totalMealsForMember}</td>
      <td style="text-align:right; padding:7px 8px;">${groc}</td>
      <td style="text-align:right; padding:7px 8px;">${shr}</td>
      <td style="text-align:right; padding:7px 8px; font-weight:700;">${fmtMoney(r.totalCost)}</td>
      <td style="text-align:right; padding:7px 8px;">${rateHtml}</td>
      <td style="text-align:center; padding:7px 8px;">${reportProgressBar(pct)}</td>
      <td style="padding:7px 8px; font-size:9.5px;">${badge}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="10" style="padding:10px 8px; color:#6B7280;">No active members found.</td></tr>`;

  const totalLunch = memberRows.reduce((s, r) => s + r.lunch, 0);
  const totalDinner = memberRows.reduce((s, r) => s + r.dinner, 0);
  const totalGrocery = memberRows.reduce((s, r) => s + r.groceryCost, 0);
  const totalShared = memberRows.reduce((s, r) => s + r.sharedCost, 0);

  const statStrip = `<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:6px;">
      ${reportStatBox('🛒 MONTHLY GROCERY RATE', `${fmtMoney(groceryRate)}/meal`, '#EEF2FF', '#C7D2FE')}
      ${reportStatBox('💵 TODAY\'S SHARED EXPENSE', fmtMoney(dayCost.shared), '#FEF3C7', '#F59E0B')}
      ${reportStatBox('📊 DAILY AVG RATE', dayAvgRate!==null?`${fmtMoney(dayAvgRate)}/meal`:'—', '#E7F6EC', '#BBE5C8')}
    </div>`;

  const body = `
    ${messLedgerReportHeader('Meal &amp; expense tracker — Daily Report')}
    <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:14px; flex-wrap:wrap; gap:6px;">
      <div style="font-size:18px; font-weight:700;">${formatLongDateStr(dateStr)}</div>
      <div style="font-size:11.5px; color:#6B7280;">Generated ${formatBDDateTime(nowTimestamp())}</div>
    </div>
    ${reportSectionTitle('💵 Today\'s Costs')}
    <table style="font-size:12px; margin-bottom:12px;">
      <thead><tr style="background:${REPORT_HEADER_BG}; color:#fff;">
        <th style="text-align:left; padding:8px;">Type</th><th style="text-align:left; padding:8px;">Detail</th>
        <th style="text-align:left; padding:8px;">Added By</th><th style="text-align:right; padding:8px;">Amount</th></tr></thead>
      <tbody>${costRowsHtml}
      <tr style="background:#EDF1F4; font-weight:700;"><td colspan="3" style="padding:8px;">Total</td>
        <td style="text-align:right; padding:8px;">${fmtMoney(dayCost.total)}</td></tr></tbody>
    </table>
    ${statStrip}
    ${reportSectionTitle('🍽️ Person Based Daily Meal Cost')}
    <table style="font-size:10.5px;">
      <thead><tr style="background:${REPORT_HEADER_BG}; color:#fff;">
        <th style="text-align:left; padding:7px 8px;">Member</th><th style="padding:7px 8px;">Lunch</th><th style="padding:7px 8px;">Dinner</th>
        <th style="padding:7px 8px;">Total<br>Meals</th><th style="text-align:right; padding:7px 8px;">Grocery Cost</th>
        <th style="text-align:right; padding:7px 8px;">Shared Exp Cost</th><th style="text-align:right; padding:7px 8px;">Total<br>Cost</th>
        <th style="text-align:right; padding:7px 8px;">Meal<br>Rate</th><th style="padding:7px 8px;">% of Day's<br>Total Cost</th>
        <th style="text-align:left; padding:7px 8px;">Highlight</th></tr></thead>
      <tbody>${memberRowsHtml}
      <tr style="background:#EDF1F4; font-weight:700;">
        <td style="padding:7px 8px;">Total</td>
        <td style="text-align:center; padding:7px 8px;">${totalLunch}</td>
        <td style="text-align:center; padding:7px 8px;">${totalDinner}</td>
        <td style="text-align:center; padding:7px 8px;">${dayTotalMeals}</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(totalGrocery)}</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(totalShared)}</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(dayGrandTotal)}</td>
        <td style="text-align:right; padding:7px 8px;">${dayAvgRate!==null?fmtMoney(dayAvgRate):'—'}</td>
        <td colspan="2" style="text-align:center; padding:7px 8px;">100%</td>
      </tr></tbody>
    </table>
    ${reportSectionTitle('📋 Daily Summary')}
    ${reportSummaryGrid([
      ['Total Lunch Meals', totalLunch, 'Total Dinner Meals', totalDinner],
      ['Total Grocery Cost', fmtMoney(totalGrocery), 'Total Shared Expense', fmtMoney(totalShared)],
    ])}
    ${reportGrandTotalBar('Grand Total Daily Cost', fmtMoney(dayGrandTotal))}
    ${dayAvgRate!==null ? reportRateCallout('Daily Average Meal Rate', `Grand Total Daily Cost ÷ Total Meals = ${fmtMoney(dayGrandTotal)} ÷ ${dayTotalMeals}`, `${fmtMoney(dayAvgRate)} / meal`, null) : ''}
    <div style="margin-top:14px; font-size:11px; color:#6B7280;">Meal Rate is color-coded against the day's average. Highlight badges are just for fun. Figures may change if meals or costs are edited after this export.</div>`;
  return reportShell(body, `MessLedger — ${dateStr}`);
}

function buildPersonalMonthReportHtml(month) {
  const me = memberById(session.userId);
  const ledger = buildMemberLedger(session.userId);
  const monthEntries = ledger.filter(e => e.date.startsWith(month) && (e.kind === 'meal' || e.kind === 'expense'));
  const byDate = {};
  monthEntries.forEach(e => {
    if (!byDate[e.date]) byDate[e.date] = {
      lunch: 0,
      dinner: 0,
      mealCost: 0,
      expenseCost: 0
    };
    if (e.kind === 'meal') {
      byDate[e.date][e.mealType] += e.qty;
      byDate[e.date].mealCost += e.amount;
    } else {
      byDate[e.date].expenseCost += e.amount;
    }
  });
  const dates = Object.keys(byDate).sort();
  let totalLunch = 0,
    totalDinner = 0,
    totalMealCost = 0,
    totalExpenseCost = 0;
  const dayTotals = dates.map(d => {
    const r = byDate[d];
    totalLunch += r.lunch;
    totalDinner += r.dinner;
    totalMealCost += r.mealCost;
    totalExpenseCost += r.expenseCost;
    return {
      date: d,
      ...r,
      total: r.mealCost + r.expenseCost
    };
  });
  const nonZero = dayTotals.filter(d => d.total > 0);
  const maxDay = nonZero.length ? nonZero.reduce((a, b) => b.total > a.total ? b : a) : null;
  const minDay = nonZero.length ? nonZero.reduce((a, b) => b.total < a.total ? b : a) : null;
  const rows = dayTotals.length ? dayTotals.map((d, i) => {
    let tag = '';
    if (maxDay && d.date === maxDay.date && nonZero.length > 1) tag = '<div style="font-size:9px; color:#D97706; margin-top:2px;">🔥 Priciest day</div>';
    else if (minDay && d.date === minDay.date && nonZero.length > 1) tag = '<div style="font-size:9px; color:#16A34A; margin-top:2px;">🌱 Lightest day</div>';
    return `<tr style="${i%2? 'background:#F8F9FA;':''}">
      <td style="padding:7px 8px;">${d.date}${tag}</td>
      <td style="text-align:center; padding:7px 8px;">${d.lunch}</td>
      <td style="text-align:center; padding:7px 8px;">${d.dinner}</td>
      <td style="text-align:right; padding:7px 8px;">${fmtMoney(d.mealCost)}</td>
      <td style="text-align:right; padding:7px 8px;">${fmtMoney(d.expenseCost)}</td>
      <td style="text-align:right; padding:7px 8px; font-weight:600;">${fmtMoney(d.total)}</td></tr>`;
  }).join('') : `<tr><td colspan="6" style="padding:12px 8px; color:#6B7280;">No meals or expenses recorded this month yet.</td></tr>`;
  const totalMeals = totalLunch + totalDinner;
  const totalCost = totalMealCost + totalExpenseCost;
  const avgRate = totalMeals > 0 ? totalCost / totalMeals : null;

  const statStrip = `<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:6px;">
      ${reportStatBox('🍽️ TOTAL MEALS', totalMeals, '#EEF2FF', '#C7D2FE')}
      ${reportStatBox('💵 TOTAL COST', fmtMoney(totalCost), '#FEF3C7', '#F59E0B')}
      ${reportStatBox('📊 AVERAGE RATE', avgRate!==null?`${fmtMoney(avgRate)}/meal`:'—', '#E7F6EC', '#BBE5C8')}
    </div>`;

  const body = `
    ${messLedgerReportHeader('Meal &amp; expense tracker — Monthly Report')}
    ${reportPersonBar(me, month)}
    ${statStrip}
    ${reportSectionTitle('📅 Day-by-Day Breakdown')}
    <table style="font-size:12px;">
      <thead><tr style="background:${REPORT_HEADER_BG}; color:#fff;">
        <th style="text-align:left; padding:8px;">Date</th><th style="padding:8px;">Lunch</th><th style="padding:8px;">Dinner</th>
        <th style="text-align:right; padding:8px;">Meal Cost</th><th style="text-align:right; padding:8px;">Shared Exp.</th>
        <th style="text-align:right; padding:8px;">Total</th></tr></thead>
      <tbody>${rows}
      <tr style="background:#EDF1F4; font-weight:700;"><td style="padding:8px;">Total</td>
        <td style="text-align:center; padding:8px;">${totalLunch}</td><td style="text-align:center; padding:8px;">${totalDinner}</td>
        <td style="text-align:right; padding:8px;">${fmtMoney(totalMealCost)}</td>
        <td style="text-align:right; padding:8px;">${fmtMoney(totalExpenseCost)}</td>
        <td style="text-align:right; padding:8px;">${fmtMoney(totalCost)}</td></tr></tbody>
    </table>
    ${reportSectionTitle('📋 Monthly Summary')}
    ${reportSummaryGrid([
      ['Total Lunch Meals', totalLunch, 'Total Dinner Meals', totalDinner],
      ['Total Meal Cost', fmtMoney(totalMealCost), 'Total Shared Expense', fmtMoney(totalExpenseCost)],
    ])}
    ${reportGrandTotalBar('Grand Total This Month', fmtMoney(totalCost))}
    ${avgRate!==null ? reportRateCallout('Your Average Meal Rate', `Total Cost ÷ Total Meals = ${fmtMoney(totalCost)} ÷ ${totalMeals}`, `${fmtMoney(avgRate)} / meal`, null) : ''}
    <div style="margin-top:14px; font-size:11px; color:#6B7280;">This report is personal — it only reflects your own meals and expense share, not other members'. Figures may change if entries are edited later.</div>`;
  return reportShell(body, `MessLedger — ${month}`);
}

/* ---------------- FULL MONTH REPORT — EVERYONE (Dashboard) ----------------
   Companion to the day report and the "mine only" month report: this one
   dumps the *entire* month for the *whole mess* in one printable page —
   per-member summary (meals/grocery/shared/deposits/balance/rate, same
   numbers as the Dashboard's monthly table) plus the raw grocery-cost,
   shared-expense, and deposit/withdrawal logs for the month, so it can be
   downloaded and archived or shared with the group. */
function buildFullMonthAllMembersReportHtml(month) {
  const groceryRate = monthMealRate(month);
  const monthGrocery = state.costs.filter(c => c.date.startsWith(month)).reduce((s, c) => s + Number(c.amount || 0), 0);
  const monthShared = monthTotalExpense(month);
  const monthDep = monthTotalDeposits(month);
  const monthWithdraw = monthTotalWithdrawals(month);
  const priorBalance = state.members.reduce((s, m) => s + openingBalance(m.id, month), 0);
  const combinedCost = monthGrocery + monthShared;
  const cashInHand = priorBalance + monthDep - monthWithdraw - combinedCost;
  const moneyTag = (v) => v >= 0 ? `<span style="color:#16A34A;">${fmtMoney(v)}</span>` : `<span style="color:#DC2626;">-${fmtMoney(Math.abs(v))}</span>`;

  // ---- Lunch/Dinner split per member for the month (from raw day records) ----
  const monthDateKeys = Object.keys(state.days).filter(k => k.startsWith(month)).sort();
  const memberLunchDinner = {};
  monthDateKeys.forEach(d => {
    const meals = (state.days[d] && state.days[d].meals) || {};
    Object.keys(meals).forEach(mid => {
      if (!memberLunchDinner[mid]) memberLunchDinner[mid] = { lunch: 0, dinner: 0 };
      memberLunchDinner[mid].lunch += meals[mid].lunch || 0;
      memberLunchDinner[mid].dinner += meals[mid].dinner || 0;
    });
  });

  // ---- Per-member monthly summary (mirrors Dashboard's month table, plus lunch/dinner split & highlight badges) ----
  const memberRows = state.members.map(m => {
    const ld = memberLunchDinner[m.id] || { lunch: 0, dinner: 0 };
    const meals = ld.lunch + ld.dinner;
    const cost = monthMemberMealCost(m.id, month);
    const dep = monthDeposit(m.id, month);
    const expShare = monthExpenseShare(m.id, month);
    const totalExpense = cost + expShare;
    const opening = openingBalance(m.id, month);
    const balance = opening + dep - totalExpense;
    const personalRate = meals > 0 ? totalExpense / meals : null;
    const inactive = !isMemberActiveInMonth(m.id, month);
    return { member: m, lunch: ld.lunch, dinner: ld.dinner, meals, cost, dep, expShare, totalExpense, opening, balance, personalRate, inactive };
  });
  const totalMeals = memberRows.reduce((s, r) => s + r.meals, 0);
  const totalLunchAll = memberRows.reduce((s, r) => s + r.lunch, 0);
  const totalDinnerAll = memberRows.reduce((s, r) => s + r.dinner, 0);
  const monthAvgRate = totalMeals > 0 ? combinedCost / totalMeals : null;
  const spendMax = memberRows.length ? Math.max(...memberRows.map(r => r.totalExpense)) : 0;
  const mealsMax = memberRows.length ? Math.max(...memberRows.map(r => r.meals)) : 0;
  const memberRowsHtml = memberRows.length ? memberRows.map((r, i) => {
    let badge = '';
    if (r.totalExpense > 0 && r.totalExpense === spendMax) badge = '💸 Top Spender';
    else if (r.meals > 0 && r.meals === mealsMax) badge = '🍽️ Most Meals';
    else if (r.personalRate !== null && monthAvgRate !== null && r.personalRate < monthAvgRate) badge = '🌱 Budget Friendly';
    return `
    <tr style="${i%2? 'background:#F8F9FA;':''}">
      <td style="padding:7px 8px;">${reportAvatarNameCell(r.member.name)}${r.inactive ? ' <span style="font-size:9px; color:#9CA3AF;">(inactive)</span>' : ''}</td>
      <td style="text-align:center; padding:7px 8px;">${r.lunch}</td>
      <td style="text-align:center; padding:7px 8px;">${r.dinner}</td>
      <td style="text-align:center; padding:7px 8px;">${r.meals}</td>
      <td style="text-align:right; padding:7px 8px;">${fmtMoney(r.cost)}</td>
      <td style="text-align:right; padding:7px 8px;">${fmtMoney(r.expShare)}</td>
      <td style="text-align:right; padding:7px 8px; font-weight:700;">${fmtMoney(r.totalExpense)}</td>
      <td style="text-align:right; padding:7px 8px;">${fmtMoney(r.dep)}</td>
      <td style="text-align:right; padding:7px 8px;">${moneyTag(r.opening)}</td>
      <td style="text-align:right; padding:7px 8px; font-weight:700;">${moneyTag(r.balance)}</td>
      <td style="text-align:right; padding:7px 8px;">${r.personalRate!==null?fmtMoney(r.personalRate):'—'}</td>
      <td style="padding:7px 8px; font-size:9.5px;">${badge}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="12" style="padding:10px 8px; color:#6B7280;">No members found.</td></tr>`;

  // ---- Mess-wide day-by-day breakdown for the month ----
  const dailyDateSet = new Set([
    ...monthDateKeys,
    ...state.costs.filter(c => c.date.startsWith(month)).map(c => c.date),
    ...state.expenses.filter(e => e.date.startsWith(month)).map(e => e.date)
  ]);
  const dailyDates = Array.from(dailyDateSet).sort();
  const dailyRows = dailyDates.map(d => {
    const mt = dayMealTotals(d);
    const dc = dayTotalCost(d);
    return { date: d, lunch: mt.lunch, dinner: mt.dinner, meals: mt.total, grocery: dc.grocery, shared: dc.shared, total: dc.total };
  });
  const nonZeroDaily = dailyRows.filter(d => d.total > 0);
  const priciestDay = nonZeroDaily.length ? nonZeroDaily.reduce((a, b) => b.total > a.total ? b : a) : null;
  const lightestDay = nonZeroDaily.length ? nonZeroDaily.reduce((a, b) => b.total < a.total ? b : a) : null;
  const dailyRowsHtml = dailyRows.length ? dailyRows.map((d, i) => {
    let tag = '';
    if (priciestDay && d.date === priciestDay.date && nonZeroDaily.length > 1) tag = '<div style="font-size:9px; color:#D97706; margin-top:2px;">🔥 Priciest day</div>';
    else if (lightestDay && d.date === lightestDay.date && nonZeroDaily.length > 1) tag = '<div style="font-size:9px; color:#16A34A; margin-top:2px;">🌱 Lightest day</div>';
    return `<tr style="${i%2? 'background:#F8F9FA;':''}">
      <td style="padding:7px 8px;">${d.date}${tag}</td>
      <td style="text-align:center; padding:7px 8px;">${d.lunch}</td>
      <td style="text-align:center; padding:7px 8px;">${d.dinner}</td>
      <td style="text-align:center; padding:7px 8px;">${d.meals}</td>
      <td style="text-align:right; padding:7px 8px;">${fmtMoney(d.grocery)}</td>
      <td style="text-align:right; padding:7px 8px;">${fmtMoney(d.shared)}</td>
      <td style="text-align:right; padding:7px 8px; font-weight:600;">${fmtMoney(d.total)}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="7" style="padding:10px 8px; color:#6B7280;">No activity recorded this month.</td></tr>`;

  // ---- Raw grocery-cost log for the month ----
  const costEntries = state.costs.filter(c => c.date.startsWith(month)).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const costRowsHtml = costEntries.length ? costEntries.map((c, i) => `
    <tr style="${i%2? 'background:#F8F9FA;':''}">
      <td style="padding:7px 8px;">${c.date}</td>
      <td style="padding:7px 8px;">${MEAL_TIME_LABEL[c.mealType || 'other'] || c.mealType || '—'}</td>
      <td style="padding:7px 8px;">${c.note || '—'}</td>
      <td style="padding:7px 8px;">${(memberById(c.purchasedBy)||{}).name || c.addedBy || '—'}</td>
      <td style="padding:7px 8px; font-size:9px; color:#6B7280;">${c.addedBy || '—'}</td>
      <td style="text-align:right; padding:7px 8px;">${fmtMoney(Number(c.amount||0))}</td>
    </tr>`).join('') : `<tr><td colspan="6" style="padding:10px 8px; color:#6B7280;">No grocery costs logged this month.</td></tr>`;

  // ---- Raw shared-expense log for the month, with full per-member split detail ----
  const expenseEntries = state.expenses.filter(e => e.date.startsWith(month)).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const expenseRowsHtml = expenseEntries.length ? expenseEntries.map((e, i) => {
    const splitLabel = e.memberIds.length === state.members.length ? 'Everyone' : `${e.memberIds.length} member(s)`;
    const isMealSplit = !!e.shares;
    const splitDetail = e.memberIds.map(mid => {
      const mm = memberById(mid);
      const share = expenseShareFor(e, mid);
      return `${mm?mm.name:'?'}: ${fmtMoney(share)}`;
    }).join(', ');
    return `<tr style="${i%2? 'background:#F8F9FA;':''}">
      <td style="padding:7px 8px;">${e.date}</td>
      <td style="padding:7px 8px;">${e.title}${e.description ? `<div style="font-size:9px; color:#6B7280;">${e.description}</div>` : ''}</td>
      <td style="padding:7px 8px;">${splitLabel}${isMealSplit ? ' <span style="font-size:9px; color:#6B7280;">(by meal count)</span>' : ''}<div style="font-size:9px; color:#6B7280; margin-top:2px;">${splitDetail}</div></td>
      <td style="padding:7px 8px;">${e.addedBy || '—'}</td>
      <td style="text-align:right; padding:7px 8px;">${fmtMoney(Number(e.amount||0))}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="5" style="padding:10px 8px; color:#6B7280;">No shared expenses logged this month.</td></tr>`;

  // ---- Raw deposit / withdrawal log for the month ----
  const depositEntries = state.deposits.filter(d => d.date.startsWith(month)).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const depositRowsHtml = depositEntries.length ? depositEntries.map((d, i) => `
    <tr style="${i%2? 'background:#F8F9FA;':''}">
      <td style="padding:7px 8px;">${d.date}</td>
      <td style="padding:7px 8px;">${(memberById(d.memberId)||{}).name || '—'}</td>
      <td style="padding:7px 8px;">${d.type === 'withdrawal' ? '🔻 Withdrawal' : '💰 Deposit'}</td>
      <td style="padding:7px 8px;">${d.note || '—'}</td>
      <td style="padding:7px 8px; font-size:9px; color:#6B7280;">${d.addedBy || '—'}</td>
      <td style="text-align:right; padding:7px 8px;">${fmtMoney(Number(d.amount||0))}</td>
    </tr>`).join('') : `<tr><td colspan="6" style="padding:10px 8px; color:#6B7280;">No deposits or withdrawals logged this month.</td></tr>`;

  const statStrip = `<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:6px;">
      ${reportStatBox('🛒 MONTHLY GROCERY RATE', `${fmtMoney(groceryRate)}/meal`, '#EEF2FF', '#C7D2FE')}
      ${reportStatBox('🍽️ TOTAL MEALS', `${totalMeals} (${totalLunchAll}L / ${totalDinnerAll}D)`, '#E7F6EC', '#BBE5C8')}
      ${reportStatBox('💵 TOTAL COST', fmtMoney(combinedCost), '#FEF3C7', '#F59E0B')}
      ${reportStatBox('👥 ACTIVE MEMBERS', activeMemberIdsForMonth(month).length, '#F3E8FF', '#DDD6FE')}
    </div>`;

  const body = `
    ${messLedgerReportHeader('Meal &amp; expense tracker — Full Month Report (Everyone)')}
    <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:14px; flex-wrap:wrap; gap:6px;">
      <div style="font-size:18px; font-weight:700;">${month}</div>
      <div style="font-size:11.5px; color:#6B7280;">Generated ${formatBDDateTime(nowTimestamp())}</div>
    </div>
    ${statStrip}
    ${reportSectionTitle('📋 Month Summary')}
    ${reportSummaryGrid([
      ['Total Grocery Cost', fmtMoney(monthGrocery), 'Total Shared Expenses', fmtMoney(monthShared)],
      ['Total Cost (Grocery + Shared)', fmtMoney(combinedCost), 'Total Deposit', fmtMoney(monthDep)],
      ['Total Withdrawal', fmtMoney(monthWithdraw), 'Prior Balance (carried in)', (priorBalance>=0?'':'-')+fmtMoney(Math.abs(priorBalance))],
      ['Cash in Hand (end of month)', (cashInHand>=0?'':'-')+fmtMoney(Math.abs(cashInHand)), 'Grocery Cost Entries', String(costEntries.length)],
      ['Shared Expense Entries', String(expenseEntries.length), 'Deposit/Withdrawal Entries', String(depositEntries.length)],
    ])}
    ${monthAvgRate!==null ? reportRateCallout('Month Average Meal Rate', `Total Cost ÷ Total Meals = ${fmtMoney(combinedCost)} ÷ ${totalMeals}`, `${fmtMoney(monthAvgRate)} / meal`, null) : ''}
    ${reportSectionTitle('👥 Per-Member Summary')}
    <table style="font-size:10px;">
      <thead><tr style="background:${REPORT_HEADER_BG}; color:#fff;">
        <th style="text-align:left; padding:7px 8px;">Member</th><th style="padding:7px 8px;">Lunch</th><th style="padding:7px 8px;">Dinner</th>
        <th style="padding:7px 8px;">Meals</th>
        <th style="text-align:right; padding:7px 8px;">Grocery Cost</th><th style="text-align:right; padding:7px 8px;">Shared Exp.</th>
        <th style="text-align:right; padding:7px 8px;">Total Exp.</th><th style="text-align:right; padding:7px 8px;">Deposits</th>
        <th style="text-align:right; padding:7px 8px;">Prior Bal.</th><th style="text-align:right; padding:7px 8px;">Balance</th>
        <th style="text-align:right; padding:7px 8px;">Rate</th><th style="text-align:left; padding:7px 8px;">Highlight</th></tr></thead>
      <tbody>${memberRowsHtml}
      <tr style="background:#EDF1F4; font-weight:700;">
        <td style="padding:7px 8px;">Total</td>
        <td style="text-align:center; padding:7px 8px;">${totalLunchAll}</td>
        <td style="text-align:center; padding:7px 8px;">${totalDinnerAll}</td>
        <td style="text-align:center; padding:7px 8px;">${totalMeals}</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(monthGrocery)}</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(monthShared)}</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(combinedCost)}</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(monthDep)}</td>
        <td colspan="4" style="text-align:right; padding:7px 8px;">—</td>
      </tr></tbody>
    </table>
    ${reportSectionTitle('📅 Day-by-Day Breakdown (Whole Mess)')}
    <table style="font-size:10.5px; margin-bottom:12px;">
      <thead><tr style="background:${REPORT_HEADER_BG}; color:#fff;">
        <th style="text-align:left; padding:7px 8px;">Date</th><th style="padding:7px 8px;">Lunch</th><th style="padding:7px 8px;">Dinner</th>
        <th style="padding:7px 8px;">Meals</th><th style="text-align:right; padding:7px 8px;">Grocery</th>
        <th style="text-align:right; padding:7px 8px;">Shared</th><th style="text-align:right; padding:7px 8px;">Total</th></tr></thead>
      <tbody>${dailyRowsHtml}
      <tr style="background:#EDF1F4; font-weight:700;">
        <td style="padding:7px 8px;">Total</td>
        <td style="text-align:center; padding:7px 8px;">${totalLunchAll}</td>
        <td style="text-align:center; padding:7px 8px;">${totalDinnerAll}</td>
        <td style="text-align:center; padding:7px 8px;">${totalMeals}</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(monthGrocery)}</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(monthShared)}</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(combinedCost)}</td>
      </tr></tbody>
    </table>
    ${reportSectionTitle('🛒 Grocery Cost Log')}
    <table style="font-size:10.5px; margin-bottom:12px;">
      <thead><tr style="background:${REPORT_HEADER_BG}; color:#fff;">
        <th style="text-align:left; padding:7px 8px;">Date</th><th style="text-align:left; padding:7px 8px;">Meal</th>
        <th style="text-align:left; padding:7px 8px;">Note</th><th style="text-align:left; padding:7px 8px;">Purchased By</th>
        <th style="text-align:left; padding:7px 8px;">Logged By</th>
        <th style="text-align:right; padding:7px 8px;">Amount</th></tr></thead>
      <tbody>${costRowsHtml}
      <tr style="background:#EDF1F4; font-weight:700;"><td colspan="5" style="padding:7px 8px;">Total</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(monthGrocery)}</td></tr></tbody>
    </table>
    ${reportSectionTitle('🧾 Shared Expense Log (with split detail)')}
    <table style="font-size:10.5px; margin-bottom:12px;">
      <thead><tr style="background:${REPORT_HEADER_BG}; color:#fff;">
        <th style="text-align:left; padding:7px 8px;">Date</th><th style="text-align:left; padding:7px 8px;">Title</th>
        <th style="text-align:left; padding:7px 8px;">Split (who owes what)</th><th style="text-align:left; padding:7px 8px;">Added By</th>
        <th style="text-align:right; padding:7px 8px;">Amount</th></tr></thead>
      <tbody>${expenseRowsHtml}
      <tr style="background:#EDF1F4; font-weight:700;"><td colspan="4" style="padding:7px 8px;">Total</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(monthShared)}</td></tr></tbody>
    </table>
    ${reportSectionTitle('💰 Deposit / Withdrawal Log')}
    <table style="font-size:10.5px;">
      <thead><tr style="background:${REPORT_HEADER_BG}; color:#fff;">
        <th style="text-align:left; padding:7px 8px;">Date</th><th style="text-align:left; padding:7px 8px;">Member</th>
        <th style="text-align:left; padding:7px 8px;">Type</th><th style="text-align:left; padding:7px 8px;">Note</th>
        <th style="text-align:left; padding:7px 8px;">Added By</th>
        <th style="text-align:right; padding:7px 8px;">Amount</th></tr></thead>
      <tbody>${depositRowsHtml}
      <tr style="background:#EDF1F4; font-weight:700;"><td colspan="5" style="padding:7px 8px;">Net (Deposits − Withdrawals)</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(monthDep - monthWithdraw)}</td></tr></tbody>
    </table>
    ${reportGrandTotalBar('Grand Total Month Cost (Grocery + Shared)', fmtMoney(combinedCost))}
    <div style="margin-top:14px; font-size:11px; color:#6B7280;">This report covers every member for ${month} — meals (lunch/dinner split), grocery costs, shared expenses (with full split breakdown), and deposits/withdrawals, plus a day-by-day and per-member summary. Figures may change if entries are edited after this export.</div>`;
  return reportShell(body, `MessLedger — ${month} — Everyone`);
}

function downloadFullMonthAllMembersReport() {
  openPrintableReport(buildFullMonthAllMembersReportHtml(currentMonth));
}

function downloadDailyMealRateReport() {
  const input = document.getElementById('personal-report-date');
  const dateStr = (input && input.value) || todayStr();
  openPrintableReport(buildAllMembersDayReportHtml(dateStr));
}

function downloadPersonalMonthReport() {
  openPrintableReport(buildPersonalMonthReportHtml(currentMonth));
}

/* ---------------- COMPACT TABLES: "VIEW DETAILS" MODAL ----------------
   Shared by the History (Shared Expense Deductions), Grocery Costs, and
   Shared Expenses tables below. Those tables now show only the compact,
   glanceable columns a row needs (kept to a fixed ~64px row height); every
   long or secondary field (full description, complete split list, full
   recorded timestamp, calculation breakdown, etc.) moved in here instead of
   being dropped — nothing that used to be visible is gone, it's one click
   away via "View Details". */