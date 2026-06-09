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

  // ── Extract specs from a reference product URL ────────────────────────────
  async extractRefSpecs(url) {
    const jinaUrl = `https://r.jina.ai/${url}`;
    let pageText  = '';
    try {
      const res  = await fetch(jinaUrl, {
        headers: { 'Accept': 'application/json', 'X-Return-Format': 'markdown' }
      });
      pageText = (await res.text()).substring(0, 8000);
    } catch(e) {
      pageText = `URL: ${url}`;
    }

    const prompt = `Sos un analista de productos de consumo para Argentina.
Analizá el siguiente contenido de una página de producto de referencia y extraé las specs técnicas clave.

CONTENIDO:
${pageText}

Respondé SOLO con JSON válido, sin backticks:
{
  "nombre": "nombre del producto",
  "precio_ref": null,
  "specs": "lista de specs técnicas en texto libre, una por línea",
  "specs_obj": {
    "campo_clave": "valor"
  },
  "diferenciadores": "qué hace único a este producto"
}`;

    const text   = await this._call(prompt);
    return this._parseJSON(text);
  },

  // ── Analyze a cotización URL and compare against reference specs ───────────
  // For Google Drive URLs: uses Apps Script to extract file content server-side
  // For other URLs: uses Jina Reader as fallback
  async analyzeCotizacion(url, refSpecs, fobHint = '') {
    let pageText = '';

    const isDrive = url && (
      url.includes('drive.google.com') ||
      url.includes('docs.google.com/spreadsheets') ||
      url.includes('docs.google.com/document')
    );

    if (isDrive) {
      // Use Apps Script to extract file content — works with private Drive files
      try {
        const data = await DB._get({ action: 'extractFile', fileUrl: url });
        if (data.ok && data.text) {
          pageText = data.text;
        } else if (data.error) {
          console.warn('Drive extract error:', data.error);
        }
      } catch(e) {
        console.warn('Apps Script extractFile failed:', e.message);
      }
    }

    // Fallback to Jina for non-Drive URLs or if Apps Script failed
    if (!pageText) {
      try {
        const jinaUrl = `https://r.jina.ai/${url}`;
        const res     = await fetch(jinaUrl, {
          headers: { 'Accept': 'application/json', 'X-Return-Format': 'markdown' }
        });
        if (res.ok) pageText = (await res.text()).substring(0, 8000);
      } catch(e) { /* fall through with empty text */ }
    }

    const refText = typeof refSpecs === 'object'
      ? (refSpecs.specs || JSON.stringify(refSpecs))
      : String(refSpecs);

    const prompt = `Sos un analista de compras internacionales para Argentina.
Analizá esta cotización de proveedor y comparala contra el producto de referencia.

PRODUCTO DE REFERENCIA:
${refText}

CONTENIDO DE LA COTIZACIÓN (puede ser texto de PDF, Excel o página web):
${pageText || `URL: ${url}${fobHint ? ' — FOB indicado: ' + fobHint : ''}`}

Extraé la información de la cotización y evaluá qué tan bien cumple los requisitos de la referencia.

Respondé SOLO con JSON válido, sin backticks:
{
  "proveedor": "nombre del proveedor o empresa",
  "modelo": "modelo o SKU del producto cotizado",
  "fob_num": null,
  "moq": null,
  "lead_time": null,
  "payment_terms": "",
  "tech_score": 0,
  "resumen": "1-2 frases del análisis general",
  "ventajas": ["ventaja 1", "ventaja 2"],
  "gaps": ["gap 1", "gap 2"],
  "specs_obj": {
    "spec_clave": "valor"
  }
}

Notas:
- fob_num: precio FOB como número (solo el número, sin USD ni texto)${fobHint ? '. El Sheet indica FOB: ' + fobHint : ''}
- moq: cantidad mínima de orden como número
- lead_time: días de producción como número
- tech_score: 0-100, qué tan bien cumple las specs de la referencia
- ventajas: qué tiene de bueno vs la referencia (máx 3)
- gaps: qué le falta vs la referencia (máx 3)
- Si no encontrás un dato, usá null`;

    const text = await this._call(prompt);
    return this._parseJSON(text);
  },

};
