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
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${docTitle||'MessLedger Report'}</title>
    <style>
      @media print { .no-print { display:none !important; } @page { margin: 14mm; } }
      body{ font-family: Arial, Helvetica, sans-serif; color:#111827; margin:0; padding:24px; }
      table{ width:100%; border-collapse:collapse; }
      th, td { border-bottom: 1px solid #E5E7EB; }
    </style></head><body>
    <div class="no-print" style="margin-bottom:16px; text-align:right;">
      <button onclick="window.print()" style="background:${REPORT_HEADER_BG}; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-size:13px; cursor:pointer;">🖨️ Print / Save as PDF</button>
    </div>
    ${bodyHtml}
    </body></html>`;
}

function openPrintableReport(html) {
  const w = window.open('', '_blank');
  if (!w) {
    alert('Please allow popups for this site to download the report.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
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
