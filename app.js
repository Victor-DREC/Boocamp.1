'use strict';

/* =====================================================================
   REPARACEL - Sistema de turnos y taller de reparación
   - Sincronización multi-pantalla: BroadcastChannel + Evento 'storage' + Heartbeat
   - Iconografía: SVG técnicos vectoriales (cero emojis)
   - Diseño: Claro, profesional y de alta visibilidad para clientes
   ===================================================================== */

const RC = (() => {

  /* ---------- Configuración ---------- */
  const CONFIG = {
    tiempoSiguiente: 5000,   // ms que un turno permanece como "Siguiente" (modo automático)
    tiempoReparando: 5000,   // ms que permanece "Reparando" -> total: 10 s hasta finalizar
    validarCedula: true      // false = acepta cualquier número de 10 dígitos (útil para pruebas)
  };

  /* ---------- Iconos SVG técnicos (sin dependencias externas) ---------- */
  const ICONOS_SVG = {
    celular: `<svg class="ico-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>`,
    tablet:  `<svg class="ico-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><line x1="12" x2="12.01" y1="18" y2="18"/></svg>`,
    laptop:  `<svg class="ico-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/></svg>`,
    tecnico: `<svg class="ico-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`
  };

  const MODULOS = {
    A: { dispositivo: 'celular', nombre: 'Módulo A', icono: ICONOS_SVG.celular },
    B: { dispositivo: 'tablet',  nombre: 'Módulo B', icono: ICONOS_SVG.tablet },
    C: { dispositivo: 'laptop',  nombre: 'Módulo C', icono: ICONOS_SVG.laptop }
  };

  const ICONOS = ICONOS_SVG;

  const ESTADOS = {
    espera:    'En espera',
    siguiente: 'Siguiente',
    reparando: 'Reparando',
    listo:     'Listo'
  };

  const DANOS = [
    'Daño de pantalla',
    'Daño de batería',
    'Daño de cámara',
    'Mantenimiento',
    'Actualización',
    'Daño por agua',
    'Revisión técnica'
  ];

  const KEY = 'reparcel_db_v1';
  const CHANNEL_NAME = 'reparacel_broadcast_channel';

  /* ---------- Inicialización segura de BroadcastChannel ---------- */
  let canal = null;
  try {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      canal = new BroadcastChannel(CHANNEL_NAME);
    }
  } catch (e) {
    console.warn('BroadcastChannel no disponible en este entorno, usando fallback de almacenamiento:', e);
  }

  const oyentes = [];

  /* ---------- Almacenamiento y Notificación Inmediata ---------- */
  const vacio = () => ({
    turnos: [],
    tecnicos: [],
    contadores: { A: 0, B: 0, C: 0 },
    seq: 0,
    extraSeq: 0,
    modo: 'auto',
    ultimoCambio: Date.now()
  });

  function cargar() {
    try {
      const raw = localStorage.getItem(KEY);
      const db = raw ? JSON.parse(raw) : null;
      return db ? Object.assign(vacio(), db) : vacio();
    } catch {
      return vacio();
    }
  }

  function guardar(db, metadata = {}) {
    db.ultimoCambio = Date.now();
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch (e) {
      console.error('Error al guardar en localStorage:', e);
    }

    // 1. Notificar a través de BroadcastChannel a TODAS las otras pestañas/pantallas
    if (canal) {
      try {
        canal.postMessage({
          tipo: 'actualizado',
          accion: metadata.accion || 'cambio',
          id: metadata.id || null,
          estado: metadata.estado || null,
          db: db,
          t: db.ultimoCambio
        });
      } catch (err) {
        console.warn('Error emitiendo por BroadcastChannel:', err);
      }
    }

    // 2. Notificar oyentes registrados en la misma pestaña
    oyentes.forEach(fn => {
      try { fn(db); } catch (e) { console.error('Error en oyente local:', e); }
    });
  }

  function onChange(fn) {
    oyentes.push(fn);
  }

  /* ---------- Receptores de sincronización multi-pantalla ---------- */
  // 1. Recepción vía BroadcastChannel
  if (canal) {
    canal.onmessage = (event) => {
      try {
        const dbRecibida = (event && event.data && event.data.db) ? event.data.db : cargar();
        oyentes.forEach(fn => {
          try { fn(dbRecibida); } catch (e) { console.error(e); }
        });
      } catch (err) {
        console.error('Error procesando mensaje de BroadcastChannel:', err);
      }
    };
  }

  // 2. Recepción vía Evento 'storage' nativo (funciona en todas las pestañas cruzadas)
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key === KEY) {
        try {
          const dbActualizada = event.newValue ? JSON.parse(event.newValue) : cargar();
          oyentes.forEach(fn => {
            try { fn(dbActualizada); } catch (e) { console.error(e); }
          });
        } catch {
          const dbActualizada = cargar();
          oyentes.forEach(fn => {
            try { fn(dbActualizada); } catch (e) { console.error(e); }
          });
        }
      }
    });
  }

  /* ---------- Módulos dinámicos ---------- */
  function getModulos(db) {
    const base = Object.entries(MODULOS).map(([letra, m]) => ({
      letra, nombre: m.nombre, dispositivos: [m.dispositivo], extra: false,
      tecnicos: db.tecnicos.filter(t => !t.modulo && t.dispositivos.includes(m.dispositivo))
    }));
    const extras = db.tecnicos.filter(t => t.modulo)
      .sort((a, b) => a.modulo.localeCompare(b.modulo))
      .map(t => ({
        letra: t.modulo, nombre: `Módulo ${t.modulo}`, dispositivos: t.dispositivos, extra: true, tecnicos: [t]
      }));
    return [...base, ...extras];
  }

  function getModulo(db, letra) {
    return getModulos(db).find(m => m.letra === letra)
      || { letra, nombre: `Módulo ${letra}`, dispositivos: [], extra: false, tecnicos: [] };
  }

  const iconosDe = disps => disps.map(d => ICONOS[d] || '').join(' ');

  function moduloPara(db, disp) {
    const candidatos = getModulos(db).filter(m => m.dispositivos.includes(disp));
    const conTecnico = candidatos.filter(m => m.tecnicos.length);
    const lista = conTecnico.length ? conTecnico : candidatos;
    const carga = m => db.turnos.filter(t => t.modulo === m.letra && t.estado !== 'listo').length;
    return lista.reduce((mejor, m) => (carga(m) < carga(mejor) ? m : mejor)).letra;
  }

  const modulosDeTecnico = (db, tec) =>
    getModulos(db).filter(m => m.tecnicos.some(x => x.id === tec.id)).map(m => m.letra);

  function validarCedula(c) {
    return /^\d{10}$/.test(c);
  }

  const enmascarar = c => c.slice(0, 3) + '•••••' + c.slice(-2);
  const hora = ts => new Date(ts).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const activo = t => t.estado === 'siguiente' || t.estado === 'reparando';

  /* ---------- Turnos ---------- */
  function crearTurno({ cedula, dispositivo, dano }) {
    if (!validarCedula(cedula)) return { ok: false, error: 'La cédula ingresada no es válida. Debe tener 10 dígitos.' };
    if (!ICONOS[dispositivo]) return { ok: false, error: 'Selecciona un tipo de dispositivo.' };
    if (!DANOS.includes(dano)) return { ok: false, error: 'Selecciona el tipo de daño o servicio requerido.' };

    const db = cargar();
    if (db.turnos.some(t => t.cedula === cedula && t.dispositivo === dispositivo && t.estado !== 'listo')) {
      return { ok: false, error: 'Ya tienes un turno activo para ese tipo de dispositivo.' };
    }

    const modulo = moduloPara(db, dispositivo);
    db.contadores[modulo] = (db.contadores[modulo] || 0) + 1;
    db.seq++;
    const turno = {
      n: db.seq,
      codigo: `${modulo}-${String(db.contadores[modulo]).padStart(3, '0')}`,
      modulo, cedula, dispositivo,
      dano,
      estado: 'espera',
      tecnico: null,
      creado: Date.now(),
      estadoDesde: Date.now()
    };
    db.turnos.push(turno);
    guardar(db, { accion: 'crear_turno', id: turno.n, estado: 'espera' });

    const adelante = db.turnos.filter(t => t.modulo === modulo && t.n < turno.n && t.estado !== 'listo').length;
    return { ok: true, turno, adelante };
  }

  function tecnicoDeModulo(db, turno) {
    const mod = getModulo(db, turno.modulo);
    const candidatos = mod.tecnicos.filter(x => x.dispositivos.includes(turno.dispositivo));
    const libre = candidatos.find(x => !db.turnos.some(o => o.estado === 'reparando' && o.tecnico === x.nombre));
    const t = libre || candidatos[0];
    return t ? t.nombre : null;
  }

  function cambiarEstado(id, estado, tecnicoId) {
    const db = cargar();
    const t = db.turnos.find(x => x.n === id);
    if (!t) return { ok: false, error: 'Turno no encontrado.' };

    if (estado === 'siguiente' && db.turnos.some(x => x.modulo === t.modulo && x.n !== id && activo(x))) {
      return { ok: false, error: `El ${getModulo(db, t.modulo).nombre} ya tiene un turno en atención activa.` };
    }

    if (estado === 'reparando') {
      let tec = db.tecnicos.find(x => x.id === tecnicoId);
      if (!tec && db.tecnicos.length > 0) {
        const mod = getModulo(db, t.modulo);
        tec = mod.tecnicos.find(x => x.dispositivos.includes(t.dispositivo)) || db.tecnicos[0];
      }
      if (!tec) return { ok: false, error: 'Selecciona o registra un técnico activo antes de iniciar la reparación.' };
      if (!tec.dispositivos.includes(t.dispositivo)) {
        return { ok: false, error: `${tec.nombre} no está asignado para trabajar con ${t.dispositivo}s.` };
      }
      const mod = getModulo(db, t.modulo);
      if (mod.tecnicos.length && !mod.tecnicos.some(x => x.id === tec.id)) {
        return { ok: false, error: `${tec.nombre} no está asignado al ${mod.nombre}.` };
      }
      t.tecnico = tec.nombre;
    }

    t.estado = estado;
    t.estadoDesde = Date.now();
    
    // Guardar y notificar a todas las pantallas abiertas
    guardar(db, { accion: 'cambiar_estado', id: t.n, estado: estado });
    return { ok: true };
  }

  function setModo(modo) {
    const db = cargar();
    db.modo = modo;
    db.turnos.forEach(t => { if (activo(t)) t.estadoDesde = Date.now(); });
    guardar(db, { accion: 'set_modo', modo: modo });
  }

  function limpiarFinalizados() {
    const db = cargar();
    db.turnos = db.turnos.filter(t => t.estado !== 'listo');
    guardar(db, { accion: 'limpiar_finalizados' });
  }

  function reiniciarTodo() {
    const db = cargar();
    guardar(Object.assign(vacio(), { tecnicos: db.tecnicos, extraSeq: db.extraSeq, modo: db.modo }), { accion: 'reiniciar_todo' });
  }

  /* ---------- Técnicos ---------- */
  function registrarTecnico({ nombre, cedula, dispositivos }) {
    if (!nombre || nombre.trim().length < 3) return { ok: false, error: 'Ingresa el nombre del técnico.' };
    if (!validarCedula(cedula)) return { ok: false, error: 'La cédula ingresada no es válida.' };
    if (!dispositivos.length) return { ok: false, error: 'Selecciona al menos un dispositivo.' };

    const db = cargar();
    if (db.tecnicos.some(t => t.cedula === cedula)) return { ok: false, error: 'Ya existe un técnico con esa cédula.' };

    const id = Math.max(Date.now(), ...db.tecnicos.map(t => t.id + 1), 1);
    const nuevo = { id, nombre: nombre.trim(), cedula, dispositivos, modulo: null };
    const base = db.tecnicos.filter(t => !t.modulo).length;
    if (base >= 3) {
      if (db.extraSeq >= 23) return { ok: false, error: 'Se alcanzó el máximo de módulos permitidos.' };
      nuevo.modulo = String.fromCharCode(68 + db.extraSeq);   // 68 = 'D'
      db.extraSeq++;
    }
    db.tecnicos.push(nuevo);
    guardar(db, { accion: 'registrar_tecnico', id: nuevo.id });
    return { ok: true, modulo: nuevo.modulo };
  }

  function eliminarTecnico(id) {
    const db = cargar();
    const tec = db.tecnicos.find(t => t.id === id);
    db.tecnicos = db.tecnicos.filter(t => t.id !== id);
    if (tec && tec.modulo) {
      db.turnos.filter(t => t.modulo === tec.modulo && t.estado !== 'listo').forEach(t => {
        t.modulo = moduloPara(db, t.dispositivo);
        t.estado = 'espera'; t.tecnico = null; t.estadoDesde = Date.now();
      });
    }
    guardar(db, { accion: 'eliminar_tecnico', id: id });
  }

  /* ---------- Motor automático ---------- */
  function tick() {
    const db = cargar();
    if (db.modo !== 'auto') return;
    const ahora = Date.now();
    let cambio = false;

    db.turnos.forEach(t => {
      if (t.estado === 'siguiente' && ahora - t.estadoDesde >= CONFIG.tiempoSiguiente) {
        t.estado = 'reparando'; t.estadoDesde = ahora;
        t.tecnico = t.tecnico || tecnicoDeModulo(db, t) || 'Taller Central';
        cambio = true;
      } else if (t.estado === 'reparando' && ahora - t.estadoDesde >= CONFIG.tiempoReparando) {
        t.estado = 'listo'; t.estadoDesde = ahora;
        cambio = true;
      }
    });

    getModulos(db).forEach(({ letra: m }) => {
      if (db.turnos.some(t => t.modulo === m && activo(t))) return;
      const prox = db.turnos.filter(t => t.modulo === m && t.estado === 'espera').sort((a, b) => a.n - b.n)[0];
      if (prox) { prox.estado = 'siguiente'; prox.estadoDesde = ahora; cambio = true; }
    });

    if (cambio) guardar(db, { accion: 'tick_auto' });
  }

  const iniciarMotor = () => setInterval(tick, 1000);

  return {
    CONFIG, MODULOS, ICONOS, ICONOS_SVG, ESTADOS, DANOS, activo,
    getModulos, getModulo, moduloPara, modulosDeTecnico, iconosDe,
    cargar, guardar, onChange, iniciarMotor,
    crearTurno, cambiarEstado, setModo, limpiarFinalizados, reiniciarTodo,
    registrarTecnico, eliminarTecnico,
    enmascarar, hora, esc
  };
})();

/* ---------- Toast ---------- */
function toast(msg, error = false) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.toggle('err', error);
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

const $ = sel => document.querySelector(sel);
const porNumDesc = (a, b) => b.n - a.n;

/* =====================================================================
   PANTALLA 1 y 2: index.html (inicio + generar turno)
   ===================================================================== */
function initIndex() {
  const vistaInicio = $('#vista-inicio');
  const vistaTurno = $('#vista-turno');
  const form = $('#form-turno');
  const errorEl = $('#error-form');
  const bloqueForm = $('#bloque-form');
  const bloqueTicket = $('#bloque-ticket');

  if (!vistaInicio || !vistaTurno) return;

  if ($('#dano')) {
    $('#dano').innerHTML = '<option value="">— Selecciona el diagnóstico o servicio —</option>' +
      RC.DANOS.map(d => `<option value="${d}">${d}</option>`).join('');
  }

  function ruta() {
    const enTurno = location.hash === '#turno';
    vistaInicio.hidden = enTurno;
    vistaTurno.hidden = !enTurno;
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', ruta);
  ruta();

  if ($('#cedula')) {
    $('#cedula').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });
  }

  const actualizarHint = () => {
    if (!form || !form.dispositivo) return;
    const db = RC.cargar();
    const m = RC.getModulo(db, RC.moduloPara(db, form.dispositivo.value));
    const hintEl = $('#hint-modulo');
    if (hintEl) {
      hintEl.textContent = `Asignación automática: ${m.nombre}`;
    }
  };

  if (form) {
    form.querySelectorAll('input[name="dispositivo"]').forEach(r => r.addEventListener('change', actualizarHint));
    actualizarHint();

    form.addEventListener('submit', e => {
      e.preventDefault();
      if (errorEl) errorEl.textContent = '';
      const r = RC.crearTurno({
        cedula: form.cedula.value.trim(),
        dispositivo: form.dispositivo.value,
        dano: form.dano.value
      });
      if (!r.ok) {
        if (errorEl) errorEl.textContent = r.error;
        toast(r.error, true);
        return;
      }

      $('#ticket-codigo').textContent = r.turno.codigo;
      $('#ticket-detalle').textContent =
        `${RC.getModulo(RC.cargar(), r.turno.modulo).nombre} · Dispositivo: ${r.turno.dispositivo}. ` +
        (r.adelante === 0 ? '¡Eres el siguiente en turno!' : `Hay ${r.adelante} turno(s) delante de ti.`);
      bloqueForm.hidden = true;
      bloqueTicket.hidden = false;
      form.reset();
      actualizarHint();
      toast(`Turno ${r.turno.codigo} generado con éxito`);
    });
  }

  if ($('#btn-otro')) {
    $('#btn-otro').addEventListener('click', () => {
      bloqueTicket.hidden = true;
      bloqueForm.hidden = false;
    });
  }
}

/* =====================================================================
   PANTALLA 3: pantalla.html (cliente - SINCRONIZADA EN TIEMPO REAL)
   ===================================================================== */
function initPantalla() {
  let previo = {};
  let ultimoTimestamp = 0;

  function render(db) {
    if (!db) return;
    ultimoTimestamp = db.ultimoCambio || Date.now();

    // Chip de modo
    const chipModo = $('#chip-modo');
    if (chipModo) {
      chipModo.textContent = db.modo === 'auto' ? 'Modo: Automático' : 'Modo: Manual (Técnico)';
      chipModo.className = db.modo === 'auto' ? 'chip' : 'chip chip-manual';
    }

    // Tarjetas por módulo
    const html = RC.getModulos(db).map(m => {
      const letra = m.letra;
      const tecHtml = m.tecnicos.length
        ? m.tecnicos.map(t => `<span class="tec-chip">${RC.ICONOS_SVG.tecnico} ${RC.esc(t.nombre)}</span>`).join('')
        : '<span class="tec-vacio">Sin técnico asignado</span>';
      const delMod = db.turnos.filter(t => t.modulo === letra);
      const sig = delMod.find(t => t.estado === 'siguiente');
      const rep = delMod.find(t => t.estado === 'reparando');
      const esperando = delMod.filter(t => t.estado === 'espera').length;

      return `
        <article class="modulo ${sig ? 'modulo-llamando' : ''}">
          <div class="modulo-head">
            <strong>${m.nombre}${m.extra ? '<span class="nuevo">Extra</span>' : ''}</strong>
            <span class="modulo-disp">${RC.iconosDe(m.dispositivos)} ${m.dispositivos.join(' / ')}</span>
          </div>
          <div class="modulo-tec">${tecHtml}</div>
          <div class="modulo-body">
            <div class="slot ${sig ? 'activo' : ''}">
              <div class="slot-info">
                <span class="slot-title">Siguiente en Turno</span>
                <span class="num ${sig ? 'siguiente' : 'nada'}">${sig ? sig.codigo : '—'}</span>
              </div>
              ${sig ? '<span class="badge siguiente">Acercarse al banco</span>' : ''}
            </div>
            <div class="slot slot-rep ${rep ? 'activo' : ''}">
              <div class="slot-info">
                <span class="slot-title">En Reparación</span>
                <span class="num ${rep ? 'reparando' : 'nada'}">${rep ? rep.codigo : '—'}</span>
              </div>
              ${rep ? `<span class="badge reparando">${RC.esc(rep.tecnico || 'Técnico')}</span>` : ''}
            </div>
          </div>
          <div class="modulo-foot">En espera: <strong>${esperando} equipos</strong></div>
        </article>`;
    }).join('');
    if ($('#modulos')) $('#modulos').innerHTML = html;

    // Tabla general de turnos
    const filas = [...db.turnos].sort(porNumDesc).map(t => {
      const cambio = previo[t.n] && previo[t.n] !== t.estado ? 'flash' : '';
      return `<tr class="${cambio}">
        <td class="codigo">${t.codigo}</td>
        <td>${RC.getModulo(db, t.modulo).nombre}</td>
        <td><span class="celda-disp">${RC.ICONOS[t.dispositivo] || ''} <span>${t.dispositivo}</span></span></td>
        <td class="num-cedula">${RC.enmascarar(t.cedula)}</td>
        <td class="num-hora">${RC.hora(t.creado)}</td>
        <td><span class="badge ${t.estado}">${RC.ESTADOS[t.estado]}</span></td>
      </tr>`;
    }).join('');
    if ($('#tabla-turnos')) {
      $('#tabla-turnos').innerHTML = filas || '<tr><td class="vacio" colspan="6">Aún no hay turnos registrados</td></tr>';
    }

    previo = Object.fromEntries(db.turnos.map(t => [t.n, t.estado]));
  }

  const reloj = () => {
    const el = $('#reloj');
    if (el) el.textContent = new Date().toLocaleTimeString('es-EC', { hour12: false });
  };
  setInterval(reloj, 1000); reloj();

  // 1. Suscripción instantánea a eventos de cambio
  RC.onChange(db => {
    render(db);
  });

  // 2. Render inicial
  render(RC.cargar());

  // 3. Heartbeat / Poller de seguridad (cada 400ms) para garantizar 100% de actualización
  // incluso si la pestaña está en segundo plano o el navegador suspende BroadcastChannel
  setInterval(() => {
    try {
      const raw = localStorage.getItem('reparcel_db_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.ultimoCambio && parsed.ultimoCambio !== ultimoTimestamp) {
          render(parsed);
        }
      }
    } catch (e) {}
  }, 400);

  RC.iniciarMotor();
}

/* =====================================================================
   PANTALLA 4: tecnico.html (panel de taller)
   ===================================================================== */
function initTecnico() {
  const form = $('#form-tecnico');
  const errorEl = $('#error-tec');
  const selTec = $('#tec-activo');
  let tecnicoActivo = null;

  if ($('#t-cedula')) {
    $('#t-cedula').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });
  }

  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (errorEl) errorEl.textContent = '';
      const dispositivos = [...form.querySelectorAll('input[name="disp"]:checked')].map(c => c.value);
      const r = RC.registrarTecnico({
        nombre: $('#t-nombre').value,
        cedula: $('#t-cedula').value.trim(),
        dispositivos
      });
      if (!r.ok) {
        if (errorEl) errorEl.textContent = r.error;
        toast(r.error, true);
        return;
      }
      form.reset();
      toast(r.modulo ? `Técnico registrado. Se habilitó el Módulo ${r.modulo}` : 'Técnico registrado satisfactoriamente');
    });
  }

  if (selTec) {
    selTec.addEventListener('change', () => { tecnicoActivo = Number(selTec.value) || null; });
  }

  if ($('#modo-auto')) $('#modo-auto').addEventListener('click', () => RC.setModo('auto'));
  if ($('#modo-manual')) $('#modo-manual').addEventListener('click', () => RC.setModo('manual'));
  if ($('#btn-limpiar')) $('#btn-limpiar').addEventListener('click', () => { RC.limpiarFinalizados(); toast('Turnos finalizados eliminados'); });
  if ($('#btn-reiniciar')) {
    $('#btn-reiniciar').addEventListener('click', () => {
      if (confirm('¿Deseas reiniciar todos los turnos y contadores? Los técnicos se conservarán.')) {
        RC.reiniciarTodo();
        toast('Sistema y contadores reiniciados');
      }
    });
  }

  // Delegación de eventos en técnicos
  if ($('#lista-tecnicos')) {
    $('#lista-tecnicos').addEventListener('click', e => {
      const b = e.target.closest('[data-del]');
      if (b) {
        RC.eliminarTecnico(Number(b.dataset.del));
        toast('Técnico eliminado');
      }
    });
  }

  // Despacho de turnos por parte del técnico
  if ($('#tabla-gestion')) {
    $('#tabla-gestion').addEventListener('click', e => {
      const b = e.target.closest('[data-estado]');
      if (!b) return;
      const turnoId = Number(b.dataset.id);
      const nuevoEstado = b.dataset.estado;

      // Auto-seleccionar primer técnico si aún no seleccionó uno
      if (nuevoEstado === 'reparando' && !tecnicoActivo) {
        const dbActual = RC.cargar();
        if (dbActual.tecnicos.length > 0) {
          tecnicoActivo = dbActual.tecnicos[0].id;
          if (selTec) selTec.value = String(tecnicoActivo);
        }
      }

      const r = RC.cambiarEstado(turnoId, nuevoEstado, tecnicoActivo);
      if (!r.ok) {
        toast(r.error, true);
      } else {
        toast(`Turno actualizado a: ${RC.ESTADOS[nuevoEstado]}`);
      }
    });
  }

  function render(db) {
    const manual = db.modo === 'manual';
    if ($('#modo-auto')) $('#modo-auto').classList.toggle('on', !manual);
    if ($('#modo-manual')) $('#modo-manual').classList.toggle('on', manual);
    if ($('#hint-modo')) {
      $('#hint-modo').textContent = manual
        ? 'Modo manual: tú decides cuándo cambia el estado de cada turno. La pantalla de clientes se actualiza automáticamente.'
        : `Modo automático: cada turno pasa de "Siguiente" a "Listo" en ${(RC.CONFIG.tiempoSiguiente + RC.CONFIG.tiempoReparando) / 1000} segundos.`;
    }

    // Lista de técnicos
    if ($('#lista-tecnicos')) {
      $('#lista-tecnicos').innerHTML = db.tecnicos.length
        ? db.tecnicos.map(t => `<li>
            <div>
              <strong>${RC.esc(t.nombre)}</strong>
              <small>CI ${t.cedula} · ${t.dispositivos.join(', ')}<br>Módulo(s): ${RC.modulosDeTecnico(db, t).join(', ') || '—'}</small>
            </div>
            <button class="btn-x" data-del="${t.id}" title="Eliminar técnico">✕</button>
          </li>`).join('')
        : '<li class="vacio">Sin técnicos registrados</li>';
    }

    // Selector de técnico activo
    if (selTec) {
      if (!tecnicoActivo && db.tecnicos.length > 0) {
        tecnicoActivo = db.tecnicos[0].id;
      }
      selTec.innerHTML = '<option value="">— Selecciona técnico activo —</option>' +
        db.tecnicos.map(t => `<option value="${t.id}" ${t.id === tecnicoActivo ? 'selected' : ''}>${RC.esc(t.nombre)} (${t.dispositivos.join(', ')})</option>`).join('');
      if (!db.tecnicos.some(t => t.id === tecnicoActivo)) tecnicoActivo = null;
    }

    // Botones de acción según el modo
    const dis = manual ? '' : 'disabled';
    const acciones = t => {
      if (t.estado === 'espera')    return `<button class="btn-accion" ${dis} data-id="${t.n}" data-estado="siguiente" title="Llamar al banco">Llamar</button>`;
      if (t.estado === 'siguiente') return `<button class="btn-accion rep" ${dis} data-id="${t.n}" data-estado="reparando" title="Iniciar reparación">Reparar</button>
                                            <button class="btn-accion ok" ${dis} data-id="${t.n}" data-estado="listo" title="Finalizar servicio">Listo</button>`;
      if (t.estado === 'reparando') return `<button class="btn-accion ok" ${dis} data-id="${t.n}" data-estado="listo" title="Finalizar servicio">Listo</button>`;
      return '—';
    };

    const filas = [...db.turnos].sort(porNumDesc).map(t => `<tr>
        <td class="codigo">${t.codigo}</td>
        <td><span class="celda-disp">${RC.ICONOS[t.dispositivo] || ''} <span>${t.dispositivo} <small>· Mód. ${t.modulo}</small></span></span></td>
        <td>${RC.esc(t.dano)}</td>
        <td>${RC.esc(t.tecnico || '—')}</td>
        <td><span class="badge ${t.estado}">${RC.ESTADOS[t.estado]}</span></td>
        <td>${acciones(t)}</td>
      </tr>`).join('');

    if ($('#tabla-gestion')) {
      $('#tabla-gestion').innerHTML = filas || '<tr><td class="vacio" colspan="6">No hay turnos generados</td></tr>';
    }
  }

  RC.onChange(render);
  render(RC.cargar());
  RC.iniciarMotor();
}

/* ---------- Arranque según la página ---------- */
document.addEventListener('DOMContentLoaded', () => {
  const initialDb = RC.cargar();
  if (initialDb.tecnicos.length === 0) {
    RC.registrarTecnico({ nombre: 'Carlos Mendoza', cedula: '1712345678', dispositivos: ['celular', 'tablet'] });
    RC.registrarTecnico({ nombre: 'Elena Ramos', cedula: '1723456789', dispositivos: ['tablet', 'laptop'] });
    RC.registrarTecnico({ nombre: 'Javier Andrade', cedula: '1734567890', dispositivos: ['laptop', 'celular'] });
  }

  const pagina = document.body.dataset.page;
  if (pagina === 'index') initIndex();
  if (pagina === 'pantalla') initPantalla();
  if (pagina === 'tecnico') initTecnico();
});