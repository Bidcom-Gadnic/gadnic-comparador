// ─── GADNIC COMPARADOR · EXPORT ENGINE ────────────────────────────────────────
const EXPORT = {

  // ── Shared header ──────────────────────────────────────────────────────────
  _header(comp) {
    const cat     = CONFIG.categorias[comp.catId];
    const tipoObj = CONFIG.tipos.find(t => t.id === comp.tipo);
    const fecha   = new Date(comp.fecha).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    const total   = (comp.propios?.length || 0) + (comp.externos?.length || 0);
    return `
      <div class="comp-header">
        <h1>Comparador ${cat.nombre} — ${CONFIG.empresa}</h1>
        <p class="subtitle">${total} modelos · ${tipoObj.label} · ${comp.nombre || ''} · ${fecha}</p>
        <div class="legend">
          <span class="badge badge-propio">Propio</span>
          <span class="badge badge-externo">Externo</span>
          <span class="badge badge-gap">⚠ Gap crítico</span>
        </div>
      </div>`;
  },

  // ── Rentabilidad display ───────────────────────────────────────────────────
  _rentabilidad(p) {
    if (!p.rentabilidad && !p.pvp_ars) return '<span class="sin-costear">Sin costear</span>';
    const pct = p.rentabilidad || '–';
    const bar = typeof pct === 'number' ? Math.min(Math.max(pct, 0), 100) : 0;
    return `
      <div class="rent-wrap">
        <div class="rent-bar"><div class="rent-fill" style="width:${bar}%"></div></div>
        <span class="rent-pct">${pct}%</span>
      </div>`;
  },

  // ── Spec value display with comparison coloring ────────────────────────────
  _specVal(val, campoId, allVals, isPropio) {
    if (val == null || val === '') return '<span class="nd">N/D</span>';
    const type = typeof val;
    if (type === 'boolean' || val === true || val === false || val === 'true' || val === 'false') {
      const v = val === true || val === 'true';
      return `<span class="${v ? 'si' : 'no'}">${v ? 'Sí' : 'No'}</span>`;
    }
    return `<span>${val}</span>`;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FORMAT A — TARJETAS HORIZONTALES
  // ═══════════════════════════════════════════════════════════════════════════
  generateCards(comp) {
    const cat     = CONFIG.categorias[comp.catId];
    const propios = comp.propios  || [];
    const externos = comp.externos || [];
    const analisis = comp.analisis || {};

    const renderCard = (p, tipo) => {
      const isPropio = tipo === 'propio';
      const specs    = cat.campos.map(f => {
        const v = p[f.id];
        const nd = v == null || v === '';
        return `
          <tr class="${nd ? 'spec-nd' : ''}">
            <td class="spec-label">${f.label}${f.unidad ? ` <em>${f.unidad}</em>` : ''}</td>
            <td class="spec-val">${nd
              ? (f.req ? '<span class="flag-missing">⚠ Falta</span>' : '<span class="nd">–</span>')
              : this._specVal(v, f.id, [...propios, ...externos].map(x => x[f.id]))
            }</td>
          </tr>`;
      }).join('');

      const precio = p.pvp_ars
        ? `<div class="price">$${Number(p.pvp_ars).toLocaleString('es-AR')}</div>`
        : p.precio_ars
        ? `<div class="price price-ext">$${Number(p.precio_ars).toLocaleString('es-AR')}</div>`
        : '<div class="price price-nd">Sin precio</div>';

      const fob = p.fob_usd ? `<div class="fob">FOB USD ${p.fob_usd}</div>` : '';
      const imgEl = p.imagen_url
        ? `<img src="${p.imagen_url}" alt="${p.nombre}" class="prod-img" onerror="this.style.display='none'">`
        : '<div class="img-placeholder">📷</div>';

      const difs = p.diferenciadores
        ? `<div class="diferenciadores"><strong>Diferenciadores</strong><p>${p.diferenciadores}</p></div>`
        : '';

      const skuBadge = p.sku ? `<div class="sku-badge">SKU: ${p.sku}</div>` : '';
      const nivelBadge = p.nivel ? `<div class="nivel-badge nivel-${(p.nivel||'').toLowerCase().replace(/[^a-z]/g,'')}">${p.nivel}</div>` : '';
      const extLabel = !isPropio && p.fuente ? `<a href="${p.fuente}" target="_blank" class="fuente-link">↗ Ver fuente</a>` : '';
      const aiFlag   = p._ai_filled ? '<span class="ai-flag">IA</span>' : '';

      return `
        <div class="card ${isPropio ? 'card-propio' : 'card-externo'}">
          <div class="card-head">
            ${skuBadge}${nivelBadge}${aiFlag}
          </div>
          ${imgEl}
          <div class="card-body">
            <h3>${p.nombre || '–'}</h3>
            ${precio}${fob}
            ${this._rentabilidad(p)}
            <table class="specs-table">${specs}</table>
            ${difs}
            ${extLabel}
          </div>
        </div>`;
    };

    const propiosHTML  = propios.map(p => renderCard(p, 'propio')).join('');
    const externosHTML = externos.map(p => renderCard(p, 'externo')).join('');

    const gapsHTML = (analisis.gaps_criticos || []).map(g => `
      <div class="gap-item gap-${g.urgencia || 'alta'}">
        <strong>🔴 ${g.titulo}</strong>
        <p>${g.descripcion}</p>
      </div>`).join('');

    const ventajasHTML = (analisis.ventajas_propias || []).map(v => `
      <div class="ventaja-item">
        <strong>✅ ${v.titulo}</strong>
        <p>${v.descripcion}</p>
      </div>`).join('');

    const recsHTML = (analisis.recomendaciones || []).map(r => `
      <div class="rec-item">
        <strong>💡 ${r.titulo}</strong>
        <p>${r.descripcion}</p>
      </div>`).join('');

    return this._wrapHTML(`
      ${this._header(comp)}
      ${propios.length ? `
        <section>
          <div class="section-title section-propio">🏠 Portfolio Propio — ${CONFIG.empresa}</div>
          <div class="cards-row">${propiosHTML}</div>
        </section>` : ''}
      ${externos.length ? `
        <section>
          <div class="section-title section-externo">🏪 ${this._externoLabel(comp.tipo)}</div>
          <div class="cards-row">${externosHTML}</div>
        </section>` : ''}
      ${analisis.resumen ? `<div class="resumen-box"><p>${analisis.resumen}</p></div>` : ''}
      ${gapsHTML || ventajasHTML || recsHTML ? `
        <section class="analisis-section">
          <div class="section-title">⚠ Análisis</div>
          <div class="analisis-grid">
            ${gapsHTML ? `<div class="analisis-col"><h4>Gaps Críticos</h4>${gapsHTML}</div>` : ''}
            ${ventajasHTML ? `<div class="analisis-col"><h4>Ventajas Propias</h4>${ventajasHTML}</div>` : ''}
            ${recsHTML ? `<div class="analisis-col"><h4>Recomendaciones</h4>${recsHTML}</div>` : ''}
          </div>
        </section>` : ''}
      <footer class="comp-footer">
        Fuente: ${CONFIG.empresa} · ${new Date(comp.fecha).toLocaleDateString('es-AR')} · Precios ARS 1 pago aprox.
      </footer>
    `, comp);
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FORMAT B — TABLA COMPARATIVA ONE-PAGER
  // ═══════════════════════════════════════════════════════════════════════════
  generateTable(comp) {
    const cat      = CONFIG.categorias[comp.catId];
    const propios  = comp.propios  || [];
    const externos = comp.externos || [];
    const todos    = [...propios, ...externos];
    const analisis = comp.analisis || {};

    if (!todos.length) return '<p>Sin productos para comparar.</p>';

    // For numeric fields, determine best/worst values
    const getClass = (f, val, allVals) => {
      if (val == null || val === '') return '';
      if (f.tipo === 'booleano') {
        const v = val === true || val === 'true';
        return v ? 'mejor' : 'peor';
      }
      if (f.tipo === 'numero') {
        const nums = allVals.filter(v => v != null && !isNaN(v)).map(Number);
        if (nums.length < 2) return '';
        const max = Math.max(...nums);
        const min = Math.min(...nums);
        // Lower is better for: ruido_db, cable_m (subjective), peso_kg
        const lowerBetter = ['ruido_db'];
        if (lowerBetter.includes(f.id)) {
          return Number(val) === min ? 'mejor' : Number(val) === max ? 'peor' : '';
        }
        return Number(val) === max ? 'mejor' : Number(val) === min ? 'peor' : '';
      }
      return '';
    };

    const colHeaders = todos.map((p, i) => {
      const isPropio = i < propios.length;
      const precio   = p.pvp_ars
        ? '$' + Number(p.pvp_ars).toLocaleString('es-AR')
        : p.precio_ars ? '$' + Number(p.precio_ars).toLocaleString('es-AR') : '–';
      const imgEl = p.imagen_url
        ? `<div class="col-img-wrap"><img src="${p.imagen_url}" class="col-img" onerror="this.style.display='none'"></div>`
        : '<div class="col-img-wrap col-img-empty">📷</div>';
      return `<th class="${isPropio ? 'col-propio' : 'col-externo'}">
        <div class="col-type">${isPropio ? '▲ PROPIO' : '📦 EXTERNO'}</div>
        ${imgEl}
        <div class="col-sku">${p.sku || '–'}</div>
        <div class="col-nombre">${p.nombre || '–'}</div>
        <div class="col-precio">${precio}</div>
        ${p.fob_usd ? `<div class="col-fob">FOB USD ${p.fob_usd}</div>` : ''}
        ${this._rentabilidad(p)}
      </th>`;
    }).join('');

    const rows = cat.campos.map(f => {
      const allVals = todos.map(p => p[f.id]);
      const cells   = todos.map((p, i) => {
        const v      = p[f.id];
        const isPropio = i < propios.length;
        const cls    = getClass(f, v, allVals);
        if (v == null || v === '') {
          return `<td class="spec-nd ${isPropio ? 'col-propio' : 'col-externo'}">
            ${f.req ? '<span class="flag-missing">⚠ Falta</span>' : '<span class="nd">–</span>'}
          </td>`;
        }
        const display = (f.tipo === 'booleano' || v === true || v === false)
          ? (v === true || v === 'true' ? '✅ Sí' : '❌ No')
          : `${v}${f.unidad ? ' ' + f.unidad : ''}`;
        const arrow = cls === 'mejor' ? ' ▲' : cls === 'peor' ? ' ↓' : '';
        return `<td class="${cls} ${isPropio ? 'col-propio' : 'col-externo'}">${display}<span class="arrow">${arrow}</span></td>`;
      }).join('');
      return `<tr><td class="spec-row-label">${f.label}${f.unidad ? ` <em>(${f.unidad})</em>` : ''}</td>${cells}</tr>`;
    }).join('');

    const difRow = todos.some(p => p.diferenciadores) ? `
      <tr class="dif-row">
        <td class="spec-row-label">Diferenciadores</td>
        ${todos.map((p, i) => `<td class="${i < propios.length ? 'col-propio' : 'col-externo'} dif-cell">${p.diferenciadores || '–'}</td>`).join('')}
      </tr>` : '';

    const gapsHTML = (analisis.gaps_criticos || []).map(g => `
      <div class="gap-item gap-${g.urgencia || 'alta'}">
        <strong>🔴 ${g.titulo}</strong><p>${g.descripcion}</p>
      </div>`).join('');

    const notasHTML = (analisis.posiciones || []).map(pos => `
      <div class="nota-item nota-${pos.evaluacion}">
        <strong>${pos.nombre_externo}</strong> vs ${pos.vs_propio}
        <p>${pos.nota}</p>
      </div>`).join('');

    return this._wrapHTML(`
      ${this._header(comp)}
      <div class="table-legend">
        <span class="leg mejor">▲ Superior</span>
        <span class="leg peor">↓ Inferior</span>
        <span class="leg nd">N/D No disponible</span>
        <span class="leg flag-missing">⚠ Campo requerido faltante</span>
      </div>
      <div class="table-wrap">
        <table class="comp-table">
          <thead><tr><th class="spec-col">Especificación</th>${colHeaders}</tr></thead>
          <tbody>${rows}${difRow}</tbody>
        </table>
      </div>
      ${analisis.resumen ? `<div class="resumen-box"><p>${analisis.resumen}</p></div>` : ''}
      ${gapsHTML || notasHTML ? `
        <section class="analisis-section">
          <div class="analisis-grid">
            ${gapsHTML ? `<div class="analisis-col"><h4>⚠ Gaps Críticos</h4>${gapsHTML}</div>` : ''}
            ${notasHTML ? `<div class="analisis-col"><h4>📍 Posición vs Lineup</h4>${notasHTML}</div>` : ''}
          </div>
        </section>` : ''}
      <footer class="comp-footer">
        Fuentes: ${[...new Set(todos.map(p => p.fuente).filter(Boolean))].join(' · ')} · ${CONFIG.empresa} · ${new Date(comp.fecha).toLocaleDateString('es-AR')}
      </footer>
    `, comp);
  },

  // ── Helpers ────────────────────────────────────────────────────────────────
  _externoLabel(tipo) {
    if (tipo === 'vs_competencia') return 'Competencia — MercadoLibre / Amazon';
    if (tipo === 'vs_cotizacion')  return 'Cotización Proveedor';
    return 'Externos';
  },

  _wrapHTML(body, comp) {
    const cat = CONFIG.categorias[comp.catId];
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comparador ${cat.nombre} — ${CONFIG.empresa}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'DM Sans', 'Segoe UI', sans-serif; font-size: 12px; color: #1e293b; background: #f8fafc; padding: 20px; }
  @media print { body { padding: 0; background: white; } .no-print { display: none; } }

  /* Header */
  .comp-header { background: #0f172a; color: white; padding: 20px 24px; border-radius: 10px; margin-bottom: 20px; }
  .comp-header h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .comp-header .subtitle { color: #94a3b8; font-size: 12px; margin-bottom: 12px; }
  .legend { display: flex; gap: 10px; flex-wrap: wrap; }
  .badge { padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; }
  .badge-propio { background: #6366f1; color: white; }
  .badge-externo { background: #f59e0b; color: black; }
  .badge-gap { background: #ef444430; color: #ef4444; border: 1px solid #ef4444; }

  /* Section titles */
  .section-title { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; padding: 8px 14px; border-radius: 6px; margin-bottom: 14px; }
  .section-propio { background: #1e3a5f; color: #93c5fd; }
  .section-externo { background: #431407; color: #fdba74; }

  /* Cards layout */
  .cards-row { display: flex; gap: 14px; overflow-x: auto; padding-bottom: 8px; }
  .card { flex: 0 0 210px; background: white; border-radius: 10px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  .card-propio { border-top: 3px solid #6366f1; }
  .card-externo { border-top: 3px solid #f59e0b; }
  .card-head { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 10px 0; }
  .sku-badge { font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
  .nivel-badge { font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 20px; background: #f1f5f9; color: #475569; }
  .ai-flag { font-size: 9px; background: #dbeafe; color: #1d4ed8; padding: 2px 6px; border-radius: 10px; font-weight: 700; }
  .prod-img { width: 100%; height: 130px; object-fit: contain; padding: 10px; background: #f8fafc; }
  .img-placeholder { height: 90px; display: flex; align-items: center; justify-content: center; font-size: 30px; background: #f8fafc; }
  .card-body { padding: 10px; }
  .card-body h3 { font-size: 12px; font-weight: 600; color: #0f172a; margin-bottom: 6px; line-height: 1.4; }
  .price { font-size: 16px; font-weight: 800; color: #0284c7; margin-bottom: 2px; }
  .price-ext { color: #b45309; }
  .price-nd { color: #94a3b8; font-size: 12px; font-weight: 500; }
  .fob { font-size: 10px; color: #64748b; margin-bottom: 6px; }

  /* Specs table */
  .specs-table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  .specs-table tr { border-bottom: 1px solid #f1f5f9; }
  .spec-label { font-size: 10px; color: #64748b; padding: 3px 0; width: 55%; }
  .spec-label em { font-style: normal; color: #94a3b8; font-size: 9px; }
  .spec-val { font-size: 10px; font-weight: 600; color: #1e293b; text-align: right; }
  .spec-nd { opacity: .5; }
  .nd { color: #94a3b8; font-weight: 400; }
  .si { color: #059669; }
  .no { color: #dc2626; }
  .flag-missing { color: #f59e0b; font-weight: 700; font-size: 10px; }
  .fuente-link { display: block; font-size: 10px; color: #6366f1; margin-top: 6px; text-decoration: none; }
  .diferenciadores { margin-top: 8px; padding: 7px; background: #eff6ff; border-radius: 6px; font-size: 10px; color: #1e40af; }
  .diferenciadores strong { display: block; margin-bottom: 3px; }

  /* Rentabilidad */
  .rent-wrap { display: flex; align-items: center; gap: 6px; margin: 4px 0 8px; }
  .rent-bar { flex: 1; height: 5px; background: #e2e8f0; border-radius: 10px; overflow: hidden; }
  .rent-fill { height: 100%; background: linear-gradient(90deg,#10b981,#059669); border-radius: 10px; }
  .rent-pct { font-size: 11px; font-weight: 700; color: #059669; min-width: 35px; text-align: right; }
  .sin-costear { font-size: 10px; color: #94a3b8; font-style: italic; }

  /* Table format */
  .table-legend { display: flex; gap: 16px; margin-bottom: 12px; font-size: 11px; }
  .leg { font-weight: 600; }
  .leg.mejor { color: #059669; }
  .leg.peor { color: #dc2626; }
  .table-wrap { overflow-x: auto; border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  .comp-table { width: 100%; border-collapse: collapse; background: white; font-size: 11px; }
  .comp-table th, .comp-table td { padding: 7px 10px; border: 1px solid #e2e8f0; text-align: center; }
  .comp-table thead { position: sticky; top: 0; background: #0f172a; color: white; }
  .comp-table thead th { border-color: #1e293b; font-size: 11px; }
  .col-propio { background: rgba(99,102,241,.06); }
  .col-externo { background: rgba(245,158,11,.06); }
  .col-type { font-size: 9px; font-weight: 700; letter-spacing: .08em; opacity: .7; }
  .col-img-wrap { width: 70px; height: 70px; margin: 8px auto 6px; display: flex; align-items: center; justify-content: center; background: white; border-radius: 6px; border: 1px solid #e2e8f0; overflow: hidden; }
  .col-img { width: 100%; height: 100%; object-fit: contain; padding: 4px; }
  .col-img-empty { font-size: 24px; color: #cbd5e1; }
  .col-sku { font-size: 9px; opacity: .6; margin: 2px 0; }
  .col-nombre { font-size: 11px; font-weight: 700; line-height: 1.3; }
  .col-precio { font-size: 13px; font-weight: 800; color: #0284c7; margin-top: 4px; }
  .col-fob { font-size: 9px; opacity: .6; }
  .spec-col { text-align: left; background: #f8fafc; font-weight: 600; color: #475569; min-width: 120px; }
  .spec-row-label { text-align: left; background: #f8fafc; font-size: 11px; color: #475569; font-weight: 600; padding: 6px 10px; }
  .spec-row-label em { font-style: normal; color: #94a3b8; font-size: 10px; }
  td.mejor { background: #dcfce7 !important; color: #166534; font-weight: 700; }
  td.peor { background: #fee2e2 !important; color: #991b1b; }
  .arrow { font-size: 10px; margin-left: 2px; }
  .dif-row td { background: #eff6ff; color: #1e40af; font-size: 10px; text-align: left; }

  /* Analysis section */
  .resumen-box { background: #f0fdf4; border-left: 4px solid #10b981; padding: 12px 16px; border-radius: 0 8px 8px 0; margin: 16px 0; font-size: 12px; color: #166534; }
  .analisis-section { margin-top: 20px; }
  .analisis-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
  .analisis-col h4 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 10px; color: #475569; }
  .gap-item, .ventaja-item, .rec-item, .nota-item { padding: 10px 12px; border-radius: 8px; margin-bottom: 8px; font-size: 11px; }
  .gap-item { background: #fef2f2; border-left: 3px solid #ef4444; }
  .gap-item.gap-media { border-color: #f59e0b; background: #fffbeb; }
  .gap-item.gap-baja { border-color: #6366f1; background: #eef2ff; }
  .ventaja-item { background: #f0fdf4; border-left: 3px solid #10b981; }
  .rec-item { background: #eff6ff; border-left: 3px solid #3b82f6; }
  .nota-item { background: #f8fafc; border-left: 3px solid #94a3b8; }
  .nota-item.nota-gap_critico { border-color: #ef4444; background: #fef2f2; }
  .nota-item.nota-entra { border-color: #10b981; background: #f0fdf4; }
  .gap-item strong, .ventaja-item strong, .rec-item strong, .nota-item strong { display: block; margin-bottom: 4px; font-size: 11px; }
  .gap-item p, .ventaja-item p, .rec-item p, .nota-item p { color: #374151; line-height: 1.5; }

  /* Footer */
  .comp-footer { margin-top: 24px; padding: 12px; background: #f1f5f9; border-radius: 8px; font-size: 10px; color: #94a3b8; text-align: center; }
  section { margin-bottom: 24px; }
</style>
</head>
<body>
${body}
</body>
</html>`;
  },

  // ── Download helpers ───────────────────────────────────────────────────────
  downloadHTML(html, filename) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  },


  // ═══════════════════════════════════════════════════════════════════════════
  // FORMAT C — COTIZACIONES STANDALONE REPORT
  // ═══════════════════════════════════════════════════════════════════════════
  generateCotizacion(scored, refSpecs, row) {
    const sku    = row['SKU'] || '–';
    const desc   = row['Descripción'] || '';
    const target = row['Target price'] || '';
    const winner = scored[0];
    const fecha  = new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric' });

    const scoreColor = s => s >= 70 ? '#059669' : s >= 45 ? '#d97706' : '#dc2626';

    const rowsHTML = scored.map((c, i) => `
      <tr style="${i===0 ? 'background:#f0fdf4;font-weight:600' : ''}">
        <td style="text-align:center;font-size:18px">${i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1)}</td>
        <td><div style="font-weight:700">${c.proveedor}</div>
            ${c.modelo?`<div style="font-size:10px;color:#64748b">${c.modelo}</div>`:''}</td>
        <td style="text-align:center;font-weight:700">${c.fob_num?'USD '+c.fob_num:'–'}</td>
        <td style="text-align:center">${c.moq||'–'}</td>
        <td style="text-align:center">${c.lead_time?c.lead_time+' días':'–'}</td>
        <td style="text-align:center">
          <div style="background:#e2e8f0;border-radius:4px;height:8px;width:80px;display:inline-block;overflow:hidden">
            <div style="height:100%;width:${c.tech_score||0}%;background:${scoreColor(c.tech_score||0)};border-radius:4px"></div>
          </div>
          <span style="font-size:10px;margin-left:4px">${c.tech_score||0}%</span>
        </td>
        <td style="text-align:center;font-size:20px;font-weight:800;color:${scoreColor(c.score)}">${c.score}%</td>
        <td style="font-size:11px">
          ${(c.ventajas||[]).slice(0,2).map(v=>`<div style="color:#059669">✅ ${v}</div>`).join('')}
          ${(c.gaps||[]).slice(0,1).map(g=>`<div style="color:#dc2626;margin-top:2px">⚠ ${g}</div>`).join('')}
        </td>
      </tr>`).join('');

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cotizaciones ${sku} — Gadnic/Bidcom</title>
<style>
  *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Segoe UI',sans-serif; font-size:13px; color:#1e293b; background:#f8fafc; padding:24px; }
  @media print { body { padding:0; background:white; } }
  .header { background:#0f172a; color:white; padding:20px 24px; border-radius:10px; margin-bottom:20px; }
  .header h1 { font-size:20px; font-weight:800; margin-bottom:4px; }
  .header p { color:#94a3b8; font-size:12px; }
  .winner { background:linear-gradient(135deg,#0d2137,#0d3b1f); border:2px solid #10b981;
            border-radius:10px; padding:20px 24px; margin-bottom:20px; }
  .winner-label { font-size:10px; font-weight:700; color:#10b981; letter-spacing:.08em;
                  text-transform:uppercase; margin-bottom:6px; }
  .winner-name { font-size:22px; font-weight:800; color:white; margin-bottom:8px; }
  .winner-meta { display:flex; gap:16px; flex-wrap:wrap; font-size:12px; color:#94a3b8; margin-bottom:8px; }
  .winner-meta strong { color:white; }
  .winner-score { font-size:28px; font-weight:900; color:#10b981; }
  .winner-summary { font-size:12px; color:#94a3b8; margin-top:8px; line-height:1.5; }
  .ref-box { background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px;
             padding:14px 18px; margin-bottom:20px; font-size:12px; line-height:1.7; }
  .ref-box h4 { font-size:11px; font-weight:700; text-transform:uppercase;
                letter-spacing:.04em; color:#1d4ed8; margin-bottom:8px; }
  table { width:100%; border-collapse:collapse; background:white; border-radius:10px;
          overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,.06); }
  thead { background:#0f172a; color:white; }
  th { padding:10px 12px; text-align:left; font-size:11px; font-weight:600; letter-spacing:.04em; }
  td { padding:10px 12px; border-bottom:1px solid #e2e8f0; vertical-align:middle; }
  tr:last-child td { border-bottom:none; }
  .footer { margin-top:20px; text-align:center; font-size:10px; color:#94a3b8; }
</style>
</head>
<body>
  <div class="header">
    <h1>📋 Comparativa de Cotizaciones — SKU ${sku}</h1>
    <p>${desc} · ${scored.length} cotizaciones evaluadas · ${fecha}${target?' · Target: '+target:''}</p>
  </div>
  <div class="winner">
    <div class="winner-label">🏆 Mejor cotización</div>
    <div class="winner-name">${winner.proveedor}${winner.modelo?' — '+winner.modelo:''}</div>
    <div class="winner-meta">
      ${winner.fob_num?`<span>💰 FOB <strong>USD ${winner.fob_num}</strong></span>`:''}
      ${winner.moq?`<span>📦 MOQ <strong>${winner.moq} uds.</strong></span>`:''}
      ${winner.lead_time?`<span>⚡ Lead time <strong>${winner.lead_time} días</strong></span>`:''}
    </div>
    <div class="winner-score">${winner.score}% score final</div>
    ${winner.resumen?`<div class="winner-summary">${winner.resumen}</div>`:''}
  </div>
  ${refSpecs?.specs?`<div class="ref-box"><h4>🔗 Specs del producto de referencia</h4>${refSpecs.specs}</div>`:''}
  <table>
    <thead>
      <tr>
        <th>#</th><th>Proveedor</th><th>FOB USD</th><th>MOQ</th>
        <th>Lead time</th><th>Tech match</th><th>Score</th><th>Análisis</th>
      </tr>
    </thead>
    <tbody>${rowsHTML}</tbody>
  </table>
  <div class="footer">Gadnic / Bidcom · Generado el ${fecha}</div>
</body>
</html>`;
  },

  generate(comp, formato) {
    return formato === 'tabla'
      ? this.generateTable(comp)
      : this.generateCards(comp);
  }
};
