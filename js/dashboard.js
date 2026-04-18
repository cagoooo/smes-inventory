// 儀表板邏輯：圓餅/柱狀/折線/熱度圖/預算試算/壽命統計
(function() {
  const CUR_ROC = 115; // 民國 115 年 = 2026

  // Chart.js 共用預設
  function setChartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.font.family = '-apple-system, "Noto Sans TC", "PingFang TC", sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.plugins.legend.labels.padding = 14;
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
    Chart.defaults.color = '#3c3c43';
    Chart.defaults.borderColor = '#e5e5ea';
  }

  // 色盤（iOS 風）
  const PALETTE = [
    '#0a84ff', '#ff9500', '#34c759', '#ff3b30', '#af52de',
    '#5ac8fa', '#ffcc00', '#ff2d55', '#5856d6', '#32ade6',
    '#30d158', '#ff375f', '#bf5af2', '#64d2ff', '#ffd60a'
  ];

  let charts = {}; // 存所有 Chart instance 便於 destroy

  function destroyAll() {
    Object.values(charts).forEach(c => { try { c.destroy(); } catch {} });
    charts = {};
  }

  // ============ 資料聚合 ============
  function aggregate(inventory) {
    const brand = {}, year = {}, urgency = {}, unit = {}, room = {}, model = {};

    inventory.forEach(i => {
      const b = i.brand || '未標註';
      brand[b] = (brand[b] || 0) + 1;

      const y = i.acquired_year;
      if (y) year[y] = (year[y] || 0) + 1;

      const u = i.raw_data?.['汰換急迫性'] || '-';
      // 簡化為 4 類
      let ukey;
      if (u.includes('立即')) ukey = '★★★ 立即汰換';
      else if (u.includes('優先')) ukey = '★★☆ 優先汰換';
      else if (u.includes('規劃')) ukey = '★☆☆ 列入規劃';
      else if (u.includes('正常')) ukey = '✓ 正常使用';
      else ukey = '其他';
      urgency[ukey] = (urgency[ukey] || 0) + 1;

      const unitName = i.raw_data?.['保管單位'] || '未標註';
      unit[unitName] = (unit[unitName] || 0) + 1;

      const rm = i.classroom_code || i.location_text || '其他';
      room[rm] = (room[rm] || 0) + 1;

      const m = i.model || '未標註';
      if (!model[m]) model[m] = { count: 0, ages: [], brand: i.brand || '-' };
      model[m].count++;
      if (y) model[m].ages.push(CUR_ROC - y);
    });

    return { brand, year, urgency, unit, room, model };
  }

  // ============ KPI 數據 ============
  function renderKPI(inventory) {
    const total = inventory.length;
    const ages = inventory.filter(i => i.acquired_year).map(i => CUR_ROC - i.acquired_year);
    const avg = ages.length ? (ages.reduce((s,a) => s+a, 0) / ages.length).toFixed(1) : '-';
    const toReplace = ages.filter(a => a >= 8).length;
    const newDevice = ages.filter(a => a < 3).length;

    document.getElementById('kpiTotal').textContent = total;
    document.getElementById('kpiAvgAge').textContent = avg;
    document.getElementById('kpiReplace').textContent = toReplace;
    document.getElementById('kpiNew').textContent = newDevice;
  }

  // ============ 圖表渲染 ============
  function renderCharts(agg) {
    // 1. 廠牌圓餅
    const brandSorted = Object.entries(agg.brand).sort((a,b) => b[1]-a[1]);
    charts.brand = new Chart(document.getElementById('chartBrand'), {
      type: 'doughnut',
      data: {
        labels: brandSorted.map(x => x[0]),
        datasets: [{
          data: brandSorted.map(x => x[1]),
          backgroundColor: brandSorted.map((_, i) => PALETTE[i % PALETTE.length]),
          borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right' },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed} 台 (${(ctx.parsed/brandSorted.reduce((s,x)=>s+x[1],0)*100).toFixed(1)}%)` } }
        }
      }
    });

    // 2. 汰換急迫性
    const urgencyOrder = ['★★★ 立即汰換', '★★☆ 優先汰換', '★☆☆ 列入規劃', '✓ 正常使用', '其他'];
    const urgencyColors = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#8e8e93'];
    const urgencyData = urgencyOrder.filter(k => agg.urgency[k]);
    charts.urgency = new Chart(document.getElementById('chartUrgency'), {
      type: 'doughnut',
      data: {
        labels: urgencyData,
        datasets: [{
          data: urgencyData.map(k => agg.urgency[k]),
          backgroundColor: urgencyData.map(k => urgencyColors[urgencyOrder.indexOf(k)]),
          borderWidth: 2
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
    });

    // 3. 年度購置柱狀圖
    const years = Object.keys(agg.year).sort((a,b) => +a - +b);
    charts.year = new Chart(document.getElementById('chartYear'), {
      type: 'bar',
      data: {
        labels: years.map(y => y + '年'),
        datasets: [{
          label: '購置台數',
          data: years.map(y => agg.year[y]),
          backgroundColor: years.map(y => {
            const age = CUR_ROC - parseInt(y);
            if (age >= 8) return '#ff3b30';
            if (age >= 5) return '#ff9500';
            return '#34c759';
          }),
          borderRadius: 6
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: '民國年' } },
          y: { beginAtZero: true, title: { display: true, text: '台數' }, ticks: { precision: 0 } }
        }
      }
    });

    // 4. 機齡分佈（堆疊柱狀圖 + 累計線）
    const ageGroups = { '0-2年 (新)': 0, '3-4年 (新)': 0, '5-7年 (關注)': 0, '8-11年 (優先汰換)': 0, '12+年 (立即汰換)': 0 };
    Object.entries(agg.year).forEach(([y, cnt]) => {
      const age = CUR_ROC - parseInt(y);
      if (age <= 2) ageGroups['0-2年 (新)'] += cnt;
      else if (age <= 4) ageGroups['3-4年 (新)'] += cnt;
      else if (age <= 7) ageGroups['5-7年 (關注)'] += cnt;
      else if (age <= 11) ageGroups['8-11年 (優先汰換)'] += cnt;
      else ageGroups['12+年 (立即汰換)'] += cnt;
    });
    const ageLabels = Object.keys(ageGroups);
    const ageColors = ['#34c759', '#5ac8fa', '#ffcc00', '#ff9500', '#ff3b30'];
    charts.age = new Chart(document.getElementById('chartAge'), {
      type: 'bar',
      data: {
        labels: ageLabels,
        datasets: [{
          label: '台數',
          data: ageLabels.map(k => ageGroups[k]),
          backgroundColor: ageColors,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.parsed.y} 台 (${(ctx.parsed.y/Object.values(ageGroups).reduce((s,v)=>s+v,0)*100).toFixed(1)}%)`
            }
          }
        },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });

    // 5. 教室設備 TOP 10
    const roomTop = Object.entries(agg.room).sort((a,b) => b[1]-a[1]).slice(0, 10);
    charts.roomTop = new Chart(document.getElementById('chartRoomTop'), {
      type: 'bar',
      data: {
        labels: roomTop.map(x => x[0]),
        datasets: [{
          data: roomTop.map(x => x[1]),
          backgroundColor: '#0a84ff',
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });

    // 6. 保管單位
    const unitSorted = Object.entries(agg.unit).sort((a,b) => b[1]-a[1]).slice(0, 10);
    charts.unit = new Chart(document.getElementById('chartUnit'), {
      type: 'polarArea',
      data: {
        labels: unitSorted.map(x => x[0]),
        datasets: [{
          data: unitSorted.map(x => x[1]),
          backgroundColor: unitSorted.map((_, i) => PALETTE[i % PALETTE.length] + 'c0')
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
    });
  }

  // ============ 熱度地圖 ============
  function renderHeatmap(rooms, inventory) {
    const counts = {};
    inventory.forEach(i => {
      if (i.classroom_code) counts[i.classroom_code] = (counts[i.classroom_code] || 0) + 1;
    });
    const max = Math.max(...Object.values(counts), 1);

    const el = window.SMES_FLOORPLAN.renderAll(
      rooms,
      rooms.map(r => ({ code: r.code, inventory_count: counts[r.code] || 0, photo_count: 0 })),
      null,
      null
    );
    // 依密度覆蓋色彩
    el.querySelectorAll('.fp-cell[data-code]').forEach(cell => {
      const code = cell.dataset.code;
      const n = counts[code] || 0;
      if (n === 0) {
        cell.className = 'fp-cell fp-heat-0';
      } else {
        const ratio = n / max;
        let level;
        if (ratio >= 0.7) level = 'fp-heat-4';
        else if (ratio >= 0.4) level = 'fp-heat-3';
        else if (ratio >= 0.2) level = 'fp-heat-2';
        else level = 'fp-heat-1';
        cell.className = `fp-cell ${level}`;
        // 顯示 inventory count 數字
        const pctEl = cell.querySelector('.fp-pct');
        if (pctEl) pctEl.textContent = `${n} 台`;
      }
    });
    // Remove legend
    const legend = el.querySelector('.fp-legend');
    if (legend) legend.remove();
    // Add new legend
    const newLegend = document.createElement('div');
    newLegend.className = 'fp-legend';
    newLegend.innerHTML = `
      <span class="fp-leg fp-heat-0">⚪ 無</span>
      <span class="fp-leg fp-heat-1">🔵 稀</span>
      <span class="fp-leg fp-heat-2">🔵 低</span>
      <span class="fp-leg fp-heat-3">🔵 中</span>
      <span class="fp-leg fp-heat-4">🔵 密</span>
      <span style="margin-left:auto;font-size:11px;color:var(--text-soft);">最大 ${max} 台</span>
    `;
    el.insertBefore(newLegend, el.firstChild);

    const wrap = document.getElementById('heatmapView');
    wrap.innerHTML = '';
    wrap.appendChild(el);
  }

  // ============ 預算試算 ============
  function setupBudget(inventory) {
    const slider = document.getElementById('thresholdSlider');
    const priceSlider = document.getElementById('unitPriceSlider');

    function compute() {
      const thresh = parseInt(slider.value);
      const unit = parseInt(priceSlider.value);
      document.getElementById('thresholdVal').textContent = thresh;
      document.getElementById('unitPriceVal').textContent = unit.toLocaleString();

      const eligible = inventory.filter(i => {
        if (!i.acquired_year) return false;
        return (CUR_ROC - i.acquired_year) >= thresh;
      });
      const count = eligible.length;
      const total = count * unit;

      // 按廠牌分組
      const byBrand = {};
      eligible.forEach(i => {
        const b = i.brand || '未標註';
        byBrand[b] = (byBrand[b] || 0) + 1;
      });

      document.getElementById('budgetResult').innerHTML = `
        <div class="budget-big">
          <div>
            <div class="budget-num">${count}</div>
            <div class="budget-label">需汰換台數</div>
          </div>
          <div style="font-size:28px;color:var(--text-muted);">×</div>
          <div>
            <div class="budget-num">NT$ ${unit.toLocaleString()}</div>
            <div class="budget-label">每台預估</div>
          </div>
          <div style="font-size:28px;color:var(--text-muted);">=</div>
          <div>
            <div class="budget-num budget-total">NT$ ${total.toLocaleString()}</div>
            <div class="budget-label">總預算</div>
          </div>
        </div>
      `;

      const brandList = Object.entries(byBrand).sort((a,b) => b[1]-a[1]);
      document.getElementById('budgetBreakdown').innerHTML = count > 0 ?
        `<div class="budget-breakdown-title">📋 按廠牌分配</div>` +
        brandList.map(([b, n]) => `
          <div class="budget-row">
            <span>${b}</span>
            <span><b>${n}</b> 台 · NT$ ${(n * unit).toLocaleString()}</span>
          </div>
        `).join('')
      : '<div class="empty">目前沒有符合條件的設備</div>';
    }

    slider.addEventListener('input', compute);
    priceSlider.addEventListener('input', compute);
    compute();
  }

  // ============ 機型壽命統計 ============
  function renderLifespan(agg) {
    const list = Object.entries(agg.model)
      .filter(([m, d]) => d.count >= 2) // 至少 2 台才統計
      .map(([m, d]) => {
        const avgAge = d.ages.length ? (d.ages.reduce((s,a) => s+a, 0) / d.ages.length) : 0;
        const maxAge = d.ages.length ? Math.max(...d.ages) : 0;
        const minAge = d.ages.length ? Math.min(...d.ages) : 0;
        let suggest;
        if (avgAge >= 10) suggest = '<span class="badge badge-old">立即汰換</span>';
        else if (avgAge >= 7) suggest = '<span class="badge badge-mid">規劃汰換</span>';
        else suggest = '<span class="badge badge-new">持續使用</span>';
        return { model: m, brand: d.brand, count: d.count, avgAge, maxAge, minAge, suggest };
      })
      .sort((a, b) => b.avgAge - a.avgAge);

    const tbody = document.querySelector('#lifespanTable tbody');
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">尚無足夠資料</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(r => `
      <tr>
        <td><b>${r.model}</b></td>
        <td>${r.brand}</td>
        <td>${r.count}</td>
        <td>${r.avgAge.toFixed(1)} 年</td>
        <td>${r.maxAge} 年</td>
        <td>${r.minAge} 年</td>
        <td>${r.suggest}</td>
      </tr>
    `).join('');
  }

  // ============ 主入口 ============
  async function render(inventory, rooms) {
    setChartDefaults();
    destroyAll();

    if (!inventory || inventory.length === 0) {
      const dashTab = document.getElementById('tab-dashboard');
      if (dashTab) dashTab.innerHTML = '<div class="empty">尚無財產資料，請到「📥 匯入」匯入 Excel</div>';
      return;
    }

    const agg = aggregate(inventory);
    renderKPI(inventory);
    renderCharts(agg);
    if (window.SMES_FLOORPLAN && rooms) renderHeatmap(rooms, inventory);
    setupBudget(inventory);
    renderLifespan(agg);
  }

  window.SMES_DASHBOARD = { render };
})();
