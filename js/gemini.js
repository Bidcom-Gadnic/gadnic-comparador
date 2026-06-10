// ─── GADNIC COMPARADOR · AI (Groq) ────────────────────────────────────────────
const GEMINI = {
  MODEL: 'llama-3.3-70b-versatile',
  ENDPOINT: 'https://api.groq.com/openai/v1/chat/completions',

  async _fetchURL(url) {
    // Jina AI Reader — convierte cualquier URL en texto + imágenes, gratis
    const jinaUrl = `https://r.jina.ai/${url}`;
    try {
      const res = await fetch(jinaUrl, {
        headers: { 'Accept': 'application/json', 'X-Return-Format': 'markdown' }
      });
      if (!res.ok) throw new Error(`Jina error ${res.status}`);
      const text = await res.text();
      return text.substring(0, 8000); // limit context
    } catch(e) {
      console.warn('Jina fetch failed, using URL only:', e.message);
      return null;
    }
  },

  async _call(prompt) {
    const { geminiKey } = DB.getSettings();
    if (!geminiKey) throw new Error('API key no configurada. Ir a ⚙️ Config.');
    const res = await fetch(this.ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${geminiKey}`
      },
      body: JSON.stringify({
        model: this.MODEL,
        temperature: 0.2,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `Error ${res.status}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  },

  _parseJSON(text) {
    const clean = text.replace(/```json\n?|\n?```|```/g, '').trim();
    try { return JSON.parse(clean); }
    catch { throw new Error('No se pudo parsear la respuesta de IA'); }
  },

  // ── Extract product specs from a URL ──────────────────────────────────────
  async extractFromURL(url, catId) {
    const cat    = CONFIG.categorias[catId];
    const campos = cat.campos.map(c => `"${c.id}": null  // ${c.label}${c.unidad ? ' en ' + c.unidad : ''}`).join('\n  ');

    const prompt = `Sos un analista de productos para Argentina.
Analizá el contenido del siguiente link de producto y extraé las specs técnicas.
URL: ${url}
Categoría del producto: ${cat.nombre}

Respondé SOLO con JSON válido, sin texto adicional ni backticks:
{
  "nombre": "",
  "sku": "",
  "precio_ars": null,
  "imagen_url": "",
  "nivel": "",
  "fuente": "${url}",
  ${campos},
  "diferenciadores": ""
}

Si un campo no está disponible o no aplica, usá null.
Para booleanos usá true o false.
Para "nivel" estimá: Entry / Mid / High / Premium según precio y specs.`;

    const text = await this._call(prompt);
    return this._parseJSON(text);
  },

  // ── Analyze comparison and generate insights ──────────────────────────────
  async analyzeComparativa(propios, externos, tipo, catId) {
    const cat     = CONFIG.categorias[catId];
    const tipoObj = CONFIG.tipos.find(t => t.id === tipo);

    const prompt = `Sos un analista de producto senior para Gadnic/Bidcom Argentina.
Analizá esta comparativa de productos en la categoría "${cat.nombre}".
Tipo de análisis: ${tipoObj.label}

PRODUCTOS PROPIOS (Gadnic/Bidcom):
${JSON.stringify(propios.map(p => ({ sku: p.sku, nombre: p.nombre, ...Object.fromEntries(cat.campos.map(f => [f.label, p[f.id]])), pvp: p.pvp_ars, fob: p.fob_usd })), null, 2)}

PRODUCTOS EXTERNOS:
${JSON.stringify(externos.map(p => ({ nombre: p.nombre, ...Object.fromEntries(cat.campos.map(f => [f.label, p[f.id]])), precio: p.precio_ars || p.pvp_ars, fuente: p.fuente })), null, 2)}

Respondé SOLO con JSON válido, sin texto adicional ni backticks:
{
  "resumen": "1-2 frases del panorama general",
  "ventajas_propias": [
    { "titulo": "", "descripcion": "" }
  ],
  "gaps_criticos": [
    { "titulo": "", "descripcion": "", "urgencia": "alta|media|baja" }
  ],
  "recomendaciones": [
    { "titulo": "", "descripcion": "" }
  ],
  "posiciones": [
    { "nombre_externo": "", "vs_propio": "", "evaluacion": "entra|no_entra|gap_critico|par", "nota": "" }
  ]
}`;

    const text = await this._call(prompt);
    return this._parseJSON(text);
  },

  // ── Resolve imagen_url: template first, og:image fallback ─────────────────
  async resolveImageUrl(sku, fuenteUrl) {
    const variants = ['A', 'B', 'C'];

    // Step 1: try each variant (A, B, C) with HEAD request
    for (const v of variants) {
      const url = `https://images.bidcom.com.ar/resize?src=https://static.bidcom.com.ar/publicacionesML/productos/${sku}/1000x1000-${sku}-${v}.jpg&w=400&q=100`;
      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (res.ok) return url;
      } catch { /* try next */ }
    }

    // Step 2: fallback to og:image from publication URL via Jina
    if (!fuenteUrl) return `https://images.bidcom.com.ar/resize?src=https://static.bidcom.com.ar/publicacionesML/productos/${sku}/1000x1000-${sku}-A.jpg&w=400&q=100`;
    try {
      const jinaUrl = `https://r.jina.ai/${fuenteUrl}`;
      const res = await fetch(jinaUrl, {
        headers: { 'Accept': 'application/json', 'X-Return-Format': 'markdown' }
      });
      const text = await res.text();
      const match = text.match(/og:image['":\s]+([^\s'"]+bidcom[^\s'"]+\.(jpg|jpeg|png|webp))/i)
                 || text.match(/https?:\/\/[^\s'"]+bidcom[^\s'"]+\.(jpg|jpeg|png|webp)/i);
      if (match) return (match[1] || match[0]).trim();
    } catch { /* fall through */ }

    return `https://images.bidcom.com.ar/resize?src=https://static.bidcom.com.ar/publicacionesML/productos/${sku}/1000x1000-${sku}-A.jpg&w=400&q=100`;
  },

  // ── Extract multiple products from PDF text + annotations ─────────────────
  async extractFromPDF(pdfText, linksByRow, catId) {
    const cat    = CONFIG.categorias[catId];
    const campos = cat.campos.map(c =>
      `"${c.id}": null  // ${c.label}${c.unidad ? ' en ' + c.unidad : ''} (tipo: ${c.tipo})`
    ).join('\n      ');

    // Build link context string for the prompt
    const pubUrls = linksByRow.publicacion || [];
    const linkContext = pubUrls.length
      ? `\nLos links de publicación en orden de columna son:\n${pubUrls.map((u,i) => `  Producto ${i+1}: ${u}`).join('\n')}`
      : '';

    const prompt = `Sos un analista de productos para Argentina.
El siguiente texto fue extraído de un PDF de roadmap/catálogo de productos Gadnic/Bidcom.
Categoría: ${cat.nombre}

TEXTO DEL PDF:
${pdfText.substring(0, 12000)}
${linkContext}

Extraé TODOS los productos que encuentres en este documento.
Para cada producto completá los campos según el schema de la categoría.
Asigná el link de publicación al campo "fuente" según el orden de columnas.

Respondé SOLO con JSON válido, sin texto adicional ni backticks:
[
  {
    "sku": "",
    "nombre": "",
    "nivel": "",
    "fuente": "",
    "fob_usd": null,
    "pvp_ars": null,
    "rentabilidad": null,
    "imagen_url": null,
    ${campos},
    "diferenciadores": ""
  }
]

Notas:
- Para booleanos usá true o false, nunca strings.
- Para números eliminá símbolos ($, %, USD) y convertí a número.
- Para "nivel" estimá: Entry / Mid / Mid-High / High / Premium según precio y specs.
- Si un campo no aplica usá null.
- El campo "fuente" debe ser el link de publicación de Bidcom si está disponible.`;

    const text = await this._call(prompt);

    // Parse — may return array directly or wrapped
    const clean = text.replace(/```json\n?|\n?```|```/g, '').trim();
    try {
      const parsed = JSON.parse(clean);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      throw new Error('No se pudo parsear la respuesta de IA. Intentá de nuevo.');
    }
  },

  // ── Fill missing specs using AI ────────────────────────────────────────────
  async fillMissingSpecs(product, catId) {
    const cat     = CONFIG.categorias[catId];
    const missing = cat.campos.filter(f => !product[f.id] && f.req).map(f => f.label);
    if (!missing.length) return product;

    const prompt = `Sos un experto en electrónica de consumo.
Tenés este producto: "${product.nombre || product.sku}"
Categoría: ${cat.nombre}
Specs conocidas: ${JSON.stringify(Object.fromEntries(cat.campos.filter(f => product[f.id]).map(f => [f.label, product[f.id]])))}
Specs faltantes: ${missing.join(', ')}

Estimá los valores faltantes basándote en el nombre del modelo y las specs conocidas.
Respondé SOLO con JSON sin backticks con los campos faltantes (ids exactos):
{ ${cat.campos.filter(f => !product[f.id] && f.req).map(f => `"${f.id}": null`).join(', ')} }`;

    try {
      const text   = await this._call(prompt);
      const filled = this._parseJSON(text);
      return { ...product, ...filled, _ai_filled: true };
    } catch {
      return product;
    }
  },
  // ── Infer category fields from raw file text (semantic analysis) ──────────
  //
  // Receives unstructured text extracted from any file (PDF, Excel, CSV, image
  // OCR, spec-sheet, datasheet, etc.) and returns a structured array of campos
  // ready to be inserted into a category definition.
  //
  // The prompt is carefully designed to:
  //   1. Understand linguistic context (Spanish + English mixed docs)
  //   2. Detect measurement units and map them to the NUMERIC_UNITS vocabulary
  //   3. Classify boolean attributes (presence/absence features)
  //   4. Deduplicate semantically equivalent fields
  //   5. Mark truly required specs vs optional ones
  //   6. Return field IDs compatible with the existing config.js convention
  //
  async inferFieldsFromFile(rawText, categoryContext = '') {
    const prompt = `Sos un experto en análisis de fichas técnicas de productos de consumo y electrodomésticos.
Analizá el siguiente texto extraído de un documento (puede ser una ficha técnica, catálogo, planilla de cotización, datasheet o descripción de producto).

${categoryContext ? `Contexto de la categoría: "${categoryContext}"
` : ''}
TEXTO DEL DOCUMENTO:
${rawText.substring(0, 10000)}

Tu tarea es identificar TODAS las especificaciones técnicas relevantes que definen este tipo de producto.
Para cada especificación:
- Identificá su nombre en español claro y conciso
- Detectá si tiene unidad de medida (Pa, W, V, A, kg, g, cm, mm, L, ml, min, h, s, dB, rpm, mAh, Wh, °C, °F, lm, Hz, MHz, GHz, GB, TB, USD, ARS, km, m, pulg, ppm, K, %)
- Clasificá su tipo:
  * "numero" → si tiene valor numérico con o sin unidad (potencia, capacidad, velocidad, precio, dimensiones)
  * "booleano" → si es una característica que está o no está presente (tiene WiFi, tiene HEPA, incluye bolsa, es inalámbrico, tiene display, tiene auto-vaciado)
  * "texto" → si describe modo, material, tecnología, color, compatibilidad, certificación, o cualquier valor libre
- Determiná si es REQUERIDA (req: true) → specs que definen la performance o categoría del producto y sin las cuales no se puede comparar (potencia, capacidad, autonomía, succión, etc.)
- Descartá: precios, URLs, nombres de modelos, fechas, códigos internos, información de empresa/contacto

IMPORTANTE:
- No dupliques: si "Potencia motor" y "Motor (W)" son lo mismo, usá solo uno con el nombre más claro
- Los ids deben ser snake_case en minúsculas, máx 30 chars, usando el patrón "nombre_unidad" para numéricos (ej: potencia_w, autonomia_min, capacidad_l)
- Para booleanos el id termina en "_sn" (ej: filtro_hepa_sn, wifi_sn, auto_vaciado_sn)
- Para texto el id es solo el nombre (ej: tipo_filtro, material_cesto, navegacion)
- Ordená: primero los campos requeridos, luego los opcionales
- Generá entre 6 y 20 campos. Si el documento tiene menos info, generá los que puedas inferir razonablemente para esa categoría de producto

Respondé SOLO con un array JSON válido, sin texto adicional ni backticks:
[
  {
    "id": "potencia_w",
    "label": "Potencia",
    "unidad": "W",
    "tipo": "numero",
    "req": true
  },
  {
    "id": "filtro_hepa_sn",
    "label": "Filtro HEPA",
    "tipo": "booleano",
    "req": false
  },
  {
    "id": "tipo_filtro",
    "label": "Tipo de filtro",
    "tipo": "texto",
    "req": false
  }
]`;

    const text = await this._call(prompt);
    const clean = text.replace(/\`\`\`json\n?|\n?\`\`\`|\`\`\`/g, '').trim();
    try {
      const parsed = JSON.parse(clean);
      if (!Array.isArray(parsed)) throw new Error('La IA no devolvió un array');

      // Normalize and validate each field
      return parsed
        .filter(f => f && f.label && f.tipo)
        .map(f => ({
          id:     (f.id || f.label.toLowerCase().replace(/[^a-z0-9]/g,'_').replace(/__+/g,'_')).substring(0, 40),
          label:  String(f.label).trim(),
          unidad: f.unidad || undefined,
          tipo:   ['numero','booleano','texto'].includes(f.tipo) ? f.tipo : 'texto',
          req:    !!f.req
        }));
    } catch(e) {
      throw new Error('No se pudo interpretar la respuesta de la IA. Intentá con otro archivo.');
    }
  },

  // ── Extract plain text from a file (PDF, Excel, CSV, TXT, image) ──────────
  // Returns { text, preview } — preview is the first 300 chars for display
  async extractTextFromFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    let text = '';

    if (ext === 'pdf') {
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
      const buf = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
      for (let p = 1; p <= Math.min(pdf.numPages, 8); p++) {
        const page  = await pdf.getPage(p);
        const items = (await page.getTextContent()).items;
        text += items.map(i => i.str).join(' ') + '\n';
      }

    } else if (['xlsx','xls','ods'].includes(ext)) {
      if (!window.XLSX) {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
      }
      const buf = await file.arrayBuffer();
      const wb  = window.XLSX.read(buf, { type: 'array' });
      for (const sheetName of wb.SheetNames.slice(0, 4)) {
        const ws  = wb.Sheets[sheetName];
        text += '\n=== ' + sheetName + ' ===\n' +
                window.XLSX.utils.sheet_to_csv(ws, { blankrows: false });
      }

    } else if (['csv','tsv','txt'].includes(ext)) {
      text = await file.text();

    } else if (['jpg','jpeg','png','webp'].includes(ext)) {
      // For images: use Jina AI vision endpoint as OCR fallback
      // We send the base64 image as part of a Jina fetch
      const reader = new FileReader();
      text = await new Promise((res) => {
        reader.onload = (e) => {
          // Can't do much without a vision API — return filename hint
          res('Imagen de producto: ' + file.name.replace(/[_-]/g,' ').replace(/.[^.]+$/, ''));
        };
        reader.readAsDataURL(file);
      });

    } else {
      throw new Error('Formato no soportado. Usá PDF, Excel (.xlsx), CSV, TXT o imagen.');
    }

    if (!text.trim()) throw new Error('El archivo no contiene texto extraíble.');
    return {
      text,
      preview: text.substring(0, 400).replace(/\s+/g, ' ').trim()
    };
  },

  // ── Extract specs from reference URL ─────────────────────────────────────
  async extractRefSpecs(url) {
    let pageText = '';
    try {
      const res = await fetch(`https://r.jina.ai/${url}`, {
        headers: { 'Accept': 'application/json', 'X-Return-Format': 'markdown' }
      });
      pageText = (await res.text()).substring(0, 8000);
    } catch(e) { pageText = `URL: ${url}`; }

    const prompt = `Sos un analista de productos de consumo para Argentina.
Analizá el siguiente contenido de una página de producto de referencia y extraé las specs técnicas clave.

CONTENIDO:
${pageText}

Respondé SOLO con JSON válido, sin backticks:
{
  "nombre": "nombre del producto",
  "precio_ref": null,
  "specs": "resumen de specs en texto libre",
  "specs_obj": { "spec_clave": "valor" },
  "diferenciadores": "qué hace único a este producto"
}`;

    const text = await this._call(prompt);
    return this._parseJSON(text);
  },

  // ── Extract 7 fixed logistics fields from file text ─────────────────────
  async extractLogistics(fileText, fobHint = '') {
    const prompt = `Sos un analista de compras internacionales especializado en cotizaciones de proveedores chinos.
El siguiente texto fue extraído de una cotización de proveedor (puede ser Excel, PDF o Word).
El texto puede estar en inglés, chino o español, con abreviaturas comunes del comercio internacional.

TEXTO DE LA COTIZACIÓN:
${fileText.substring(0, 8000)}
${fobHint ? `\nNOTA: El sistema registra el FOB como: ${fobHint}` : ''}

INSTRUCCIONES DE EXTRACCIÓN:
- "fob_num": precio FOB como número decimal (ej: 4.56). Buscá "FOB", "Unit price", "Price", "$". Solo el número, sin símbolos.
- "puerto": puerto de origen (ej: "NINGBO", "SHANGHAI", "GUANGZHOU"). Buscá "PORT", "FOB Port".
- "ctn_size": dimensiones de la caja en cm formato LxWxH (ej: "60x60x52"). Buscá "CTN size", "Carton size", "Packing size", "Box size".
- "ctn_weight": peso de la caja en kg como número (ej: 15). Buscá "CTN G.W", "Gross weight", "GW", "Weight per carton".
- "pcs_ctn": unidades por caja como número entero (ej: 9). Buscá "PCS/CTN", "CTN qty", "Qty per carton", "Units per box".
- "lead_time": tiempo de producción en días como número entero (ej: 30). Buscá "Lead time", "Delivery time", "Production time". Convertí semanas a días (ej: "4 weeks" = 28).
- "payment_terms": condiciones de pago como texto (ej: "30% deposit, 70% BL"). Buscá "Payment", "Terms", "T/T".
- "modelo": número de modelo o SKU del proveedor (ej: "LSF-086"). Buscá "Model", "Item no", "SKU", "Part no", "Ref".
- "tech_score": dejalo en 0, se calcula después.

Si un campo no aparece en el texto, usá null. No inventes datos.

Respondé SOLO con JSON válido, sin backticks ni texto adicional:
{
  "fob_num": null,
  "puerto": "",
  "ctn_size": "",
  "ctn_weight": null,
  "pcs_ctn": null,
  "lead_time": null,
  "payment_terms": "",
  "modelo": "",
  "tech_score": 0
}`;

    const text = await this._call(prompt);
    return this._parseJSON(text);
  },

  // ── Extract tech specs from file text ────────────────────────────────────
  async extractTechSpecs(fileText, productDesc, refSpecs) {
    const refContext = refSpecs?.specs_obj && Object.keys(refSpecs.specs_obj).length
      ? `Especificaciones del producto de referencia ideal:\n${Object.entries(refSpecs.specs_obj).map(([k,v])=>`- ${k}: ${v}`).join('\n')}`
      : refSpecs?.specs
        ? `Descripción del producto de referencia: ${refSpecs.specs}`
        : '';

    const prompt = `Sos un analista de productos de consumo especializado en importaciones desde China.
El siguiente texto fue extraído de una cotización de proveedor. Puede estar en inglés, chino o español.

PRODUCTO: ${productDesc}
${refContext ? `\n${refContext}\n` : ''}
TEXTO DE LA COTIZACIÓN:
${fileText.substring(0, 8000)}

Tu tarea es extraer TODAS las especificaciones técnicas del PRODUCTO (no de la caja/embalaje).
Excluí: FOB, precio, CTN size, CTN weight, PCS/CTN, lead time, payment terms, puerto.
Incluí: material, dimensiones del producto, peso del producto, colores, funciones, certificaciones,
        temperatura, voltaje, potencia, capacidad, acabado, tecnología, accesorios incluidos, y
        cualquier otra característica técnica del producto.

Normalizá los nombres de specs en español claro y conciso.
Para cada spec incluí el valor con su unidad si la tiene.
Si la referencia tiene specs, intentá usar los mismos nombres de campo cuando corresponda.

Respondé SOLO con un objeto JSON válido, sin backticks, con todas las specs encontradas:
{
  "Material": "EVA foam",
  "Dimensiones del producto": "50 × 500 cm",
  "Espesor": "4 mm",
  "Rango de temperatura": "10-70 °C",
  "Color disponible": "Negro",
  "...": "..."
}

Si no encontrás ninguna spec técnica del producto, respondé con {}.`;

    try {
      const text = await this._call(prompt);
      return this._parseJSON(text);
    } catch(e) {
      return {};
    }
  },

  // ── Normalize specs across all cotizaciones ───────────────────────────────
  // Returns only specs present in >= 2 cotizaciones (no noise)
  async normalizeSpecs(allTechSpecs, cotCount) {
    if (!allTechSpecs.length) return { normalizedSpecs: [], specsTable: [] };

    const allKeys = allTechSpecs.flatMap(s => Object.keys(s));
    const keyCounts = {};
    allKeys.forEach(k => { keyCounts[k] = (keyCounts[k]||0) + 1; });

    // Pre-filter: only keys in >= 2 cotizaciones
    const candidates = Object.entries(keyCounts)
      .filter(([k,v]) => v >= Math.min(2, cotCount))
      .map(([k]) => k);

    if (!candidates.length) {
      // fallback: use all keys if few cotizaciones
      return {
        normalizedSpecs: allTechSpecs,
        specsTable: [...new Set(allKeys)].slice(0, 15)
      };
    }

    // Ask AI to normalize spec names (unify synonyms)
    const prompt = `Sos un experto en normalización de datos de productos.
Tenés estas especificaciones técnicas extraídas de múltiples cotizaciones del mismo producto.

Specs encontradas (con cantidad de cotizaciones que las mencionan):
${JSON.stringify(keyCounts, null, 2)}

Specs a normalizar (aparecen en 2+ cotizaciones):
${candidates.join(', ')}

Respondé SOLO con JSON válido, sin backticks:
{
  "tabla_specs": ["Nombre normalizado 1", "Nombre normalizado 2", ...],
  "mapeo": {
    "nombre_original": "Nombre normalizado",
    "otro_nombre_original": "Nombre normalizado"
  }
}

Reglas:
- Unificá sinónimos (ej: "Material cuerpo" y "Body material" → "Material")
- Usá nombres en español, concisos
- Máximo 15 specs en tabla_specs
- Solo incluí specs que aporten valor comparativo real`;

    try {
      const text   = await this._call(prompt);
      const result = this._parseJSON(text);
      const mapeo  = result.mapeo || {};

      // Apply normalization to each cotización's specs
      const normalizedSpecs = allTechSpecs.map(specs => {
        const norm = {};
        Object.entries(specs).forEach(([k, v]) => {
          const normKey = mapeo[k] || k;
          if (!norm[normKey]) norm[normKey] = v;
        });
        return norm;
      });

      return {
        normalizedSpecs,
        specsTable: result.tabla_specs || candidates.slice(0, 15)
      };
    } catch(e) {
      return { normalizedSpecs: allTechSpecs, specsTable: candidates.slice(0, 15) };
    }
  },

  // ── Detect product category ───────────────────────────────────────────────
  async detectCategory(productDesc, specsTable, existingCats) {
    const catList = Object.values(existingCats).map(c =>
      `- id: "${c.id}", nombre: "${c.nombre}", emoji: "${c.emoji||'📦'}", campos: [${(c.campos||[]).map(f=>f.label).join(', ')}]`
    ).join('\n');

    const prompt = `Sos un experto en categorización de productos de consumo.

PRODUCTO: ${productDesc}
SPECS DETECTADAS: ${Array.isArray(specsTable) ? specsTable.join(', ') : JSON.stringify(specsTable)}

CATEGORÍAS EXISTENTES:
${catList || 'Ninguna todavía'}

Determiná a qué categoría pertenece este producto.
Si coincide con una existente, usá su id.
Si es nueva, sugerí nombre, emoji y campos.

Respondé SOLO con JSON válido, sin backticks:
{
  "existing_cat_id": null,
  "suggested_name": "Nombre de categoría",
  "suggested_id": "id_snake_case",
  "suggested_emoji": "📦",
  "suggested_campos": [
    { "label": "Nombre campo", "tipo": "texto|numero|booleano", "unidad": "", "req": true }
  ],
  "reasoning": "Por qué esta categoría"
}

Si coincide con existente, pon su id en existing_cat_id y dejá los campos suggested vacíos.`;

    try {
      const text = await this._call(prompt);
      return this._parseJSON(text);
    } catch(e) {
      return { existing_cat_id: null, suggested_name: productDesc, suggested_id: 'nueva', reasoning: '' };
    }
  },

  // ── Full benchmark analysis ───────────────────────────────────────────────
  async benchmarkAnalysis(rawCots, refSpecs, specsTable, productDesc, catId) {
    const cotsData = rawCots.map(c => ({
      proveedor:   c.proveedor,
      fob:         c.logistics?.fob_num,
      puerto:      c.logistics?.puerto,
      moq:         c.logistics?.moq,
      lead_time:   c.logistics?.lead_time,
      payment:     c.logistics?.payment_terms,
      modelo:      c.logistics?.modelo,
      ctn_size:    c.logistics?.ctn_size,
      ctn_weight:  c.logistics?.ctn_weight,
      pcs_ctn:     c.logistics?.pcs_ctn,
      specs:       c.techNorm || c.techSpecs || {}
    }));

    const refContext = refSpecs?.specs_obj
      ? JSON.stringify(refSpecs.specs_obj)
      : refSpecs?.specs || 'Sin referencia';

    const prompt = `Sos un analista senior de compras internacionales y desarrollo de productos para Argentina.

PRODUCTO: ${productDesc}
SPECS DE REFERENCIA (producto ideal):
${refContext}

COTIZACIONES A ANALIZAR:
${JSON.stringify(cotsData, null, 2)}

Generá un benchmark completo tanto técnico como de negocios.

Respondé SOLO con JSON válido, sin backticks:
{
  "resumen_ejecutivo": "2-3 frases del panorama general",
  "ventajas_por_proveedor": [
    {
      "proveedor": "nombre",
      "ventajas": ["ventaja 1", "ventaja 2"],
      "gaps": ["gap 1"],
      "evaluacion_vs_referencia": "cumple|cumple_parcial|no_cumple"
    }
  ],
  "gaps_criticos": [
    { "descripcion": "", "afecta_a": ["proveedor1"], "urgencia": "alta|media|baja" }
  ],
  "recomendaciones": [
    { "titulo": "", "descripcion": "" }
  ],
  "ranking_entre_cotizaciones": [
    { "posicion": 1, "proveedor": "", "razon": "por qué es el mejor entre cotizaciones" }
  ],
  "oportunidades_negociacion": ["oportunidad 1", "oportunidad 2"]
}`;

    try {
      const text = await this._call(prompt);
      return this._parseJSON(text);
    } catch(e) {
      return null;
    }
  },

};
