// ─── GADNIC COMPARADOR · APP ───────────────────────────────────────────────────
const APP = {
  state: {
    section:   'catalogo',
    catTab:    'robot',
    wizard:    null,   // active comparison wizard state
    editProd:  null,   // { catId, product } being edited
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════════════
  init() {
    this.checkSetup();
    this.bindNav();
    this.render();
    // Auto-sync in background after app loads — never blocks UI
    setTimeout(() => this._autoSync(), 1500);
  },

  async _autoSync() {
    try {
      const ok = await DB.pingScript();
      if (!ok) return;
      // Load custom categories first
      await DB.loadCategoriesFromSheet();
      // Push all categories to Categorias sheet (creates it if missing)
      await DB.pushCategories();
      // Sync all catalog tabs
      for (const catId of Object.keys(CONFIG.getAllCats())) {
        await DB.pullCatalog(catId);
      }
      await DB.pullComparativas();
      this.render();
      this.showToast('Sincronizado con Sheets.', 'success');
    } catch(e) { /* silent fail */ }
  },

  checkSetup() {
    const s = DB.getSettings();
    if (!s.geminiKey) {
      // Show setup banner
      document.getElementById('setup-banner').style.display = 'flex';
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // NAV
  // ═══════════════════════════════════════════════════════════════════════════
  bindNav() {
    document.querySelectorAll('[data-nav]').forEach(el => {
      el.addEventListener('click', () => this.go(el.dataset.nav));
    });
  },

  go(section) {
    this.state.section = section;
    document.querySelectorAll('[data-nav]').forEach(el => {
      el.classList.toggle('active', el.dataset.nav === section);
    });
    this.render();
  },

  render() {
    const sections = ['catalogo','nueva','indice','config','cotizaciones'];
    sections.forEach(s => {
      document.getElementById(`sec-${s}`).style.display =
        s === this.state.section ? 'block' : 'none';
    });

    switch (this.state.section) {
      case 'catalogo': this.renderCatalog(); break;
      case 'nueva':    this.renderWizard();  break;
      case 'indice':   this.renderIndex();   break;
      case 'config':       this.renderConfig();       break;
      case 'cotizaciones': this.renderCotizaciones(); break;
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATALOG
  // ═══════════════════════════════════════════════════════════════════════════
  renderCatalog() {
    const catId = this.state.catTab;
    const cat   = CONFIG.getAllCats()[catId];
    const prods = DB.getCatalog(catId);

    // Tabs
    document.getElementById('cat-tabs').innerHTML = Object.values(CONFIG.getAllCats()).map(c => `
      <button class="tab-btn ${c.id === catId ? 'active' : ''}" onclick="APP.setCatTab('${c.id}')">
        ${c.emoji} ${c.nombre}
        <span class="tab-count">${DB.getCatalog(c.id).length}</span>
      </button>`).join('');

    // Table
    const rows = prods.length
      ? prods.map(p => `
          <tr>
            <td><span class="sku-text">${p.sku || '–'}</span></td>
            <td><strong>${p.nombre || '–'}</strong></td>
            <td><span class="nivel-pill">${p.nivel || '–'}</span></td>
            <td>${p.pvp_ars ? '$' + Number(p.pvp_ars).toLocaleString('es-AR') : '–'}</td>
            <td>${p.fob_usd ? 'USD ' + p.fob_usd : '–'}</td>
            <td>${p.rentabilidad ? p.rentabilidad + '%' : '<span class="nd">Sin costear</span>'}</td>
            <td><span class="fuente-tag">${p.fuente || '–'}</span></td>
            <td class="actions-cell">
              <button class="btn-icon" onclick="APP.editProduct('${catId}','${p.id}')" title="Editar">✏️</button>
              <button class="btn-icon btn-del" onclick="APP.deleteProduct('${catId}','${p.id}')" title="Eliminar">🗑</button>
            </td>
          </tr>`)
        .join('')
      : `<tr><td colspan="8" class="empty-row">Sin productos. <button class="link-btn" onclick="APP.openProductModal('${catId}')">Agregar el primero →</button></td></tr>`;

    document.getElementById('cat-content').innerHTML = `
      <div class="cat-toolbar">
        <button class="btn-primary" onclick="APP.openProductModal('${catId}')">+ Agregar producto</button>
        <button class="btn-ghost" onclick="APP.syncFromSheets('${catId}')">↓ Importar desde Sheets</button>
        <button class="btn-ghost" onclick="APP.pushToSheets('${catId}')">↑ Guardar en Sheets</button>
        <button class="btn-ai" onclick="APP.openPDFImport('${catId}')">📄 Importar desde PDF</button>
        <input type="file" id="pdf-import-input" accept=".pdf" style="display:none" onchange="APP.handlePDFImport(this,'${catId}')">
        <span class="count-label">${prods.length} productos en catálogo</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>SKU</th><th>Nombre</th><th>Nivel</th>
              <th>PVP ARS</th><th>FOB USD</th><th>Rentabilidad</th>
              <th>Fuente</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  },

  setCatTab(catId) {
    this.state.catTab = catId;
    this.renderCatalog();
  },

  deleteProduct(catId, id) {
    if (!confirm('¿Eliminar este producto del catálogo?')) return;
    DB.deleteProduct(catId, id);
    this.renderCatalog();
  },

  editProduct(catId, id) {
    const prods = DB.getCatalog(catId);
    const prod  = prods.find(p => p.id === id);
    if (prod) this.openProductModal(catId, prod);
  },

  async syncFromSheets(catId) {
    this.showToast('Sincronizando desde Sheets…', 'info');
    try {
      const { added, updated } = await DB.pullCatalog(catId);
      this.showToast(`Sincronizado: ${added} nuevos, ${updated} actualizados.`, 'success');
      this.renderCatalog();
    } catch(e) {
      this.showToast('Error al sincronizar: ' + e.message, 'error');
    }
  },

  async pushToSheets(catId) {
    this.showToast('Guardando en Sheets…', 'info');
    try {
      const { added, updated } = await DB.pushCatalog(catId);
      this.showToast(`Guardado: ${added} nuevos, ${updated} actualizados.`, 'success');
    } catch(e) {
      this.showToast('Error al guardar: ' + e.message, 'error');
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PRODUCT MODAL (Add / Edit)
  // ═══════════════════════════════════════════════════════════════════════════
  openProductModal(catId, product = null) {
    const cat    = CONFIG.getAllCats()[catId];
    const isEdit = !!product;
    const p      = product || {};

    const camposHTML = cat.campos.map(f => {
      const val = p[f.id] ?? '';
      if (f.tipo === 'booleano') {
        return `
          <div class="form-group">
            <label>${f.label} ${f.req ? '<span class="req">*</span>' : ''}</label>
            <select name="${f.id}">
              <option value="" ${!val && val !== false ? 'selected' : ''}>–</option>
              <option value="true"  ${val === true  || val === 'true'  ? 'selected' : ''}>Sí</option>
              <option value="false" ${val === false || val === 'false' ? 'selected' : ''}>No</option>
            </select>
          </div>`;
      }
      return `
        <div class="form-group">
          <label>${f.label}${f.unidad ? ` (${f.unidad})` : ''} ${f.req ? '<span class="req">*</span>' : ''}</label>
          <input type="${f.tipo === 'numero' ? 'number' : 'text'}" name="${f.id}" value="${val}" placeholder="${f.req ? 'Requerido' : 'Opcional'}">
        </div>`;
    }).join('');

    const modalHTML = `
      <div class="modal-overlay" id="prod-modal">
        <div class="modal-box modal-lg">
          <div class="modal-head">
            <h2>${isEdit ? 'Editar' : 'Agregar'} Producto — ${cat.nombre}</h2>
            <button class="modal-close" onclick="APP.closeModal('prod-modal')">✕</button>
          </div>
          <div class="modal-body">
            <form id="prod-form">
              <div class="form-section">
                <h3>Carga rápida con IA</h3>
                <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Pegá el link de Bidcom y la IA completa los campos automáticamente. Después revisás y corregís lo que haga falta.</p>
                <div style="display:flex;gap:8px;align-items:flex-end">
                  <div class="form-group" style="flex:1">
                    <label>Link Bidcom</label>
                    <input type="text" id="modal-ia-url" placeholder="https://bidcom.com.ar/producto/...">
                  </div>
                  <button type="button" class="btn-ai" style="margin-bottom:1px" onclick="APP.extractToModal('${catId}')">✨ Extraer con IA</button>
                </div>
                <div id="modal-ia-status" style="display:none;margin-top:8px;font-size:12px;padding:8px 12px;border-radius:6px"></div>
              </div>

              <div class="form-section">
                <h3>Datos generales</h3>
                <div class="form-grid-2">
                  <div class="form-group">
                    <label>SKU <span class="req">*</span></label>
                    <input type="text" name="sku" value="${p.sku||''}" placeholder="ej. ROB00515">
                  </div>
                  <div class="form-group">
                    <label>Nombre <span class="req">*</span></label>
                    <input type="text" name="nombre" value="${p.nombre||''}" placeholder="Nombre del producto">
                  </div>
                  <div class="form-group">
                    <label>Nivel</label>
                    <select name="nivel">
                      <option value="">–</option>
                      ${cat.niveles.map(n => `<option ${p.nivel===n?'selected':''}>${n}</option>`).join('')}
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Fuente</label>
                    <input type="text" name="fuente" value="${p.fuente||''}" placeholder="https://bidcom.com.ar/...">
                  </div>
                  <div class="form-group">
                    <label>Imagen URL</label>
                    <input type="text" name="imagen_url" value="${p.imagen_url||''}" placeholder="https://...jpg">
                  </div>
                </div>
              </div>

              <div class="form-section">
                <h3>Rentabilidad</h3>
                <div class="form-grid-3">
                  <div class="form-group">
                    <label>FOB USD</label>
                    <input type="number" step="0.01" name="fob_usd" value="${p.fob_usd||''}" placeholder="0.00">
                  </div>
                  <div class="form-group">
                    <label>PVP ARS</label>
                    <input type="number" name="pvp_ars" value="${p.pvp_ars||''}" placeholder="0">
                  </div>
                  <div class="form-group">
                    <label>Rentabilidad %</label>
                    <input type="number" step="0.1" name="rentabilidad" value="${p.rentabilidad||''}" placeholder="0.0">
                  </div>
                </div>
              </div>

              <div class="form-section">
                <h3>Specs técnicas</h3>
                <div class="form-grid-2">${camposHTML}</div>
              </div>

              <div class="form-section">
                <label>Diferenciadores</label>
                <textarea name="diferenciadores" rows="3" placeholder="Diferenciadores únicos del producto…">${p.diferenciadores||''}</textarea>
              </div>
            </form>
          </div>
          <div class="modal-foot">
            <button class="btn-ghost" onclick="APP.closeModal('prod-modal')">Cancelar</button>
            <button class="btn-primary" onclick="APP.saveProduct('${catId}','${isEdit ? p.id : ''}')">
              ${isEdit ? 'Guardar cambios' : 'Agregar al catálogo'}
            </button>
          </div>
        </div>
      </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
  },

  async extractToModal(catId) {
    const url = document.getElementById('modal-ia-url').value.trim();
    if (!url) { this.showToast('Pegá un link primero.', 'warn'); return; }

    const status = document.getElementById('modal-ia-status');
    status.style.display = 'block';
    status.style.background = '#1e2a3a';
    status.style.color = '#93c5fd';
    status.textContent = '✨ Extrayendo specs con IA…';

    try {
      const data = await GEMINI.extractFromURL(url, catId);
      const form = document.getElementById('prod-form');

      // Fill each form field with extracted data
      for (const [key, val] of Object.entries(data)) {
        const el = form.querySelector(`[name="${key}"]`);
        if (!el || val == null) continue;
        if (el.tagName === 'SELECT') {
          // For boolean selects
          const opt = el.querySelector(`option[value="${val}"]`) ||
                      el.querySelector(`option[value="${String(val).toLowerCase()}"]`);
          if (opt) opt.selected = true;
        } else {
          el.value = val;
        }
      }

      status.style.background = '#0f2d1a';
      status.style.color = '#6ee7b7';
      status.textContent = '✅ Specs cargadas. Revisá y corregí lo que haga falta.';
    } catch(e) {
      status.style.background = '#2d0f0f';
      status.style.color = '#fca5a5';
      status.textContent = '⚠ ' + e.message;
    }
  },

  saveProduct(catId, id) {
    const form = document.getElementById('prod-form');
    const data = Object.fromEntries(new FormData(form).entries());

    // Basic validation
    if (!data.sku && !data.nombre) {
      this.showToast('SKU o Nombre son obligatorios.', 'error'); return;
    }
    // Convert booleans and numbers
    const cat = CONFIG.getAllCats()[catId];
    for (const f of cat.campos) {
      if (f.tipo === 'booleano' && data[f.id] !== '') data[f.id] = data[f.id] === 'true';
      if (f.tipo === 'numero'  && data[f.id] !== '') data[f.id] = parseFloat(data[f.id]) || data[f.id];
    }

    if (id) {
      DB.updateProduct(catId, id, data);
      this.showToast('Producto actualizado.', 'success');
    } else {
      DB.addProduct(catId, data);
      this.showToast('Producto agregado al catálogo.', 'success');
    }

    this.closeModal('prod-modal');
    this.renderCatalog();
    // Auto-sync to Sheets in background
    DB.pushCatalog(catId).catch(() => {});
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPARISON WIZARD
  // ═══════════════════════════════════════════════════════════════════════════
  renderWizard() {
    if (!this.state.wizard) {
      this.state.wizard = { step: 1, catId: null, tipo: null, propios: [], externos: [], analisis: null, nombre: '', formato: 'tarjetas' };
    }
    this['renderWizardStep' + this.state.wizard.step]();
  },

  resetWizard() {
    this.state.wizard = null;
    this.renderWizard();
  },

  wizardNext() { this.state.wizard.step++; this.renderWizard(); },
  wizardBack() { this.state.wizard.step--; this.renderWizard(); },

  // Step 1: Select category
  renderWizardStep1() {
    document.getElementById('sec-nueva').innerHTML = `
      <div class="wizard-wrap">
        <div class="wizard-head">
          <h2>Nueva Comparativa</h2>
          <div class="wizard-steps">${this._stepsDots(1)}</div>
        </div>
        <h3 class="wizard-q">¿Qué categoría querés comparar?</h3>
        <div class="choice-grid">
          ${Object.values(CONFIG.getAllCats()).map(c => `
            <div class="choice-card ${this.state.wizard.catId===c.id?'selected':''}" onclick="APP.selectCat('${c.id}')">
              <div class="choice-emoji">${c.emoji}</div>
              <div class="choice-label">${c.nombre}</div>
              <div class="choice-count">${DB.getCatalog(c.id).length} en catálogo</div>
            </div>`).join('')}
        </div>
        <div class="wizard-foot">
          <button class="btn-ghost" onclick="APP.resetWizard()">Cancelar</button>
          <button class="btn-primary" onclick="APP.wizardNext()" ${!this.state.wizard.catId?'disabled':''}>Siguiente →</button>
        </div>
      </div>`;
  },

  selectCat(catId) {
    this.state.wizard.catId = catId;
    this.renderWizardStep1();
  },

  // Step 2: Select type
  renderWizardStep2() {
    document.getElementById('sec-nueva').innerHTML = `
      <div class="wizard-wrap">
        <div class="wizard-head">
          <h2>Nueva Comparativa — ${CONFIG.categorias[this.state.wizard.catId].emoji} ${CONFIG.categorias[this.state.wizard.catId].nombre}</h2>
          <div class="wizard-steps">${this._stepsDots(2)}</div>
        </div>
        <h3 class="wizard-q">¿Qué tipo de comparativa?</h3>
        <div class="choice-grid">
          ${CONFIG.tipos.map(t => `
            <div class="choice-card ${this.state.wizard.tipo===t.id?'selected':''}" onclick="APP.selectTipo('${t.id}')">
              <div class="choice-emoji">${t.icon}</div>
              <div class="choice-label">${t.label}</div>
              <div class="choice-desc">${t.desc}</div>
            </div>`).join('')}
        </div>
        <div class="wizard-foot">
          <button class="btn-ghost" onclick="APP.wizardBack()">← Atrás</button>
          <button class="btn-primary" onclick="APP.wizardNext()" ${!this.state.wizard.tipo?'disabled':''}>Siguiente →</button>
        </div>
      </div>`;
  },

  selectTipo(tipo) {
    this.state.wizard.tipo = tipo;
    this.renderWizardStep2();
  },

  // Step 3: Select own products (not needed for 'mixto')
  renderWizardStep3() {
    const { catId, tipo } = this.state.wizard;
    if (tipo === 'mixto') { this.wizardNext(); return; }

    const cat   = CONFIG.getAllCats()[catId];
    const prods = DB.getCatalog(catId);

    document.getElementById('sec-nueva').innerHTML = `
      <div class="wizard-wrap">
        <div class="wizard-head">
          <h2>Seleccioná tus productos</h2>
          <div class="wizard-steps">${this._stepsDots(3)}</div>
        </div>
        <h3 class="wizard-q">¿Qué modelos propios incluís en la comparativa?</h3>
        ${prods.length === 0
          ? `<div class="empty-wizard">No hay productos en el catálogo de ${cat.nombre}.
              <br><button class="link-btn" onclick="APP.go(\'catalogo\')">→ Ir al catálogo a agregar</button></div>`
          : `<div class="prod-check-list" id="propios-list">
              ${prods.map(p => {
                const sel = !!this.state.wizard.propios.find(x => x.id === p.id);
                return `<div class="prod-check-item ${sel ? 'checked' : ''}" data-id="${p.id}" onclick="APP.togglePropio('${p.id}', this)">
                  <div class="pci-check">${sel ? '☑' : '☐'}</div>
                  <div class="pci-info">
                    <strong>${p.nombre}</strong>
                    <span>${p.sku || ''} · ${p.nivel || ''} · ${p.pvp_ars ? '$'+Number(p.pvp_ars).toLocaleString('es-AR') : 'Sin precio'}</span>
                  </div>
                  ${p.imagen_url ? `<img src="${p.imagen_url}" class="pci-img">` : ''}
                </div>`;
              }).join('')}
            </div>`}
        <div class="wizard-foot">
          <button class="btn-ghost" onclick="APP.wizardBack()">← Atrás</button>
          <button class="btn-primary" id="btn-propios-next" onclick="APP.wizardNext()" ${this.state.wizard.propios.length===0?'disabled':''}>Siguiente →</button>
        </div>
      </div>`;
  },

  togglePropio(prodId, el) {
    const { catId } = this.state.wizard;
    const prods     = DB.getCatalog(catId);
    const prod      = prods.find(p => p.id === prodId);
    if (!prod) return;
    const i = this.state.wizard.propios.findIndex(p => p.id === prodId);
    if (i >= 0) {
      this.state.wizard.propios.splice(i, 1);
      el.classList.remove('checked');
      el.querySelector('.pci-check').textContent = '☐';
    } else {
      this.state.wizard.propios.push(prod);
      el.classList.add('checked');
      el.querySelector('.pci-check').textContent = '☑';
    }
    const btn = document.getElementById('btn-propios-next');
    if (btn) btn.disabled = this.state.wizard.propios.length === 0;
  },

  // Step 4: Add external products
  renderWizardStep4() {
    const { catId, tipo } = this.state.wizard;
    const cat   = CONFIG.getAllCats()[catId];
    const externos = this.state.wizard.externos;

    const renderExtCard = (p, i) => `
      <div class="ext-card">
        <div class="ext-card-head">
          <span class="ext-num">#${i+1}</span>
          <input type="text" class="ext-nombre" value="${p.nombre||''}"
            placeholder="Nombre del producto"
            onchange="APP.updateExterno(${i},'nombre',this.value)">
          <button class="btn-icon btn-del" onclick="APP.removeExterno(${i})">✕</button>
        </div>
        <div class="ext-fields">
          <div class="form-row-3">
            <div class="form-group">
              <label>SKU / Modelo</label>
              <input type="text" value="${p.sku||''}" onchange="APP.updateExterno(${i},'sku',this.value)" placeholder="–">
            </div>
            <div class="form-group">
              <label>Precio ARS</label>
              <input type="number" value="${p.precio_ars||''}" onchange="APP.updateExterno(${i},'precio_ars',this.value)" placeholder="0">
            </div>
            <div class="form-group">
              <label>FOB USD</label>
              <input type="number" step="0.01" value="${p.fob_usd||''}" onchange="APP.updateExterno(${i},'fob_usd',this.value)" placeholder="0.00">
            </div>
          </div>
          <div class="form-row-2">
            <div class="form-group">
              <label>Imagen</label>
              <div class="img-url-row">
                <input type="text" id="img-url-${i}" value="${p.imagen_url||''}" onchange="APP.updateExterno(${i},'imagen_url',this.value)" placeholder="https://...jpg" style="flex:1">
                <button class="btn-paste-img" title="Pegar imagen del portapapeles" onclick="APP.pasteImage(${i})">📋</button>
                <input type="file" id="img-file-${i}" accept="image/*" style="display:none" onchange="APP.fileToImage(${i},this)">
                <button class="btn-paste-img" title="Subir imagen" onclick="document.getElementById('img-file-${i}').click()">🖼</button>
              </div>
              ${p.imagen_url ? `<img src="${p.imagen_url}" class="img-preview" style="margin-top:6px;width:60px;height:60px;object-fit:contain;border-radius:6px;border:1px solid var(--border)">` : ''}
            </div>
            <div class="form-group">
              <label>Fuente / URL</label>
              <div style="display:flex;gap:6px">
                <input type="text" value="${p.fuente||''}" onchange="APP.updateExterno(${i},'fuente',this.value)" placeholder="https://...">
                <button class="btn-ai" onclick="APP.extractFromURL(${i})" title="Extraer specs con IA">✨ IA</button>
              </div>
            </div>
          </div>
          <div class="specs-ext-grid">
            ${cat.campos.map(f => {
              const v = p[f.id] ?? '';
              if (f.tipo === 'booleano') return `
                <div class="form-group">
                  <label>${f.label} ${f.req?'<span class="req">*</span>':''}</label>
                  <select onchange="APP.updateExterno(${i},'${f.id}',this.value)">
                    <option value="" ${v===''?'selected':''}>–</option>
                    <option value="true"  ${v===true||v==='true' ?'selected':''}>Sí</option>
                    <option value="false" ${v===false||v==='false'?'selected':''}>No</option>
                  </select>
                </div>`;
              return `
                <div class="form-group">
                  <label>${f.label}${f.unidad?` (${f.unidad})`:''} ${f.req?'<span class="req">*</span>':''}</label>
                  <input type="${f.tipo==='numero'?'number':'text'}" value="${v}"
                    onchange="APP.updateExterno(${i},'${f.id}',this.value)"
                    placeholder="${p._ai_filled && !v ? '(IA pendiente)' : f.req?'Req':'Opt'}">
                </div>`;
            }).join('')}
          </div>
          <div class="form-group" style="margin-top:8px">
            <label>Diferenciadores</label>
            <textarea rows="2" onchange="APP.updateExterno(${i},'diferenciadores',this.value)" placeholder="Diferenciadores del producto externo…">${p.diferenciadores||''}</textarea>
          </div>
        </div>
      </div>`;

    document.getElementById('sec-nueva').innerHTML = `
      <div class="wizard-wrap">
        <div class="wizard-head">
          <h2>Productos externos</h2>
          <div class="wizard-steps">${this._stepsDots(4)}</div>
        </div>
        <div class="file-import-box">
          <div class="fib-icon">📎</div>
          <div class="fib-text">
            <strong>Cargar desde archivo</strong>
            <span>Excel de cotización o PDF — la IA detecta todos los productos automáticamente</span>
          </div>
          <input type="file" id="ext-file-input" accept=".xlsx,.xls,.pdf" style="display:none"
            onchange="APP.loadExternosFromFile(this)">
          <button class="btn-primary" onclick="document.getElementById('ext-file-input').click()">
            Seleccionar archivo
          </button>
        </div>

        <div class="ext-separator"><span>o cargá productos uno a uno</span></div>

        <div id="externos-list">
          ${externos.length ? externos.map((p,i) => renderExtCard(p,i)).join('') : ''}
        </div>
        <button class="btn-ghost btn-add-ext" onclick="APP.addExterno()">+ Agregar producto externo manualmente</button>
        <div class="wizard-foot">
          <button class="btn-ghost" onclick="APP.wizardBack()">← Atrás</button>
          <button class="btn-primary" onclick="APP.wizardNext()" ${externos.length===0?'disabled':''}>Siguiente →</button>
        </div>
      </div>`;
  },

  // ── Load externos from Excel or PDF file ─────────────────────────────────
  async loadExternosFromFile(input) {
    const file = input.files[0];
    if (!file) return;
    const { catId } = this.state.wizard;
    const ext = file.name.split('.').pop().toLowerCase();

    document.body.insertAdjacentHTML('beforeend',
      '<div class="modal-overlay" id="ext-file-modal">' +
      '<div class="modal-box" style="max-width:560px">' +
      '<div class="modal-head"><h2>📎 Importando archivo</h2></div>' +
      '<div class="modal-body" id="ext-file-body">' +
      '<div style="text-align:center;padding:30px">' +
      '<div style="font-size:32px;margin-bottom:12px">⏳</div>' +
      '<p id="ext-file-status">Leyendo archivo…</p>' +
      '</div></div></div></div>');

    const setStatus = (msg) => {
      const el = document.getElementById('ext-file-status');
      if (el) el.textContent = msg;
    };

    try {
      let textContent = '';

      if (ext === 'pdf') {
        setStatus('Cargando lector de PDF…');
        if (!window.pdfjsLib) {
          await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
          });
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
        setStatus('Extrayendo texto del PDF…');
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        for (let p = 1; p <= pdf.numPages; p++) {
          const page  = await pdf.getPage(p);
          const items = (await page.getTextContent()).items;
          textContent += items.map(i => i.str).join(' ') + '\n';
        }

      } else if (ext === 'xlsx' || ext === 'xls') {
        setStatus('Cargando lector de Excel…');
        if (!window.XLSX) {
          await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
          });
        }
        setStatus('Leyendo hojas de cálculo…');
        const arrayBuffer = await file.arrayBuffer();
        const wb  = window.XLSX.read(arrayBuffer, { type: 'array' });
        for (const sheetName of wb.SheetNames) {
          const ws  = wb.Sheets[sheetName];
          const csv = window.XLSX.utils.sheet_to_csv(ws, { blankrows: false });
          textContent += '\n=== Hoja: ' + sheetName + ' ===\n' + csv + '\n';
        }
      } else {
        throw new Error('Formato no soportado. Usá Excel (.xlsx) o PDF.');
      }

      setStatus('🤖 Enviando a IA para interpretar los productos…');
      const products = await GEMINI.extractFromPDF(textContent, {}, catId);
      if (!products || !products.length) throw new Error('No se encontraron productos en el archivo.');
      this._showExternosPreview(products, catId);

    } catch(e) {
      document.getElementById('ext-file-body').innerHTML =
        '<div style="padding:20px;text-align:center">' +
        '<p style="color:var(--danger);margin-bottom:16px">⚠ ' + e.message + '</p>' +
        '<button class="btn-ghost" onclick="APP.closeModal(\'ext-file-modal\')">Cerrar</button>' +
        '</div>';
    }
    input.value = '';
  },

  _showExternosPreview(products) {
    this.state._pendingExternos = products;
    const rows = products.map((p, i) => {
      const precio = p.precio_ars
        ? '$' + Number(p.precio_ars).toLocaleString('es-AR')
        : p.pvp_ars ? '$' + Number(p.pvp_ars).toLocaleString('es-AR') : '–';
      const sku = (p.sku || '–').replace(/</g,'&lt;');
      const nom = (p.nombre || '–').replace(/</g,'&lt;');
      return '<tr>' +
        '<td><input type="checkbox" class="ext-check" data-i="' + i + '" checked></td>' +
        '<td><span class="sku-text">' + sku + '</span></td>' +
        '<td>' + nom + '</td>' +
        '<td>' + precio + '</td>' +
        '<td>' + (p.fob_usd ? 'USD ' + p.fob_usd : '–') + '</td>' +
        '</tr>';
    }).join('');

    const bodyParts = [];
    bodyParts.push('<p style="margin-bottom:14px;font-size:13px;color:var(--text-muted)">Se encontraron <strong>' + products.length + ' productos</strong>. Seleccioná cuáles agregar.</p>');
    bodyParts.push('<div style="overflow-x:auto;max-height:380px;overflow-y:auto"><table class="data-table">');
    bodyParts.push('<thead><tr><th><input type="checkbox" id="ext-check-all" checked onclick="document.querySelectorAll(&quot;.ext-check&quot;).forEach(c=>c.checked=this.checked)"></th>');
    bodyParts.push('<th>SKU</th><th>Nombre</th><th>Precio</th><th>FOB</th></tr></thead>');
    bodyParts.push('<tbody>' + rows + '</tbody></table></div>');
    bodyParts.push('<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px">');
    bodyParts.push('<button class="btn-ghost" onclick="APP.closeModal(\'ext-file-modal\')">Cancelar</button>');
    bodyParts.push('<button class="btn-primary" onclick="APP.confirmExternosFromFile()">Agregar seleccionados →</button>');
    bodyParts.push('</div>');
    document.getElementById('ext-file-body').innerHTML = bodyParts.join('');
  },

  confirmExternosFromFile() {
    const products = this.state._pendingExternos || [];
    const checks   = document.querySelectorAll('.ext-check');
    const selected = products.filter((_, i) => checks[i]?.checked);
    this.state.wizard.externos.push(...selected);
    this.state._pendingExternos = null;
    this.closeModal('ext-file-modal');
    this.renderWizardStep4();
    this.showToast(selected.length + ' productos agregados desde el archivo.', 'success');
  },

  // ── Paste image from clipboard ────────────────────────────────────────────
  async pasteImage(i) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = item.types.find(t => t.startsWith('image/'));
        if (imgType) {
          const blob   = await item.getType(imgType);
          const b64    = await this._blobToBase64(blob);
          this.state.wizard.externos[i].imagen_url = b64;
          // Update preview without full re-render
          const input = document.getElementById('img-url-' + i);
          if (input) input.value = '(imagen pegada)';
          const preview = input?.closest('.form-group')?.querySelector('.img-preview');
          if (preview) { preview.src = b64; }
          else {
            const div = document.createElement('img');
            div.src = b64; div.className = 'img-preview';
            div.style.cssText = 'margin-top:6px;width:60px;height:60px;object-fit:contain;border-radius:6px;border:1px solid var(--border)';
            input?.closest('.form-group')?.appendChild(div);
          }
          this.showToast('Imagen pegada.', 'success');
          return;
        }
      }
      this.showToast('No hay imagen en el portapapeles. Copiá la imagen primero (clic derecho → Copiar imagen).', 'warn');
    } catch(e) {
      // Fallback: ask user to use file upload
      this.showToast('No se pudo acceder al portapapeles. Usá el botón 🖼 para subir el archivo.', 'warn');
    }
  },

  async fileToImage(i, input) {
    const file = input.files[0];
    if (!file) return;
    const b64 = await this._blobToBase64(file);
    this.state.wizard.externos[i].imagen_url = b64;
    const urlInput = document.getElementById('img-url-' + i);
    if (urlInput) urlInput.value = '(imagen cargada)';
    const existing = urlInput?.closest('.form-group')?.querySelector('.img-preview');
    if (existing) { existing.src = b64; }
    else {
      const img = document.createElement('img');
      img.src = b64; img.className = 'img-preview';
      img.style.cssText = 'margin-top:6px;width:60px;height:60px;object-fit:contain;border-radius:6px;border:1px solid var(--border)';
      urlInput?.closest('.form-group')?.appendChild(img);
    }
    this.showToast('Imagen cargada.', 'success');
    input.value = '';
  },

  _blobToBase64(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  },

  addExterno() {
    this.state.wizard.externos.push({ nombre: '', _new: true });
    this.renderWizardStep4();
  },

  removeExterno(i) {
    this.state.wizard.externos.splice(i, 1);
    this.renderWizardStep4();
  },

  updateExterno(i, field, value) {
    this.state.wizard.externos[i][field] = value;
  },

  async extractFromURL(i) {
    const p     = this.state.wizard.externos[i];
    const url   = p.fuente;
    if (!url) { this.showToast('Ingresá una URL primero.', 'warn'); return; }
    this.showToast('Extrayendo specs con IA…', 'info');
    try {
      const extracted = await GEMINI.extractFromURL(url, this.state.wizard.catId);
      this.state.wizard.externos[i] = { ...p, ...extracted, fuente: url };
      this.renderWizardStep4();
      this.showToast('Specs extraídas. Revisá y corregí si hace falta.', 'success');
    } catch(e) {
      this.showToast('Error: ' + e.message, 'error');
    }
  },

  // Step 5: Generate comparison
  async renderWizardStep5() {
    const { catId, tipo, propios, externos, nombre } = this.state.wizard;
    const cat = CONFIG.getAllCats()[catId];

    document.getElementById('sec-nueva').innerHTML = `
      <div class="wizard-wrap">
        <div class="wizard-head">
          <h2>Generar comparativa</h2>
          <div class="wizard-steps">${this._stepsDots(5)}</div>
        </div>
        <div class="form-group" style="max-width:400px;margin-bottom:20px">
          <label>Nombre de la comparativa</label>
          <input type="text" id="comp-nombre" value="${nombre||''}" placeholder="ej. Aspiradoras Robot Mayo 2026"
            oninput="APP.state.wizard.nombre=this.value">
        </div>
        <div class="summary-box">
          <div class="sum-col">
            <h4>Propios (${propios.length})</h4>
            ${propios.map(p=>`<div class="sum-item">📦 ${p.nombre||p.sku}</div>`).join('')||'<em>Ninguno</em>'}
          </div>
          <div class="sum-col">
            <h4>Externos (${externos.length})</h4>
            ${externos.map(p=>`<div class="sum-item">🔍 ${p.nombre||p.fuente||'Sin nombre'}</div>`).join('')||'<em>Ninguno</em>'}
          </div>
        </div>
        <div id="gen-status" class="gen-status" style="display:none"></div>
        <div class="wizard-foot">
          <button class="btn-ghost" onclick="APP.wizardBack()">← Atrás</button>
          <button class="btn-primary" id="btn-generate" onclick="APP.runGenerate()">
            ✨ Generar con IA
          </button>
          <button class="btn-ghost" onclick="APP.skipAnalysis()">Generar sin análisis IA →</button>
        </div>
      </div>`;
  },

  async runGenerate() {
    const { catId, tipo, propios, externos } = this.state.wizard;
    document.getElementById('btn-generate').disabled = true;
    const status = document.getElementById('gen-status');
    status.style.display = 'block';
    status.className = 'gen-status info';
    status.textContent = '✨ Analizando con IA…';

    try {
      const analisis = await GEMINI.analyzeComparativa(propios, externos, tipo, catId);
      this.state.wizard.analisis = analisis;
      status.className = 'gen-status success';
      status.textContent = '✅ Análisis listo. Pasando al preview…';
      setTimeout(() => this.wizardNext(), 800);
    } catch(e) {
      status.className = 'gen-status error';
      status.textContent = '⚠ ' + e.message;
      document.getElementById('btn-generate').disabled = false;
    }
  },

  skipAnalysis() {
    this.state.wizard.analisis = {};
    this.wizardNext();
  },

  // Step 6: Preview & Export
  renderWizardStep6() {
    const w   = this.state.wizard;
    const cat = CONFIG.getAllCats()[w.catId];

    document.getElementById('sec-nueva').innerHTML = `
      <div class="wizard-wrap wizard-wide">
        <div class="wizard-head">
          <h2>Preview y exportar</h2>
          <div class="wizard-steps">${this._stepsDots(6)}</div>
        </div>
        <div class="export-toolbar">
          <div class="format-toggle">
            <button class="btn-format ${w.formato==='tarjetas'?'active':''}" onclick="APP.setFormato('tarjetas')">🃏 Tarjetas</button>
            <button class="btn-format ${w.formato==='tabla'?'active':''}" onclick="APP.setFormato('tabla')">📊 Tabla</button>
          </div>
          <button class="btn-primary" onclick="APP.exportComp()">⬇ Descargar HTML</button>
          <button class="btn-ghost" onclick="APP.saveAndFinish()">💾 Guardar en índice</button>
        </div>
        <div class="preview-frame-wrap">
          <iframe id="comp-preview" class="preview-frame"></iframe>
        </div>
        <div class="wizard-foot">
          <button class="btn-ghost" onclick="APP.wizardBack()">← Atrás</button>
          <button class="btn-primary" onclick="APP.saveAndFinish()">💾 Guardar y terminar</button>
        </div>
      </div>`;

    this._updatePreview();
  },

  setFormato(f) {
    this.state.wizard.formato = f;
    document.querySelectorAll('.btn-format').forEach(b => b.classList.remove('active'));
    document.querySelector(`.btn-format:${f==='tarjetas'?'first':'last'}-child`).classList.add('active');
    this._updatePreview();
  },

  _updatePreview() {
    const w    = this.state.wizard;
    const comp = { ...w, fecha: new Date().toISOString() };
    const html = EXPORT.generate(comp, w.formato);
    const iframe = document.getElementById('comp-preview');
    if (!iframe) return;
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
  },

  exportComp() {
    const w    = this.state.wizard;
    const comp = { ...w, fecha: new Date().toISOString() };
    const html = EXPORT.generate(comp, w.formato);
    const cat  = CONFIG.getAllCats()[w.catId];
    const name = (w.nombre || `comparativa_${cat.id}`).replace(/\s+/g,'_').toLowerCase();
    EXPORT.downloadHTML(html, `${name}_${w.formato}.html`);
    this.showToast('HTML descargado.', 'success');
  },

  saveAndFinish() {
    const w    = this.state.wizard;
    const comp = {
      catId:    w.catId,
      tipo:     w.tipo,
      nombre:   w.nombre || `Comparativa ${CONFIG.getAllCats()[w.catId].nombre}`,
      propios:  w.propios,
      externos: w.externos,
      analisis: w.analisis,
      formato:  w.formato,
    };
    const saved = DB.saveComparativa(comp);
    DB.pushComparativa(saved).catch(() => {});
    this.showToast('Guardado en el índice y en Sheets.', 'success');
    this.state.wizard = null;
    this.go('indice');
  },

  _stepsDots(current) {
    const labels = ['Categoría','Tipo','Propios','Externos','Generar','Exportar'];
    return labels.map((l,i) => `
      <div class="step-dot ${i+1===current?'active':i+1<current?'done':''}">
        <div class="dot">${i+1<current?'✓':i+1}</div>
        <span>${l}</span>
      </div>`).join('');
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // INDEX
  // ═══════════════════════════════════════════════════════════════════════════
  renderIndex() {
    const list = DB.getComparativas();
    const rows = list.length
      ? list.map(c => {
          const cat  = CONFIG.getAllCats()[c.catId] || {};
          const tipo = CONFIG.tipos.find(t => t.id === c.tipo) || {};
          return `
            <tr>
              <td>${new Date(c.fecha).toLocaleDateString('es-AR')}</td>
              <td>${cat.emoji||''} ${cat.nombre||c.catId}</td>
              <td>${tipo.label||c.tipo}</td>
              <td><strong>${c.nombre}</strong></td>
              <td>${(c.propios||[]).length + (c.externos||[]).length} productos</td>
              <td class="actions-cell">
                <button class="btn-icon" onclick="APP.previewComp('${c.id}')" title="Ver">👁</button>
                <button class="btn-icon" onclick="APP.reexportComp('${c.id}','tarjetas')" title="HTML tarjetas">🃏</button>
                <button class="btn-icon" onclick="APP.reexportComp('${c.id}','tabla')" title="HTML tabla">📊</button>
                <button class="btn-icon btn-del" onclick="APP.deleteComp('${c.id}')" title="Eliminar">🗑</button>
              </td>
            </tr>`;
        }).join('')
      : `<tr><td colspan="6" class="empty-row">Sin comparativas guardadas. <button class="link-btn" onclick="APP.go('nueva')">Crear la primera →</button></td></tr>`;

    document.getElementById('sec-indice').innerHTML = `
      <div class="sec-head">
        <h2>Índice de Comparativas</h2>
        <div style="display:flex;gap:8px">
          <button class="btn-ghost" onclick="APP.syncComparativas()">↓ Sincronizar desde Sheets</button>
          <button class="btn-primary" onclick="APP.go('nueva')">+ Nueva comparativa</button>
        </div>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr><th>Fecha</th><th>Categoría</th><th>Tipo</th><th>Nombre</th><th>Productos</th><th>Acciones</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  },

  async syncComparativas() {
    this.showToast('Sincronizando comparativas…', 'info');
    try {
      const count = await DB.pullComparativas();
      this.showToast(`${count} comparativas sincronizadas.`, 'success');
      this.renderIndex();
    } catch(e) {
      this.showToast('Error: ' + e.message, 'error');
    }
  },

  previewComp(id) {
    const comp = DB.getComparativas().find(c => c.id === id);
    if (!comp) return;
    const html = EXPORT.generate(comp, comp.formato || 'tarjetas');
    const w    = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  },

  reexportComp(id, formato) {
    const comp = DB.getComparativas().find(c => c.id === id);
    if (!comp) return;
    const html = EXPORT.generate(comp, formato);
    const name = (comp.nombre||`comparativa_${id}`).replace(/\s+/g,'_').toLowerCase();
    EXPORT.downloadHTML(html, `${name}_${formato}.html`);
    this.showToast('HTML exportado.', 'success');
  },

  deleteComp(id) {
    if (!confirm('¿Eliminar esta comparativa del índice?')) return;
    DB.deleteComparativa(id);
    this.renderIndex();
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIG
  // ═══════════════════════════════════════════════════════════════════════════
  _renderCatsList() {
    return Object.values(CONFIG.getAllCats()).map(cat => {
      const isBase = CONFIG.isBaseCat(cat.id);
      const editBtn = '<button class="btn-icon" onclick="APP.openCatModal(\'' + cat.id + '\')" title="Editar">✏️</button>';
      const delBtn  = !isBase ? '<button class="btn-icon btn-del" onclick="APP.deleteCat(\'' + cat.id + '\')" title="Eliminar">🗑</button>' : '';
      return '<div class="cat-list-item">' +
        '<div class="cat-list-info">' +
        '<span class="cat-list-emoji">' + (cat.emoji||'📦') + '</span>' +
        '<div><strong>' + cat.nombre + '</strong>' +
        '<span class="cat-list-meta"> · ' + cat.campos.length + ' specs · ' + (isBase ? 'Base' : 'Personalizada') + '</span></div>' +
        '</div>' +
        '<div class="cat-list-actions">' + editBtn + delBtn + '</div></div>';
    }).join('');
  },

  openCatModal(catId = null) {
    const allCats = CONFIG.getAllCats();
    const cat     = catId ? allCats[catId] : null;
    const isBase  = catId ? CONFIG.isBaseCat(catId) : false;
    const campos  = cat ? cat.campos : [];

    const camposHTML = campos.map((f) => {
      const unidad = f.unidad || '';
      const label  = f.label || '';
      const tipo   = f.tipo || 'texto';
      const reqChk = f.req ? 'checked' : '';
      return '<div class="campo-row">' +
        '<input type="text" class="campo-label" value="' + label + '" placeholder="Nombre" ' + (isBase?'disabled':'') + '>' +
        '<input type="text" class="campo-unidad" value="' + unidad + '" placeholder="Pa, W, °C..." ' + (isBase?'disabled':'') + '>' +
        '<select class="campo-tipo" ' + (isBase?'disabled':'') + '>' +
        '<option value="texto"'   + (tipo==='texto'  ?' selected':'') + '>Texto</option>' +
        '<option value="numero"'  + (tipo==='numero' ?' selected':'') + '>Número</option>' +
        '<option value="booleano"'+ (tipo==='booleano'?' selected':'') + '>Sí/No</option>' +
        '</select>' +
        '<label class="campo-req-wrap" title="¿Campo requerido para comparar?">' +
        '<input type="checkbox" class="campo-req" ' + reqChk + (isBase?' disabled':'') + '>' +
        '<span>Req.</span></label>' +
        (!isBase ? '<button class="btn-icon btn-del" onclick="this.closest(\'.campo-row\').remove()">✕</button>' : '<span></span>') +
        '</div>';
    }).join('');

    const footer = isBase
      ? '<span style="font-size:12px;color:var(--text-muted)">Las categorías base no se modifican desde la app</span>'
      : '<button class="btn-ghost" onclick="APP.closeModal(\'cat-modal\')">Cancelar</button>' +
        '<button class="btn-primary" onclick="APP.saveCat(\'' + (catId||'') + '\')">Guardar categoría</button>';

    // ── AI import zone (only for new/custom categories) ───────────────────
    const aiZone = isBase ? '' :
      '<div class="form-section" id="cat-ai-zone">' +
      '<h3>✨ Detectar specs con IA desde archivo</h3>' +
      '<p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">' +
      'Subí una ficha técnica, catálogo, planilla Excel, PDF o CSV. ' +
      'La IA leerá el documento, identificará las especificaciones clave y completará los campos automáticamente. ' +
      'Podés revisar y editar cada campo antes de guardar.</p>' +
      '<div class="file-import-box" id="cat-drop-zone" ' +
        'ondragover="event.preventDefault();this.classList.add(\'drag-over\')" ' +
        'ondragleave="this.classList.remove(\'drag-over\')" ' +
        'ondrop="event.preventDefault();this.classList.remove(\'drag-over\');APP._catFileInfer(event.dataTransfer.files[0])">' +
        '<div class="fib-icon">🗂</div>' +
        '<div class="fib-text">' +
          '<strong>Arrastrar o seleccionar archivo</strong>' +
          '<span>PDF · Excel (.xlsx) · CSV · TXT — la IA detecta las specs automáticamente</span>' +
        '</div>' +
        '<input type="file" id="cat-file-input" accept=".pdf,.xlsx,.xls,.csv,.txt,.jpg,.jpeg,.png" ' +
          'style="display:none" onchange="APP._catFileInfer(this.files[0])">' +
        '<button class="btn-ai" onclick="document.getElementById(\'cat-file-input\').click()">Seleccionar</button>' +
      '</div>' +
      '<div id="cat-ai-status" style="display:none"></div>' +
      '</div>';

    document.body.insertAdjacentHTML('beforeend',
      '<div class="modal-overlay" id="cat-modal">' +
      '<div class="modal-box modal-xl">' +
      '<div class="modal-head">' +
      '<h2>' + (cat ? 'Editar: ' + cat.nombre : 'Nueva categoría') + '</h2>' +
      '<button class="modal-close" onclick="APP.closeModal(\'cat-modal\')">✕</button>' +
      '</div><div class="modal-body">' +

      // Name + emoji row
      '<div class="form-grid-2" style="margin-bottom:20px">' +
      '<div class="form-group"><label>Nombre *</label>' +
      '<input type="text" id="cat-nombre" value="' + (cat?.nombre||'') + '" placeholder="ej. Smartwatch" ' + (isBase?'disabled':'') + '></div>' +
      '<div class="form-group"><label>Emoji</label>' +
      '<input type="text" id="cat-emoji" value="' + (cat?.emoji||'') + '" placeholder="⌚" maxlength="2" ' + (isBase?'disabled':'') + '></div>' +
      '</div>' +

      // AI zone
      aiZone +

      // Specs list header
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
      '<h3 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em">Specs técnicas</h3>' +
      (!isBase ?
        '<div style="display:flex;gap:8px">' +
        '<button class="btn-ghost" style="font-size:12px" onclick="APP._addCampoRow()">+ Agregar spec</button>' +
        '</div>'
        : '') +
      '</div>' +
      '<div class="campos-header">' +
        '<span>Nombre del campo</span>' +
        '<span>Unidad</span>' +
        '<span>Tipo</span>' +
        '<span>Req.</span>' +
        '<span></span>' +
      '</div>' +
      '<div id="campos-list">' + camposHTML + '</div>' +

      '</div>' +
      '<div class="modal-foot">' + footer + '</div>' +
      '</div></div>');
  },

  // ── AI file inference pipeline for category fields ────────────────────────
  async _catFileInfer(file) {
    if (!file) return;

    const statusEl = document.getElementById('cat-ai-status');
    const dropZone = document.getElementById('cat-drop-zone');

    const setStatus = (msg, type = 'info') => {
      statusEl.style.display = 'block';
      statusEl.className     = 'gen-status ' + type;
      statusEl.innerHTML     = msg;
    };

    // Check API key
    const { geminiKey } = DB.getSettings();
    if (!geminiKey) {
      setStatus('⚠ Configurá tu API Key en ⚙️ Config antes de usar la detección con IA.', 'error');
      return;
    }

    // Disable drop zone during processing
    if (dropZone) dropZone.style.pointerEvents = 'none';
    setStatus('<span style="display:flex;align-items:center;gap:8px">' +
      '<span class="cat-ai-spinner">⏳</span>' +
      '<span>Leyendo <strong>' + file.name + '</strong>…</span></span>', 'info');

    try {
      // Step 1: Extract text from file
      const { text, preview } = await GEMINI.extractTextFromFile(file);

      setStatus('<span style="display:flex;align-items:center;gap:8px">' +
        '<span class="cat-ai-spinner">🤖</span>' +
        '<span>Analizando especificaciones con IA…</span></span>', 'info');

      // Step 2: Get category context hint from name field
      const catContext = (document.getElementById('cat-nombre')?.value || '').trim();

      // Step 3: Ask AI to infer fields
      const campos = await GEMINI.inferFieldsFromFile(text, catContext);

      if (!campos.length) throw new Error('No se encontraron especificaciones en el documento.');

      // Step 4: Show preview of inferred fields
      this._renderInferredFields(campos, preview, file.name);

    } catch(e) {
      setStatus('⚠ ' + e.message, 'error');
    } finally {
      if (dropZone) dropZone.style.pointerEvents = '';
    }
  },

  // ── Render inferred fields as a preview with accept/reject controls ────────
  _renderInferredFields(campos, docPreview, fileName) {
    const statusEl = document.getElementById('cat-ai-status');
    if (!statusEl) return;

    // Group: required first, then optional
    const req = campos.filter(f => f.req);
    const opt = campos.filter(f => !f.req);

    const renderRow = (f, i) => {
      const tipoIcon = f.tipo === 'numero' ? '🔢' : f.tipo === 'booleano' ? '✅' : '📝';
      const reqBadge = f.req
        ? '<span style="font-size:10px;background:#dcfce7;color:#166534;padding:1px 6px;border-radius:10px;font-weight:700">REQ</span>'
        : '<span style="font-size:10px;background:var(--surface3);color:var(--text-muted);padding:1px 6px;border-radius:10px">opt</span>';
      return '<tr class="infer-row" data-i="' + i + '">' +
        '<td><input type="checkbox" class="infer-chk" data-i="' + i + '" checked></td>' +
        '<td>' + tipoIcon + '</td>' +
        '<td><input type="text" class="infer-label" data-i="' + i + '" value="' + f.label + '" ' +
          'style="border:none;background:transparent;font-weight:600;font-size:12px;width:100%;color:var(--text)" ' +
          'onchange="APP._updateInferredField(' + i + ',\'label\',this.value)"></td>' +
        '<td><input type="text" class="infer-unidad" data-i="' + i + '" value="' + (f.unidad||'') + '" ' +
          'style="border:none;background:transparent;font-size:12px;width:60px;color:var(--text-muted);text-align:center" ' +
          'placeholder="–" onchange="APP._updateInferredField(' + i + ',\'unidad\',this.value)"></td>' +
        '<td>' +
          '<select class="infer-tipo" data-i="' + i + '" style="border:none;background:transparent;font-size:12px;color:var(--text-muted)" ' +
          'onchange="APP._updateInferredField(' + i + ',\'tipo\',this.value)">' +
          '<option value="numero"'  + (f.tipo==='numero'  ?' selected':'') + '>Número</option>' +
          '<option value="texto"'   + (f.tipo==='texto'   ?' selected':'') + '>Texto</option>' +
          '<option value="booleano"'+ (f.tipo==='booleano'?' selected':'') + '>Sí/No</option>' +
          '</select>' +
        '</td>' +
        '<td>' + reqBadge + '</td>' +
        '</tr>';
    };

    // Store inferred fields globally for merge step
    this.state._inferredCampos = campos;

    const totalReq = req.length;
    const totalOpt = opt.length;

    statusEl.className     = 'gen-status success';
    statusEl.style.display = 'block';
    statusEl.innerHTML =
      '<div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">' +
        '<div>' +
          '<strong style="font-size:13px">✅ ' + campos.length + ' specs detectadas</strong>' +
          ' <span style="font-size:11px;color:var(--text-muted)">desde ' + fileName + '</span>' +
          '<div style="font-size:11px;margin-top:2px;color:var(--text-muted)">' +
            totalReq + ' requeridas · ' + totalOpt + ' opcionales' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn-ghost" style="font-size:12px;padding:6px 12px" ' +
            'onclick="document.querySelectorAll(\'.infer-chk\').forEach(c=>c.checked=true)">' +
            'Seleccionar todas</button>' +
          '<button class="btn-ghost" style="font-size:12px;padding:6px 12px" ' +
            'onclick="document.querySelectorAll(\'.infer-chk\').forEach(c=>c.checked=false)">' +
            'Deseleccionar</button>' +
        '</div>' +
      '</div>' +

      // Doc preview strip
      '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;' +
        'padding:8px 12px;font-size:11px;color:var(--text-muted);margin-bottom:12px;' +
        'max-height:56px;overflow:hidden;font-family:monospace;line-height:1.4" ' +
        'title="Texto extraído del documento">' +
        docPreview.replace(/</g,'&lt;').replace(/>/g,'&gt;') +
      '</div>' +

      // Fields table
      '<div style="max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;background:var(--surface)">' +
      '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<thead><tr style="background:var(--surface2);border-bottom:1px solid var(--border)">' +
        '<th style="padding:7px 10px;text-align:center;width:32px">' +
          '<input type="checkbox" id="infer-all" checked ' +
            'onclick="document.querySelectorAll(\'.infer-chk\').forEach(c=>c.checked=this.checked)">' +
        '</th>' +
        '<th style="padding:7px 4px;width:24px"></th>' +
        '<th style="padding:7px 10px;text-align:left;font-weight:700;color:var(--text-muted);font-size:11px;text-transform:uppercase">Nombre del campo</th>' +
        '<th style="padding:7px 10px;text-align:center;font-weight:700;color:var(--text-muted);font-size:11px;text-transform:uppercase">Unidad</th>' +
        '<th style="padding:7px 10px;text-align:center;font-weight:700;color:var(--text-muted);font-size:11px;text-transform:uppercase">Tipo</th>' +
        '<th style="padding:7px 10px;text-align:center;font-weight:700;color:var(--text-muted);font-size:11px;text-transform:uppercase">Req.</th>' +
      '</tr></thead>' +
      '<tbody>' +
        (req.length ? '<tr><td colspan="6" style="padding:4px 10px;background:#f0fdf4;font-size:10px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:.04em">Specs requeridas</td></tr>' : '') +
        req.map((f, i) => renderRow(f, campos.indexOf(f))).join('') +
        (opt.length ? '<tr><td colspan="6" style="padding:4px 10px;background:var(--surface2);font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">Specs opcionales</td></tr>' : '') +
        opt.map((f, i) => renderRow(f, campos.indexOf(f))).join('') +
      '</tbody>' +
      '</table></div>' +

      // Action buttons
      '<div style="display:flex;gap:10px;margin-top:14px;justify-content:flex-end">' +
        '<button class="btn-ghost" style="font-size:12px" ' +
          'onclick="document.getElementById(\'cat-ai-status\').style.display=\'none\';APP.state._inferredCampos=null">' +
          'Descartar</button>' +
        '<button class="btn-primary" onclick="APP._mergeInferredCampos()">' +
          '➕ Agregar specs seleccionadas al formulario</button>' +
      '</div>';
  },

  // ── Keep inferred fields in sync as user edits them inline ───────────────
  _updateInferredField(i, key, value) {
    if (this.state._inferredCampos && this.state._inferredCampos[i]) {
      this.state._inferredCampos[i][key] = value;
    }
  },

  // ── Merge selected inferred campos into the campos-list form ─────────────
  _mergeInferredCampos() {
    const campos   = this.state._inferredCampos || [];
    const checks   = document.querySelectorAll('.infer-chk');
    const selected = campos.filter((_, i) => checks[i]?.checked);

    if (!selected.length) {
      this.showToast('Seleccioná al menos una spec.', 'warn');
      return;
    }

    // Read existing labels to avoid exact duplicates
    const existing = new Set();
    document.querySelectorAll('.campo-row .campo-label').forEach(el => {
      if (el.value.trim()) existing.add(el.value.trim().toLowerCase());
    });

    let added = 0, skipped = 0;
    const list = document.getElementById('campos-list');

    for (const f of selected) {
      if (existing.has(f.label.toLowerCase())) { skipped++; continue; }

      // Read back potentially edited values from the table
      const row = document.createElement('div');
      row.className = 'campo-row campo-row--ai'; // extra class for visual distinction

      const tipoOpts =
        '<option value="numero"'  + (f.tipo==='numero'  ?' selected':'') + '>Número</option>' +
        '<option value="texto"'   + (f.tipo==='texto'   ?' selected':'') + '>Texto</option>' +
        '<option value="booleano"'+ (f.tipo==='booleano'?' selected':'') + '>Sí/No</option>';

      row.innerHTML =
        '<input type="text" class="campo-label" value="' + f.label.replace(/"/g,'&quot;') + '" placeholder="Nombre">' +
        '<input type="text" class="campo-unidad" value="' + (f.unidad||'') + '" placeholder="Pa, W, °C...">' +
        '<select class="campo-tipo">' + tipoOpts + '</select>' +
        '<label class="campo-req-wrap" title="Campo requerido">' +
          '<input type="checkbox" class="campo-req"' + (f.req?' checked':'') + '>' +
          '<span>Req.</span>' +
        '</label>' +
        '<button class="btn-icon btn-del" onclick="this.closest(\'.campo-row\').remove()">✕</button>';

      list.appendChild(row);
      existing.add(f.label.toLowerCase());
      added++;
    }

    // Hide the AI preview panel
    const statusEl = document.getElementById('cat-ai-status');
    if (statusEl) statusEl.style.display = 'none';
    this.state._inferredCampos = null;

    // Scroll campos-list into view
    list.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    const msg = added + ' specs agregadas' + (skipped ? ' (' + skipped + ' ya existían, omitidas)' : '') + '.';
    this.showToast(msg, 'success');
  },

  _addCampoRow() {
    const row = document.createElement('div');
    row.className = 'campo-row';
    row.innerHTML =
      '<input type="text" class="campo-label" placeholder="ej. Pantalla">' +
      '<input type="text" class="campo-unidad" placeholder="pulg / W / vacío">' +
      '<select class="campo-tipo">' +
      '<option value="texto">Texto</option>' +
      '<option value="numero">Número</option>' +
      '<option value="booleano">Sí/No</option>' +
      '</select>' +
      '<label class="campo-req-wrap"><input type="checkbox" class="campo-req"><span>Req.</span></label>' +
      '<button class="btn-icon btn-del" onclick="this.closest(\'.campo-row\').remove()">✕</button>';
    document.getElementById('campos-list').appendChild(row);
  },

  async saveCat(existingId) {
    const nombre = document.getElementById('cat-nombre').value.trim();
    const emoji  = document.getElementById('cat-emoji').value.trim() || '📦';
    if (!nombre) { this.showToast('El nombre es obligatorio.', 'error'); return; }

    const campos = [];
    document.querySelectorAll('.campo-row').forEach(row => {
      const label  = row.querySelector('.campo-label')?.value.trim();
      if (!label) return;
      const unidad = row.querySelector('.campo-unidad')?.value.trim() || '';
      const tipo   = row.querySelector('.campo-tipo')?.value || 'texto';
      const req    = row.querySelector('.campo-req')?.checked || false;

      // Auto-detect type from unidad hint (SN = booleano, any known unit = numero)
      let finalTipo = tipo;
      if (unidad === 'SN') finalTipo = 'booleano';
      else if (unidad && unidad !== 'SN') finalTipo = 'numero';

      const id = label.toLowerCase().replace(/[^a-z0-9]/g,'_').replace(/__+/g,'_') +
                 (unidad && unidad !== 'SN' ? '_' + unidad.toLowerCase() : unidad === 'SN' ? '_sn' : '');
      campos.push({ id, label, unidad: unidad&&unidad!=='SN'?unidad:undefined, tipo: finalTipo, req });
    });

    if (!campos.length) { this.showToast('Agregá al menos una spec.', 'error'); return; }

    const id        = existingId || nombre.toLowerCase().replace(/[^a-z0-9]/g,'_').replace(/__+/g,'_');
    const sheetName = 'Catalogo_' + nombre.replace(/\s+/g,'');
    const cat       = { id, nombre, emoji, sheetName, niveles: ['Entry','Mid','High','Premium'], campos };

    CONFIG.addCustomCat(cat);
    DB.createCategorySheet(cat).catch(()=>{});
    DB.pushCategories().catch(()=>{});

    this.closeModal('cat-modal');
    this.showToast('Categoría guardada. Creando pestaña en Sheets…', 'success');
    this.renderConfig();
    this.renderCatalog();
  },

  deleteCat(catId) {
    if (!confirm('¿Eliminar esta categoría? Los productos locales se borran, el Sheet queda intacto.')) return;
    CONFIG.deleteCustomCat(catId);
    DB.saveCatalog(catId, []);
    if (this.state.catTab === catId) this.state.catTab = Object.keys(CONFIG.getAllCats())[0];
    this.showToast('Categoría eliminada.', 'success');
    this.renderConfig();
    this.renderCatalog();
  },

  renderConfig() {
    const s = DB.getSettings();
    document.getElementById('sec-config').innerHTML = `
      <div class="config-wrap">
        <h2>Configuración</h2>

        <div class="config-section">
          <h3>🤖 Gemini API Key</h3>
          <p class="config-hint">Obtenela en <a href="https://aistudio.google.com" target="_blank">aistudio.google.com</a> → Get API Key</p>
          <div class="form-row-2">
            <div class="form-group">
              <input type="password" id="cfg-gemini" value="${s.geminiKey||''}" placeholder="AIza...">
            </div>
          </div>
        </div>

        <div class="config-section">
          <h3>📊 Google Sheet</h3>
          <p class="config-hint">ID de tu planilla Gadnic Comparador (ya configurado)</p>
          <div class="form-group">
            <input type="text" id="cfg-sheet" value="${s.sheetId||CONFIG.sheetId}" placeholder="ID del Sheet">
          </div>
          <a href="https://docs.google.com/spreadsheets/d/${s.sheetId||CONFIG.sheetId}/edit" target="_blank" class="link-btn">→ Abrir Sheet</a>
        </div>

        <div class="config-section">
          <h3>🏢 Empresa</h3>
          <div class="form-row-2">
            <div class="form-group">
              <label>Nombre empresa</label>
              <input type="text" id="cfg-empresa" value="${s.empresa||CONFIG.empresa}" placeholder="Gadnic">
            </div>
            <div class="form-group">
              <label>TC referencia (USD→ARS)</label>
              <input type="number" id="cfg-tc" value="${s.tc||''}" placeholder="1300">
            </div>
          </div>
        </div>

        <button class="btn-primary" onclick="APP.saveConfig()">Guardar configuración</button>

        <div style="margin-top:28px;padding-top:24px;border-top:1px solid var(--border)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <h3 style="margin:0">📂 Categorías de producto</h3>
            <button class="btn-primary" onclick="APP.openCatModal()">+ Nueva categoría</button>
          </div>
          <div id="cats-list">${this._renderCatsList()}</div>
        </div>

        <div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--border)">
          <h3 style="margin-bottom:8px">💾 Backup completo</h3>
          <p class="config-hint" style="margin-bottom:12px">Exportá todo el catálogo, comparativas y configuración a un archivo JSON. Guardalo como respaldo — podés reimportarlo en cualquier momento o en otro navegador.</p>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <button class="btn-primary" onclick="APP.exportAllJSON()">⬇ Exportar todo (JSON)</button>
            <button class="btn-ghost" onclick="document.getElementById('json-import-file').click()">📂 Importar backup</button>
            <input type="file" id="json-import-file" accept=".json" style="display:none" onchange="APP.importAllJSON(this)">
          </div>
          <div id="import-status" style="display:none;margin-top:10px;font-size:12px;padding:10px 14px;border-radius:6px"></div>
        </div>

        <div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--border)">
          <h3 style="margin-bottom:12px">⚠ Zona de riesgo</h3>
          <button class="btn-danger" onclick="APP.clearAllData()">Borrar todos los datos locales</button>
        </div>
      </div>`;
  },

  saveConfig() {
    const settings = {
      geminiKey: document.getElementById('cfg-gemini').value.trim(),
      sheetId:   document.getElementById('cfg-sheet').value.trim(),
      empresa:   document.getElementById('cfg-empresa').value.trim(),
      tc:        parseFloat(document.getElementById('cfg-tc').value) || null,
    };
    DB.saveSettings(settings);
    if (settings.geminiKey) document.getElementById('setup-banner').style.display = 'none';
    this.showToast('Configuración guardada.', 'success');
  },

  exportAllJSON() {
    const data = DB.exportAll();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a    = document.createElement('a');
    const fecha = new Date().toLocaleDateString('es-AR').replace(/\//g,'-');
    a.href     = URL.createObjectURL(blob);
    a.download = `gadnic-comparador-backup-${fecha}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    this.showToast('Backup exportado.', 'success');
  },

  importAllJSON(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const status = document.getElementById('import-status');
      status.style.display = 'block';
      try {
        const data = JSON.parse(e.target.result);
        DB.importAll(data);
        status.style.background = '#f0fdf4';
        status.style.color = '#166534';
        status.textContent = '✅ Backup importado correctamente. Recargando…';
        input.value = '';
        setTimeout(() => location.reload(), 1200);
      } catch(err) {
        status.style.background = '#fef2f2';
        status.style.color = '#991b1b';
        status.textContent = '⚠ Error: ' + err.message;
      }
    };
    reader.readAsText(file);
  },

  clearAllData() {
    if (!confirm('¿Borrar TODO? Catálogo, comparativas y configuración. Esto no se puede deshacer.')) return;
    localStorage.clear();
    location.reload();
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PDF IMPORT
  // ═══════════════════════════════════════════════════════════════════════════
  openPDFImport(catId) {
    const input = document.getElementById('pdf-import-input');
    // Re-create input to allow same file re-selection
    input.value = '';
    input.setAttribute('onchange', `APP.handlePDFImport(this,'${catId}')`);
    input.click();
  },

  async handlePDFImport(input, catId) {
    const file = input.files[0];
    if (!file) return;

    const cat = CONFIG.getAllCats()[catId];

    // Show progress modal
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="pdf-import-modal">
        <div class="modal-box" style="max-width:560px">
          <div class="modal-head">
            <h2>📄 Importar desde PDF — ${cat.nombre}</h2>
          </div>
          <div class="modal-body" id="pdf-import-body">
            <div class="pdf-step" id="pdf-step-reading">
              <div class="pdf-spinner">⏳</div>
              <p>Leyendo PDF y extrayendo links…</p>
            </div>
          </div>
        </div>
      </div>`);

    try {
      // ── Step 1: Load PDF.js from CDN ──────────────────────────────────────
      if (!window.pdfjsLib) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }

      // ── Step 2: Read file as ArrayBuffer ──────────────────────────────────
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      // ── Step 3: Extract text + annotations from all pages ─────────────────
      let fullText = '';
      const linksByRow = { publicacion: [], qc: [], artworks: [] };

      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);

        // Text
        const tc = await page.getTextContent();
        fullText += tc.items.map(i => i.str).join(' ') + '\n';

        // Annotations (links) — url or unsafeUrl depending on PDF.js version
        const annotations = await page.getAnnotations();
        const uriAnnots = annotations
          .filter(a => a.subtype === 'Link' && (a.url || a.unsafeUrl))
          .map(a => ({ url: a.url || a.unsafeUrl, x: a.rect[0], y: a.rect[1] }));

        // Group by Y row (bucket by 10pt)
        const rowMap = {};
        for (const a of uriAnnots) {
          const y = Math.round(a.y / 10) * 10;
          rowMap[y] = rowMap[y] || [];
          rowMap[y].push(a);
        }

        for (const row of Object.values(rowMap)) {
          const sorted = row.sort((a, b) => a.x - b.x);
          const urls   = sorted.map(r => r.url);
          if (urls.some(u => u.includes('bidcom.com.ar'))) {
            linksByRow.publicacion.push(...sorted.map(r => r.url));
          } else if (urls.some(u => u.includes('spreadsheets') || u.includes('drive.google'))) {
            linksByRow.qc.push(...urls);
          }
        }

      }

      // ── Step 4: Call AI ───────────────────────────────────────────────────
      this._pdfUpdateStatus('🤖 Enviando a IA para interpretar los productos…');

      const products = await GEMINI.extractFromPDF(fullText, linksByRow, catId);

      // ── Step 5: Show preview ──────────────────────────────────────────────
      this._pdfShowPreview(products, catId, linksByRow);

    } catch(e) {
      document.getElementById('pdf-import-body').innerHTML = `
        <div class="gen-status error" style="margin:0">⚠ ${e.message}</div>
        <div class="modal-foot" style="padding:16px 0 0;border:none">
          <button class="btn-ghost" onclick="APP.closeModal('pdf-import-modal')">Cerrar</button>
        </div>`;
    }
  },

  _pdfUpdateStatus(msg) {
    const body = document.getElementById('pdf-import-body');
    if (body) body.innerHTML = `
      <div style="text-align:center;padding:32px 0">
        <div style="font-size:32px;margin-bottom:16px">🤖</div>
        <p style="color:var(--text-muted);font-size:13px">${msg}</p>
      </div>`;
  },

  _pdfShowPreview(products, catId, linksByRow) {
    const cat = CONFIG.getAllCats()[catId];
    const body = document.getElementById('pdf-import-body');
    if (!body) return;

    // Build imagen_url from SKU template for all products that don't have one
    products.forEach(p => {
      if (!p.imagen_url && p.sku) {
        p.imagen_url = `https://images.bidcom.com.ar/resize?src=https://static.bidcom.com.ar/publicacionesML/productos/${p.sku}/1000x1000-${p.sku}-A.jpg&w=400&q=100`;
      }
    });

    // onerror handler: if template URL fails, fetch og:image from publication URL
    const onImgError = async (img, sku, fuenteUrl, idx) => {
      img.style.display = 'none';
      if (!fuenteUrl) return;
      try {
        const resolved = await GEMINI.resolveImageUrl(sku, fuenteUrl);
        if (resolved !== img.src) {
          img.src = resolved;
          img.style.display = '';
          // Update the product so it gets saved with the correct URL
          products[idx].imagen_url = resolved;
        }
      } catch { /* leave hidden */ }
    };
    // Expose globally for inline onerror
    window._pdfImgError = onImgError;

    const rows = products.map((p, i) => `
      <tr>
        <td><input type="checkbox" class="pdf-check" data-i="${i}" checked></td>
        <td style="text-align:center">
          ${p.imagen_url
            ? `<img src="${p.imagen_url}" data-i="${i}" data-sku="${p.sku||''}" data-fuente="${p.fuente||''}" style="width:40px;height:40px;object-fit:contain;border-radius:4px;border:1px solid var(--border)" onerror="window._pdfImgError(this,'${p.sku||''}','${p.fuente||''}',${i})">`
            : '<span style="font-size:20px">📷</span>'}
        </td>
        <td><span class="sku-text">${p.sku || '–'}</span></td>
        <td style="max-width:180px"><strong>${p.nombre || '–'}</strong></td>
        <td><span class="nivel-pill">${p.nivel || '–'}</span></td>
        <td>${p.pvp_ars ? '$' + Number(p.pvp_ars).toLocaleString('es-AR') : '–'}</td>
        <td>${p.fob_usd ? 'USD ' + p.fob_usd : '–'}</td>
        <td>${p.rentabilidad ? p.rentabilidad + '%' : '–'}</td>
        <td style="max-width:140px;font-size:11px">
          ${p.fuente
            ? `<a href="${p.fuente}" target="_blank" style="color:var(--accent);word-break:break-all">${p.fuente.replace('https://www.bidcom.com.ar','bidcom.com.ar')}</a>`
            : '<span class="nd">–</span>'}
        </td>
      </tr>`).join('');

    body.innerHTML = `
      <div class="gen-status success" style="margin-bottom:16px">
        ✅ Se detectaron <strong>${products.length} productos</strong>. Revisá y seleccioná los que querés importar.
      </div>
      <div class="table-scroll" style="max-height:340px;overflow-y:auto">
        <table class="data-table" style="font-size:12px">
          <thead>
            <tr>
              <th><input type="checkbox" id="pdf-check-all" checked onchange="document.querySelectorAll('.pdf-check').forEach(c=>c.checked=this.checked)"></th>
              <th>Img</th><th>SKU</th><th>Nombre</th><th>Nivel</th>
              <th>PVP ARS</th><th>FOB USD</th><th>Rent.</th><th>Link</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="modal-foot" style="padding:16px 0 0;border:none;justify-content:flex-end;display:flex;gap:10px">
        <button class="btn-ghost" onclick="APP.closeModal('pdf-import-modal')">Cancelar</button>
        <button class="btn-primary" onclick="APP.confirmPDFImport(${JSON.stringify(products).replace(/"/g,'&quot;')},'${catId}')">
          ✅ Importar seleccionados
        </button>
      </div>`;
  },

  confirmPDFImport(products, catId) {
    const checks = document.querySelectorAll('.pdf-check');
    const selected = products.filter((_, i) =>
      checks[i] && checks[i].checked
    );

    if (!selected.length) {
      this.showToast('Seleccioná al menos un producto.', 'warn');
      return;
    }

    let added = 0, updated = 0;
    const existing = DB.getCatalog(catId);

    for (const prod of selected) {
      const ex = existing.find(p => p.sku && p.sku === prod.sku);
      if (ex) {
        DB.updateProduct(catId, ex.id, prod);
        updated++;
      } else {
        DB.addProduct(catId, prod);
        added++;
      }
    }

    this.closeModal('pdf-import-modal');
    this.showToast(`PDF importado: ${added} nuevos, ${updated} actualizados.`, 'success');
    this.renderCatalog();
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILS
  // ═══════════════════════════════════════════════════════════════════════════
  closeModal(id) {
    document.getElementById(id)?.remove();
  },

  showToast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    document.getElementById('toast-area').appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MÓDULO COTIZACIONES
  // Lee CentralCotizaciones del Sheet, extrae cotizaciones 1-5 por SKU,
  // analiza cada una con IA contra el link de referencia y genera un ranking.
  // ═══════════════════════════════════════════════════════════════════════════

  renderCotizaciones() {
    const s = DB.getSettings();
    const sheetId = s.sheetId || CONFIG.sheetId;

    document.getElementById('sec-cotizaciones').innerHTML = `
      <div class="sec-head">
        <h2>🔍 Comparador de Cotizaciones</h2>
        <div style="display:flex;gap:8px">
          <button class="btn-ghost" onclick="APP.cotLoad()">↓ Cargar desde Sheet</button>
        </div>
      </div>

      <div class="cot-layout">

        <!-- LEFT: search + list -->
        <div class="cot-sidebar">
          <div class="form-group" style="margin-bottom:12px">
            <label style="font-size:11px;font-weight:700;text-transform:uppercase;
                          letter-spacing:.04em;color:var(--text-muted)">Buscar SKU</label>
            <input type="text" id="cot-search" placeholder="Escribí el SKU o descripción…"
              oninput="APP.cotFilter(this.value)"
              style="width:100%;margin-top:6px">
          </div>
          <div id="cot-sku-list" class="cot-sku-list">
            <div class="cot-empty">Cargá el Sheet para ver los SKUs disponibles.</div>
          </div>
        </div>

        <!-- RIGHT: analysis panel -->
        <div class="cot-main" id="cot-main">
          <div class="cot-placeholder">
            <div style="font-size:48px;margin-bottom:16px">🔍</div>
            <h3 style="color:var(--text-muted);font-weight:500">
              Seleccioná un SKU para analizar sus cotizaciones
            </h3>
            <p style="color:var(--text-dim);font-size:12px;margin-top:8px">
              La IA va a leer cada cotización y la va a comparar contra el link de referencia
            </p>
          </div>
        </div>

      </div>`;

    // Auto-load if we already have rows cached
    if (this.state.cotRows && this.state.cotRows.length) {
      this._cotRenderList(this.state.cotRows);
    }
  },

  // ── Load CentralCotizaciones via Apps Script (works with private Sheets) ───
  async cotLoad() {
    this.showToast('Cargando CentralCotizaciones…', 'info');

    const listEl = document.getElementById('cot-sku-list');
    if (listEl) listEl.innerHTML = '<div class="cot-empty" style="text-align:center">⏳ Cargando…</div>';

    try {
      // Use Apps Script readExternal action — bypasses gviz auth restriction
      const data = await DB._get({
        action:  'readExternal',
        sheetId: '1ByagWe7qIzHE_-bCXzg9cMNxZdkg-Sqokd1oZkONx0I',
        sheet:   'CentralCotizaciones'
      });

      if (data.error) throw new Error(data.error);
      const rows = data.rows || [];
      if (!rows.length) throw new Error('No se encontraron filas en CentralCotizaciones.');

      // Filter rows that have at least one cotización URL
      const valid = rows.filter(r =>
        r['SKU'] &&
        (r['Cotización 1'] || r['Cotización 2'] || r['Cotización 3'] ||
         r['Cotización 4'] || r['Cotización 5'])
      );

      if (!valid.length) throw new Error('No hay filas con cotizaciones en el Sheet.');

      this.state.cotRows = valid;
      this.state.cotFiltered = valid;
      this._cotRenderList(valid);
      this.showToast(`${valid.length} SKUs con cotizaciones cargados.`, 'success');
    } catch(e) {
      this.showToast('Error: ' + e.message, 'error');
      if (listEl) listEl.innerHTML = '<div class="cot-empty" style="color:var(--danger)">⚠ ' + e.message + '</div>';
    }
  },

  // ── Render SKU list in sidebar ────────────────────────────────────────────
  _cotRenderList(rows) {
    const listEl = document.getElementById('cot-sku-list');
    if (!listEl) return;

    if (!rows.length) {
      listEl.innerHTML = '<div class="cot-empty">Sin resultados.</div>';
      return;
    }

    listEl.innerHTML = rows.map((r, i) => {
      const sku   = r['SKU'] || '–';
      const desc  = r['Descripción'] || '';
      const cat   = r['Category'] || '';
      const nCot  = [1,2,3,4,5].filter(n => r[`Cotización ${n}`]).length;
      const prio  = r['Prioridad'] || '';
      const prioClass = prio === 'Alta' ? 'prio-alta' : prio === 'Media' ? 'prio-media' : 'prio-baja';
      return `<div class="cot-sku-item" data-i="${i}" onclick="APP.cotSelectSKU(${i})">
        <div class="cot-sku-top">
          <span class="sku-text">${sku}</span>
          ${prio ? `<span class="cot-prio ${prioClass}">${prio}</span>` : ''}
        </div>
        <div class="cot-sku-desc">${desc.substring(0,60)}${desc.length>60?'…':''}</div>
        <div class="cot-sku-meta">${cat ? cat + ' · ' : ''}${nCot} cotización${nCot!==1?'es':''}</div>
      </div>`;
    }).join('');
  },

  // ── Filter SKU list ───────────────────────────────────────────────────────
  cotFilter(query) {
    const rows = this.state.cotRows || [];
    const q    = query.toLowerCase();
    const filtered = q
      ? rows.filter(r =>
          (r['SKU']||'').toLowerCase().includes(q) ||
          (r['Descripción']||'').toLowerCase().includes(q) ||
          (r['Category']||'').toLowerCase().includes(q))
      : rows;
    this._cotRenderList(filtered);
    // Store filtered indices mapping
    this.state.cotFiltered = filtered;
  },

  // ── Select a SKU and show analysis panel ─────────────────────────────────
  cotSelectSKU(i) {
    const rows = this.state.cotFiltered || this.state.cotRows || [];
    const row  = rows[i];
    if (!row) return;

    // Highlight selected
    document.querySelectorAll('.cot-sku-item').forEach((el, idx) => {
      el.classList.toggle('active', idx === i);
    });

    this.state.cotSelected = row;
    this._cotRenderPanel(row);
  },

  // ── Render the right-side analysis panel for a SKU ───────────────────────
  _cotRenderPanel(row) {
    const mainEl = document.getElementById('cot-main');
    if (!mainEl) return;

    const sku      = row['SKU'] || '–';
    const desc     = row['Descripción'] || '';
    const linkRef  = row['Link de Referencia'] || '';
    const target   = row['Target price'] || '';
    const qty      = row['Cantidad estimada'] || '';
    const obs      = row['Observaciones'] || '';
    const analista = row['Analista Sourcing'] || '';

    // Build cotizaciones array (only non-empty ones)
    const cots = [1,2,3,4,5]
      .map(n => ({
        n,
        url:       row[`Cotización ${n}`] || '',
        fob:       row[`FOB ${n}`] || row[`FOB TPO ${n === 4 ? '1 SIMPLE' : n === 5 ? '2 KRIS' : n}`] || '',
        proveedor: row[`Proveedor ${n}`] || `Cotización ${n}`,
        modelo:    row[`Modelo ${n}`] || '',
      }))
      .filter(c => c.url && c.url.startsWith('http') && !['sin respuesta','sin cotización','n/a','na','-',''].includes(c.url.trim().toLowerCase()));

    mainEl.innerHTML = `
      <div class="cot-panel">

        <!-- SKU Header -->
        <div class="cot-panel-head">
          <div>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
              <span class="sku-text" style="font-size:14px">${sku}</span>
              ${analista ? `<span style="font-size:11px;color:var(--text-muted)">Sourcing: ${analista}</span>` : ''}
            </div>
            <h3 style="font-size:16px;font-weight:700;color:var(--text)">${desc}</h3>
          </div>
          <div class="cot-panel-meta">
            ${target ? `<div class="cot-meta-pill">🎯 Target: <strong>${target}</strong></div>` : ''}
            ${qty    ? `<div class="cot-meta-pill">📦 Qty est.: <strong>${qty}</strong></div>` : ''}
            ${cots.length ? `<div class="cot-meta-pill">📋 <strong>${cots.length}</strong> cotizaciones</div>` : ''}
          </div>
        </div>

        <!-- Reference link -->
        ${linkRef ? `
        <div class="cot-ref-box">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;
                      letter-spacing:.04em;color:var(--text-muted);margin-bottom:4px">
            🔗 Link de Referencia
          </div>
          <a href="${linkRef}" target="_blank" class="cot-ref-link">${linkRef}</a>
        </div>` : '<div class="cot-ref-box" style="border-color:var(--warn)">⚠ Sin link de referencia en el Sheet.</div>'}

        <!-- Observations -->
        ${obs ? `<div class="cot-obs-box">📝 ${obs}</div>` : ''}

        <!-- Scoring weights -->
        <div class="cot-weights-box">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;
                      letter-spacing:.04em;color:var(--text-muted);margin-bottom:12px">
            ⚖️ Ponderación del scoring
          </div>
          <div class="cot-weights-grid">
            <div class="cot-weight-item">
              <label>💰 Precio FOB</label>
              <input type="range" id="w-precio" min="0" max="100" value="35"
                oninput="document.getElementById('w-precio-val').textContent=this.value+'%'">
              <span id="w-precio-val">35%</span>
            </div>
            <div class="cot-weight-item">
              <label>🔬 Match técnico</label>
              <input type="range" id="w-specs" min="0" max="100" value="40"
                oninput="document.getElementById('w-specs-val').textContent=this.value+'%'">
              <span id="w-specs-val">40%</span>
            </div>
            <div class="cot-weight-item">
              <label>📦 MOQ</label>
              <input type="range" id="w-moq" min="0" max="100" value="15"
                oninput="document.getElementById('w-moq-val').textContent=this.value+'%'">
              <span id="w-moq-val">15%</span>
            </div>
            <div class="cot-weight-item">
              <label>⚡ Lead time</label>
              <input type="range" id="w-lead" min="0" max="100" value="10"
                oninput="document.getElementById('w-lead-val').textContent=this.value+'%'">
              <span id="w-lead-val">10%</span>
            </div>
          </div>
        </div>

        <!-- Cotizaciones list -->
        <div style="margin-bottom:14px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;
                      letter-spacing:.04em;color:var(--text-muted);margin-bottom:10px">
            📋 Cotizaciones encontradas (${cots.length})
          </div>
          ${cots.map(c => `
            <div class="cot-item-row">
              <div class="cot-item-info">
                <span class="sku-text" style="font-size:11px">Cot. ${c.n}</span>
                <span style="font-size:12px;font-weight:600">${c.proveedor}</span>
                ${c.modelo ? `<span style="font-size:11px;color:var(--text-muted)">${c.modelo}</span>` : ''}
                ${c.fob    ? `<span class="cot-fob-badge">FOB ${c.fob}</span>` : ''}
              </div>
              <a href="${c.url}" target="_blank" class="btn-ghost"
                style="font-size:11px;padding:4px 10px">↗ Ver archivo</a>
            </div>`).join('')}
        </div>

        <!-- Action button -->
        <button class="btn-primary" style="width:100%;padding:12px;font-size:14px"
          onclick="APP.cotRunAnalysis()">
          ✨ Analizar y comparar con IA
        </button>

        <!-- Results area -->
        <div id="cot-results" style="margin-top:20px"></div>

      </div>`;
  },

  // ── Run full AI analysis on all cotizaciones ──────────────────────────────
  async cotRunAnalysis() {
    const row = this.state.cotSelected;
    if (!row) return;

    const resultsEl = document.getElementById('cot-results');
    if (!resultsEl) return;

    // Read weights
    const wPrecio = parseInt(document.getElementById('w-precio')?.value || 35);
    const wSpecs  = parseInt(document.getElementById('w-specs')?.value  || 40);
    const wMoq    = parseInt(document.getElementById('w-moq')?.value    || 15);
    const wLead   = parseInt(document.getElementById('w-lead')?.value   || 10);
    const totalW  = wPrecio + wSpecs + wMoq + wLead || 1;

    const linkRef  = row['Link de Referencia'] || '';
    const target   = parseFloat(String(row['Target price'] || '0').replace(/[^0-9.]/g,'')) || 0;
    const desc     = row['Descripción'] || row['SKU'] || '';
    const cots     = [1,2,3,4,5]
      .map(n => ({
        n,
        url:       row[`Cotización ${n}`] || '',
        fob:       row[`FOB ${n}`] || row[`FOB TPO ${n===4?'1 SIMPLE':n===5?'2 KRIS':n}`] || '',
        proveedor: row[`Proveedor ${n}`] || `Cotización ${n}`,
        modelo:    row[`Modelo ${n}`] || '',
      }))
      .filter(c => c.url && c.url.startsWith('http') && !['sin respuesta','sin cotización','n/a','na','-',''].includes(c.url.trim().toLowerCase()));

    // Progress tracker
    const steps  = 2 + cots.length + 3; // ref + per-cot + normalize + category + benchmark
    let   stepN  = 0;
    const setStatus = (msg, pct) => {
      stepN++;
      const p = pct ?? Math.round(stepN / steps * 100);
      resultsEl.innerHTML = `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:24px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
            <span style="font-size:22px;animation:spin-slow 1.2s linear infinite;display:inline-block">⏳</span>
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--text)">${msg}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Paso ${stepN} de ${steps}</div>
            </div>
          </div>
          <div style="background:var(--surface2);border-radius:4px;height:6px;overflow:hidden">
            <div style="height:100%;width:${p}%;background:var(--accent);border-radius:4px;transition:width .4s"></div>
          </div>
        </div>`;
    };

    try {
      // ── FASE 1: Referencia externa ─────────────────────────────────────
      setStatus('Analizando producto de referencia…');
      const refSpecs = linkRef
        ? await GEMINI.extractRefSpecs(linkRef)
        : { nombre: desc, specs: '', specs_obj: {} };

      // ── FASE 2: Extracción por cotización (logística + técnica) ────────
      const rawCots = [];
      for (const c of cots) {
        setStatus(`Extrayendo datos de cotización ${c.n}/${cots.length} — ${c.proveedor}…`);
        try {
          // Get file text via Apps Script
          let fileText = '';
          const isDrive = c.url && (
            c.url.includes('drive.google.com') ||
            c.url.includes('docs.google.com')
          );
          if (isDrive) {
            const extracted = await DB._get({ action: 'extractFile', fileUrl: c.url });
            if (extracted.ok) fileText = extracted.text || '';
          }
          if (!fileText) {
            try {
              const jina = await fetch(`https://r.jina.ai/${c.url}`, {
                headers: { 'Accept': 'application/json', 'X-Return-Format': 'markdown' }
              });
              if (jina.ok) fileText = (await jina.text()).substring(0, 8000);
            } catch(e) {}
          }

          // Extract logistics (7 fixed fields)
          const logistics = await GEMINI.extractLogistics(fileText, c.fob, desc);

          // Extract tech specs
          const techSpecs = await GEMINI.extractTechSpecs(fileText, desc, refSpecs);

          rawCots.push({
            ...c,
            fileText,
            logistics,
            techSpecs,
            ok: true
          });
        } catch(e) {
          rawCots.push({ ...c, ok: false, error: e.message,
            logistics: { fob_num: parseFloat(String(c.fob||'0').replace(/[^0-9.]/g,''))||0 },
            techSpecs: {} });
        }
      }

      // ── FASE 3: Normalización de specs ─────────────────────────────────
      setStatus('Normalizando especificaciones técnicas…');
      const allTechSpecs = rawCots.filter(c => c.ok).map(c => c.techSpecs);
      const { normalizedSpecs, specsTable } = await GEMINI.normalizeSpecs(allTechSpecs, rawCots.filter(c=>c.ok).length);

      // Apply normalized specs back
      rawCots.forEach((c, i) => {
        if (c.ok) c.techNorm = normalizedSpecs[i] || {};
      });

      // ── FASE 4: Detección de categoría ─────────────────────────────────
      setStatus('Detectando categoría del producto…');
      const allCats   = CONFIG.getAllCats();
      const catDetect = await GEMINI.detectCategory(desc, specsTable, allCats);
      this.state.cotPendingCategory = catDetect;
      this.state.cotPendingData     = { rawCots, refSpecs, specsTable, row, target, wPrecio, wSpecs, wMoq, wLead, totalW };

      // ── FASE 5: Category widget (blocks until user responds) ───────────
      this._cotShowCategoryWidget(catDetect, specsTable, allCats, async (confirmedCatId) => {
        // Resume after user confirms category
        setStatus('Generando benchmark completo…');
        const benchmark = await GEMINI.benchmarkAnalysis(
          rawCots.filter(c => c.ok), refSpecs, specsTable, desc, confirmedCatId
        );
        const scored = this._cotScoreV2(rawCots, target, wPrecio, wSpecs, wMoq, wLead, totalW);
        this._cotRenderResultsV2(scored, refSpecs, specsTable, benchmark, row);
      });

    } catch(e) {
      resultsEl.innerHTML = `<div class="gen-status error">⚠ ${e.message}</div>`;
      console.error(e);
    }
  },

  // ── Category detection widget ─────────────────────────────────────────────
  _cotShowCategoryWidget(catDetect, specsTable, allCats, onConfirm) {
    const resultsEl = document.getElementById('cot-results');
    if (!resultsEl) return;

    const existing    = catDetect.existing_cat_id ? allCats[catDetect.existing_cat_id] : null;
    const isNew       = !existing;
    const suggestedId = catDetect.existing_cat_id || catDetect.suggested_id || 'nueva';

    // Build specs fields for new category (pre-filled from detected specs)
    const detectedFields = (catDetect.suggested_campos || specsTable.slice(0,12)).map(f => {
      if (typeof f === 'string') return { label: f, tipo: 'texto', unidad: '', req: false };
      return { label: f.label||f, tipo: f.tipo||'texto', unidad: f.unidad||'', req: f.req||false };
    });

    const fieldsHTML = detectedFields.map((f,i) => `
      <div class="campo-row" id="cat-w-field-${i}">
        <input type="text" class="campo-label" value="${f.label}" placeholder="Nombre">
        <input type="text" class="campo-unidad" value="${f.unidad||''}" placeholder="Pa, W, °C…">
        <select class="campo-tipo">
          <option value="texto"   ${f.tipo==='texto'   ?'selected':''}>Texto</option>
          <option value="numero"  ${f.tipo==='numero'  ?'selected':''}>Número</option>
          <option value="booleano"${f.tipo==='booleano'?'selected':''}>Sí/No</option>
        </select>
        <label class="campo-req-wrap">
          <input type="checkbox" class="campo-req" ${f.req?'checked':''}>
          <span>Req.</span>
        </label>
        <button class="btn-icon btn-del" onclick="this.closest('.campo-row').remove()">✕</button>
      </div>`).join('');

    resultsEl.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--accent);border-radius:12px;padding:24px">

        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <span style="font-size:20px">🏷</span>
          <div>
            <div style="font-size:14px;font-weight:700;color:var(--text)">
              ${isNew ? 'Categoría nueva detectada' : 'Categoría sugerida'}
            </div>
            <div style="font-size:11px;color:var(--text-muted)">
              La IA identificó este producto como:
              <strong style="color:var(--accent)">${catDetect.suggested_name || 'Categoría desconocida'}</strong>
            </div>
          </div>
        </div>

        ${catDetect.reasoning ? `
        <div style="font-size:12px;color:var(--text-muted);background:var(--surface2);
                    border-radius:6px;padding:8px 12px;margin-bottom:16px;line-height:1.5">
          ${catDetect.reasoning}
        </div>` : ''}

        ${existing ? `
        <!-- Existing category match -->
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;
                    padding:12px 16px;margin-bottom:16px">
          <div style="font-size:12px;font-weight:700;color:#059669;margin-bottom:4px">
            ✔ Coincide con categoría existente
          </div>
          <div style="font-size:13px;font-weight:600">
            ${existing.emoji||'📦'} ${existing.nombre}
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
            ${existing.campos?.length||0} campos definidos
          </div>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn-ghost" onclick="APP._cotCategorySkip()">Omitir y continuar</button>
          <button class="btn-primary" onclick="APP._cotCategoryConfirm('${existing.id}')">
            ✔ Usar "${existing.nombre}"
          </button>
        </div>
        ` : `
        <!-- New category -->
        <div style="margin-bottom:14px">
          <div style="display:grid;grid-template-columns:1fr auto;gap:10px;margin-bottom:12px">
            <div class="form-group" style="margin:0">
              <label style="font-size:11px;font-weight:700;color:var(--text-muted);
                            text-transform:uppercase;letter-spacing:.04em">Nombre</label>
              <input type="text" id="cat-w-nombre" value="${catDetect.suggested_name||''}"
                     style="margin-top:4px">
            </div>
            <div class="form-group" style="margin:0">
              <label style="font-size:11px;font-weight:700;color:var(--text-muted);
                            text-transform:uppercase;letter-spacing:.04em">Emoji</label>
              <input type="text" id="cat-w-emoji" value="${catDetect.suggested_emoji||'📦'}"
                     maxlength="2" style="margin-top:4px;width:60px">
            </div>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;
                        letter-spacing:.04em;color:var(--text-muted)">
              Specs detectadas (${detectedFields.length})
            </div>
            <button class="btn-ghost" style="font-size:11px;padding:4px 10px"
              onclick="APP._cotAddCampoWidget()">+ Agregar campo</button>
          </div>
          <div class="campos-header">
            <span>Nombre</span><span>Unidad</span><span>Tipo</span><span>Req.</span><span></span>
          </div>
          <div id="cat-w-campos" style="max-height:240px;overflow-y:auto">
            ${fieldsHTML}
          </div>
        </div>

        <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:12px;
                    border-top:1px solid var(--border)">
          <button class="btn-ghost" onclick="APP._cotCategorySkip()">Omitir</button>
          <button class="btn-primary" onclick="APP._cotCategorySaveNew()">
            💾 Crear categoría y continuar
          </button>
        </div>
        `}
      </div>`;

    // Store callback for after user responds
    this.state._cotCategoryCallback = onConfirm;
  },

  _cotAddCampoWidget() {
    const list = document.getElementById('cat-w-campos');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'campo-row';
    row.innerHTML =
      '<input type="text" class="campo-label" placeholder="Nombre del campo">' +
      '<input type="text" class="campo-unidad" placeholder="W, kg, cm…">' +
      '<select class="campo-tipo">' +
      '<option value="texto">Texto</option>' +
      '<option value="numero">Número</option>' +
      '<option value="booleano">Sí/No</option>' +
      '</select>' +
      '<label class="campo-req-wrap"><input type="checkbox" class="campo-req"><span>Req.</span></label>' +
      '<button class="btn-icon btn-del" onclick="this.closest(\'.campo-row\').remove()">✕</button>';
    list.appendChild(row);
    row.querySelector('.campo-label').focus();
  },

  _cotCategorySkip() {
    const cb = this.state._cotCategoryCallback;
    if (cb) cb(null);
  },

  _cotCategoryConfirm(catId) {
    const cb = this.state._cotCategoryCallback;
    if (cb) cb(catId);
  },

  async _cotCategorySaveNew() {
    const nombre = document.getElementById('cat-w-nombre')?.value.trim();
    const emoji  = document.getElementById('cat-w-emoji')?.value.trim() || '📦';
    if (!nombre) { this.showToast('El nombre es obligatorio.', 'error'); return; }

    const campos = [];
    document.querySelectorAll('#cat-w-campos .campo-row').forEach(row => {
      const label = row.querySelector('.campo-label')?.value.trim();
      if (!label) return;
      const unidad = row.querySelector('.campo-unidad')?.value.trim() || '';
      const tipo   = row.querySelector('.campo-tipo')?.value || 'texto';
      const req    = row.querySelector('.campo-req')?.checked || false;
      const id     = label.toLowerCase().replace(/[^a-z0-9]/g,'_').replace(/__+/g,'_') +
                     (unidad && unidad !== 'SN' ? '_' + unidad.toLowerCase() : '');
      campos.push({ id, label, unidad: unidad||undefined, tipo, req });
    });

    const id        = nombre.toLowerCase().replace(/[^a-z0-9]/g,'_').replace(/__+/g,'_');
    const sheetName = 'Catalogo_' + nombre.replace(/\s+/g,'');
    const cat       = { id, nombre, emoji, sheetName, niveles: ['Entry','Mid','High','Premium'], campos };

    CONFIG.addCustomCat(cat);
    DB.createCategorySheet(cat).catch(()=>{});
    DB.pushCategories().catch(()=>{});

    this.showToast(`Categoría "${nombre}" creada.`, 'success');
    const cb = this.state._cotCategoryCallback;
    if (cb) cb(id);
  },

  // ── Score V2 — penaliza N/D, no premia la ausencia de datos ─────────────
  _cotScoreV2(rawCots, target, wPrecio, wSpecs, wMoq, wLead, totalW) {
    // Normalize: missing values (0/null) get 0 score, not 0.5
    const normalize = (vals, invert = false) => {
      const withData = vals.filter(v => v > 0);
      if (!withData.length) return vals.map(() => 0);
      const mn = Math.min(...withData);
      const mx = Math.max(...withData);
      return vals.map(v => {
        if (!v || v <= 0) return 0;  // no data = no score
        const n = mx !== mn ? (v - mn) / (mx - mn) : 1;
        return invert ? 1 - n : n;
      });
    };

    const fobs  = rawCots.map(c => c.logistics?.fob_num || parseFloat(String(c.fob||'').replace(/[^0-9.]/g,''))||0);
    const moqs  = rawCots.map(c => c.logistics?.moq  || 0);
    const leads = rawCots.map(c => c.logistics?.lead_time || 0);

    // Tech score: count non-null tech specs as proxy
    const techs = rawCots.map(c => {
      const specs = c.techNorm || c.techSpecs || {};
      const total = Object.values(specs).filter(v => v && v !== 'null').length;
      return Math.min(total / 8, 1); // normalize: 8+ specs = 100%
    });

    const nFob  = normalize(fobs,  true);   // lower FOB = better
    const nMoq  = normalize(moqs,  true);   // lower MOQ = better
    const nLead = normalize(leads, true);   // lower lead = better
    const nTech = techs;                    // more specs = better

    return rawCots.map((c, i) => {
      // Data completeness bonus: penalize providers with no logistics data
      const hasData = (fobs[i] > 0 ? 1 : 0) + (moqs[i] > 0 ? 1 : 0) +
                      (leads[i] > 0 ? 1 : 0) + (techs[i] > 0 ? 1 : 0);
      const completeness = hasData / 4;

      const rawScore = (nFob[i]*wPrecio + nTech[i]*wSpecs + nMoq[i]*wMoq + nLead[i]*wLead) / totalW;
      const score    = rawScore * (0.5 + 0.5 * completeness); // penalize incomplete data

      return {
        ...c,
        fob_num:        fobs[i],
        score:          Math.round(score * 1000) / 10,
        n_fob:          Math.round(nFob[i]*100),
        n_tech:         Math.round(nTech[i]*100),
        n_moq:          Math.round(nMoq[i]*100),
        n_lead:         Math.round(nLead[i]*100),
        data_complete:  Math.round(completeness * 100),
      };
    }).sort((a,b) => b.score - a.score);
  },

  // ── Render V2 — full benchmark with logistics + specs table + narrative ────
  _cotRenderResultsV2(scored, refSpecs, specsTable, benchmark, row) {
    const resultsEl = document.getElementById('cot-results');
    if (!resultsEl) return;

    const winner = scored[0];
    const sku    = row['SKU'] || '–';

    const sc = s => s >= 70 ? '#059669' : s >= 45 ? '#d97706' : '#dc2626';
    const nd = '<span style="color:var(--text-dim);font-size:11px">N/D</span>';

    // ── Winner card ─────────────────────────────────────────────────────────
    const winnerCard = `
      <div class="cot-winner-card" style="margin-bottom:20px">
        <div class="cot-winner-label">🏆 MEJOR COTIZACIÓN — SKU ${sku}</div>
        <div class="cot-winner-name">${winner.proveedor}${winner.logistics?.modelo?' — '+winner.logistics.modelo:''}</div>
        <div class="cot-winner-meta">
          ${winner.fob_num?`<span>💰 FOB <strong>USD ${winner.fob_num}</strong></span>`:''}
          ${winner.logistics?.puerto?`<span>🚢 <strong>${winner.logistics.puerto}</strong></span>`:''}
          ${winner.logistics?.moq?`<span>📦 MOQ <strong>${winner.logistics.moq} uds.</strong></span>`:''}
          ${winner.logistics?.lead_time?`<span>⚡ Lead <strong>${winner.logistics.lead_time} días</strong></span>`:''}
          ${winner.logistics?.payment_terms?`<span>💳 <strong>${winner.logistics.payment_terms}</strong></span>`:''}
        </div>
        <div class="cot-winner-score">${winner.score}% score final</div>
        ${benchmark?.resumen_ejecutivo?`<div class="cot-winner-summary">${benchmark.resumen_ejecutivo}</div>`:''}
      </div>`;

    // ── Logistics comparison table ──────────────────────────────────────────
    const logFields = [
      { key: 'fob_display', label: '💰 FOB USD + Puerto' },
      { key: 'ctn_size',    label: '📦 CTN Size L×W×H (cm)' },
      { key: 'ctn_weight',  label: '⚖ CTN Weight (kg)' },
      { key: 'pcs_ctn',     label: '🔢 PCS/CTN' },
      { key: 'lead_time',   label: '⚡ Lead Time' },
      { key: 'payment_terms',label: '💳 Payment Terms' },
      { key: 'modelo',      label: '🏷 Model / SKU' },
    ];

    const logHeader = `<tr><th>Campo logístico</th>${scored.map(c=>`<th style="text-align:center">${c.proveedor}</th>`).join('')}</tr>`;
    const logRows   = logFields.map(f => {
      const cells = scored.map(c => {
        const l = c.logistics || {};
        let val = '';
        if (f.key === 'fob_display') val = l.fob_num ? `USD ${l.fob_num}${l.puerto?' · '+l.puerto:''}` : '';
        else if (f.key === 'lead_time') val = l.lead_time ? l.lead_time + ' días' : '';
        else val = l[f.key] || '';
        return `<td style="text-align:center;font-size:12px">${val || nd}</td>`;
      }).join('');
      return `<tr><td style="font-size:12px;font-weight:600;white-space:nowrap">${f.label}</td>${cells}</tr>`;
    }).join('');

    const logTable = `
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;
                  color:var(--text-muted);margin:20px 0 10px">📋 Datos logísticos</div>
      <div class="table-scroll">
        <table class="data-table" style="font-size:12px">
          <thead>${logHeader}</thead>
          <tbody>${logRows}</tbody>
        </table>
      </div>`;

    // ── Tech specs comparison table ─────────────────────────────────────────
    let techTable = '';
    if (specsTable && specsTable.length) {
      const specHeader = `<tr><th>Especificación técnica</th>${scored.map(c=>`<th style="text-align:center">${c.proveedor}</th>`).join('')}</tr>`;
      const specRows   = specsTable.map(spec => {
        const cells = scored.map(c => {
          const val = c.techNorm?.[spec] || c.techSpecs?.[spec] || '';
          return `<td style="text-align:center;font-size:12px">${val || nd}</td>`;
        }).join('');
        return `<tr><td style="font-size:12px;font-weight:600">${spec}</td>${cells}</tr>`;
      }).join('');

      techTable = `
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;
                    color:var(--text-muted);margin:20px 0 10px">🔬 Benchmark técnico</div>
        <div class="table-scroll">
          <table class="data-table" style="font-size:12px">
            <thead>${specHeader}</thead>
            <tbody>${specRows}</tbody>
          </table>
        </div>`;
    }

    // ── Score ranking ───────────────────────────────────────────────────────
    const scoreRows = scored.map((c,i) => `
      <tr class="${i===0?'cot-row-winner':''}">
        <td style="text-align:center;font-size:16px;font-weight:800">
          ${i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1)}
        </td>
        <td>
          <div style="font-weight:600">${c.proveedor}</div>
          ${c.logistics?.modelo?`<div style="font-size:11px;color:var(--text-muted)">${c.logistics.modelo}</div>`:''}
        </td>
        <td style="text-align:center;font-weight:700">${c.fob_num?'USD '+c.fob_num:nd}</td>
        <td style="text-align:center">${c.logistics?.moq||nd}</td>
        <td style="text-align:center">${c.logistics?.lead_time?c.logistics.lead_time+' días':nd}</td>
        <td style="text-align:center;font-size:17px;font-weight:800;color:${sc(c.score)}">${c.score}%</td>
      </tr>`).join('');

    const scoreTable = `
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;
                  color:var(--text-muted);margin:20px 0 10px">📊 Ranking final</div>
      <div class="table-scroll">
        <table class="data-table" style="font-size:12px">
          <thead>
            <tr>
              <th style="text-align:center">#</th>
              <th>Proveedor</th>
              <th style="text-align:center">FOB USD</th>
              <th style="text-align:center">MOQ</th>
              <th style="text-align:center">Lead time</th>
              <th style="text-align:center">Score final</th>
            </tr>
          </thead>
          <tbody>${scoreRows}</tbody>
        </table>
      </div>`;

    // ── Narrative benchmark ─────────────────────────────────────────────────
    let narrative = '';
    if (benchmark) {
      const ventajasHTML = (benchmark.ventajas_por_proveedor||[]).map(v => `
        <div style="margin-bottom:10px">
          <div style="font-size:12px;font-weight:700;color:var(--text)">${v.proveedor}</div>
          <div style="font-size:12px;color:#059669;margin-top:2px">${(v.ventajas||[]).map(x=>'✅ '+x).join(' · ')}</div>
          ${v.gaps?.length?`<div style="font-size:12px;color:#dc2626;margin-top:2px">${v.gaps.map(x=>'⚠ '+x).join(' · ')}</div>`:''}
        </div>`).join('');

      const recsHTML = (benchmark.recomendaciones||[]).map(r => `
        <div style="display:flex;gap:8px;margin-bottom:8px;align-items:flex-start">
          <span style="font-size:14px;flex-shrink:0">💡</span>
          <div style="font-size:12px;line-height:1.5"><strong>${r.titulo}:</strong> ${r.descripcion}</div>
        </div>`).join('');

      const modoB = (benchmark.ranking_entre_cotizaciones||[]).map((r,i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;
                    border-bottom:1px solid var(--border);font-size:12px">
          <span style="font-weight:800;font-size:14px">${i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1)}</span>
          <div style="flex:1"><strong>${r.proveedor}</strong> — ${r.razon}</div>
        </div>`).join('');

      narrative = `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;
                    padding:20px;margin-top:20px">
          <div style="font-size:13px;font-weight:700;margin-bottom:16px">📝 Análisis narrativo</div>

          ${ventajasHTML ? `
          <div style="margin-bottom:16px">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;
                        color:var(--text-muted);margin-bottom:10px">Ventajas y gaps por proveedor</div>
            ${ventajasHTML}
          </div>` : ''}

          ${recsHTML ? `
          <div style="margin-bottom:16px">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;
                        color:var(--text-muted);margin-bottom:10px">Recomendaciones</div>
            ${recsHTML}
          </div>` : ''}

          ${modoB ? `
          <div>
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;
                        color:var(--text-muted);margin-bottom:10px">🔀 Ranking entre cotizaciones</div>
            ${modoB}
          </div>` : ''}
        </div>`;
    }

    // ── Ref specs box ───────────────────────────────────────────────────────
    const refBox = refSpecs?.specs_obj && Object.keys(refSpecs.specs_obj).length ? `
      <div class="cot-ref-specs" style="margin-bottom:0">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;
                    color:var(--text-muted);margin-bottom:8px">🔗 Producto de referencia</div>
        <div style="font-size:12px;line-height:1.7">
          ${Object.entries(refSpecs.specs_obj).map(([k,v])=>`<span style="margin-right:16px"><strong>${k}:</strong> ${v}</span>`).join('')}
        </div>
      </div>` : '';

    resultsEl.innerHTML =
      winnerCard + refBox + logTable + techTable + scoreTable + narrative +
      `<div style="margin-top:20px;display:flex;gap:10px">
        <button class="btn-primary" onclick="APP.cotExport()">⬇ Exportar HTML</button>
        <button class="btn-ghost"   onclick="APP.cotCopyToComp()">➕ Crear comparativa</button>
      </div>`;

    this.state.cotLastResult = { scored, refSpecs, specsTable, benchmark, row };
  },


  // ── Export results as standalone HTML ────────────────────────────────────
  cotExport() {
    const { scored, refSpecs, row } = this.state.cotLastResult || {};
    if (!scored) return;

    const sku  = row['SKU'] || 'cotizacion';
    const html = EXPORT.generateCotizacion(scored, refSpecs, row);
    EXPORT.downloadHTML(html, `cotizacion_${sku}_${new Date().toISOString().slice(0,10)}.html`);
    this.showToast('HTML exportado.', 'success');
  },

  // ── Send winner + all cotizaciones to the comparison wizard ──────────────
  cotCopyToComp() {
    const { scored, row } = this.state.cotLastResult || {};
    if (!scored) return;

    // Map to wizard externos format
    const externos = scored.map(c => ({
      nombre:    c.proveedor,
      sku:       c.modelo || '',
      fob_usd:   c.fob_num || '',
      fuente:    c.url,
      ...c.specs_obj,
    }));

    this.state.wizard = {
      step: 1, catId: null, tipo: 'vs_cotizacion',
      propios: [], externos, analisis: null,
      nombre: `Cotizaciones ${row['SKU']}`, formato: 'tarjetas'
    };
    this.go('nueva');
    this.showToast('Cotizaciones cargadas en el wizard.', 'success');
  },

};

document.addEventListener('DOMContentLoaded', () => APP.init());
