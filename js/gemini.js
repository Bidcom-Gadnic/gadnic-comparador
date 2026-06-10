// ─── GADNIC COMPARADOR · AI (Groq) ────────────────────────────────────────────
const GEMINI = {
  MODEL: 'gemini-2.0-flash',
  ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models/',

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

    // Gemini REST API — generateContent endpoint
    const url = `${this.ENDPOINT}${this.MODEL}:generateContent?key=${geminiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
          responseMimeType: 'text/plain'
        }
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Gemini API Error ${res.status}`);
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
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
  async extractLogistics(fileText, fobHint = '', productDesc = '') {
    const prompt = `Sos un analista de compras internacionales especializado en cotizaciones de proveedores chinos.
El siguiente texto fue extraído de una cotización de proveedor (puede ser Excel, PDF o Word).
Puede estar en inglés, chino o español. El archivo puede tener UN solo producto o MÚLTIPLES productos.

PRODUCTO QUE BUSCAMOS: ${productDesc || 'producto principal de la cotización'}
TEXTO DE LA COTIZACIÓN:
${fileText.substring(0, 8000)}
${fobHint ? `\nNOTA: El sistema ya tiene registrado el FOB como: ${fobHint}` : ''}

Si hay MÚLTIPLES productos en el texto, enfocate en el que más se parezca al producto buscado.
Si hay UN solo producto, extraé sus datos directamente.

INSTRUCCIONES DE EXTRACCIÓN (buscá estas variantes de nombres):
- "fob_num": precio FOB/EXW/Unit price como número decimal (ej: 14.2). Solo el número sin símbolos.
- "puerto": puerto de origen (ej: "NINGBO"). Si dice EXW sin puerto, dejá vacío string.
- "ctn_size": dimensiones de la CAJA DE ENVÍO formato LxWxH en cm (ej: "54x46x24"). Buscá "CTN size", "Carton size", "Box size". NO usar dimensiones del producto.
- "ctn_weight": peso bruto caja en kg (ej: 15.5). Buscá "Gross weight", "GW", "CTN G.W", "kg/carton", "kg per carton".
- "pcs_ctn": unidades por caja, número entero (ej: 30). Buscá "per carton", "PCS/CTN", "CTN qty", "pcs per ctn".
- "lead_time": días de producción, número entero. Convertí: "5-7 working days"→7, "4 weeks"→28, "30 days"→30.
- "payment_terms": condiciones de pago completas. Ej: "50% deposit, 50% balance before shipment".
- "modelo": código de modelo del proveedor. Buscá "Model", "Item No", "SKU", "Part no". Ej: "GMC-301".
- "tech_score": siempre 0.

Si un campo genuinamente no aparece en el texto, usá null. No inventes.

Respondé SOLO con JSON válido, sin backticks:
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

    const specsContext = Array.isArray(specsTable)
      ? specsTable.join(', ')
      : Object.keys(specsTable || {}).join(', ');

    const prompt = `Sos un experto en categorización de productos de consumo e importaciones.

PRODUCTO: ${productDesc}
ESPECIFICACIONES TÉCNICAS DETECTADAS: ${specsContext}

CATEGORÍAS EXISTENTES EN EL SISTEMA:
${catList || 'Ninguna todavía'}

Tu tarea tiene DOS partes:

PARTE 1 — CATEGORIZACIÓN:
Determiná si este producto corresponde a alguna categoría existente o si es una categoría nueva.
Para que sea "existente", el producto debe ser claramente de esa categoría (no solo parecido).

PARTE 2 — CAMPOS DE LA CATEGORÍA (SIEMPRE REQUERIDO):
Independientemente de si la categoría es existente o nueva, generá la lista completa de campos
técnicos relevantes para comparar productos de este tipo.
Basate en las specs detectadas Y en tu conocimiento del tipo de producto.
Incluí entre 8 y 15 campos. Ordenalos: primero los más importantes para la decisión de compra.

Para cada campo:
- "label": nombre en español claro y conciso
- "tipo": "numero" si tiene valor numérico con unidad, "booleano" si es característica presente/ausente, "texto" para todo lo demás
- "unidad": unidad de medida si aplica (RPM, W, V, mAh, cm, mm, g, kg, °C, etc.)
- "req": true si es crítico para comparar este tipo de producto, false si es opcional

Respondé SOLO con JSON válido, sin backticks:
{
  "existing_cat_id": null,
  "suggested_name": "Nombre de categoría en español",
  "suggested_id": "id_snake_case",
  "suggested_emoji": "emoji representativo",
  "suggested_campos": [
    { "label": "Velocidad máxima", "tipo": "numero", "unidad": "RPM", "req": true },
    { "label": "Potencia", "tipo": "numero", "unidad": "W", "req": true },
    { "label": "Tipo de control", "tipo": "texto", "unidad": "", "req": true },
    { "label": "Batería incluida", "tipo": "booleano", "unidad": "", "req": false }
  ],
  "reasoning": "Explicación breve de la categoría y por qué estos campos"
}

Si coincide con una categoría existente, usá su id en existing_cat_id pero igualmente completá suggested_campos con los campos más relevantes para ese tipo de producto.`;

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
