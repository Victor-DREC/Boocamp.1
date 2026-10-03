'use strict';

/* =====================================================================
   REPARACEL - Sistema de turnos y taller de reparación
   - Sincronización multi-pantalla: BroadcastChannel + Evento 'storage' + Heartbeat
   - Soporte de flujo continuo: "En reparación" + "Siguiente en turno" simultáneos
   - Seguridad: Password general para Técnicos y Password único para Super Admin
   ===================================================================== */

const RC = (() => {

  /* ---------- Configuración ---------- */
  const CONFIG = {
    tiempoSiguiente: 5000,   // ms que un turno permanece como "Siguiente" (modo automático)
    tiempoReparando: 5000,   // ms que permanece "Reparando" -> total: 10 s hasta finalizar
    validarCedula: true
  };

  /* ---------- Autenticación ---------- */
  const AUTH_KEY = 'reparacel_auth_config_v1';
  function getAuthConfig() {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      return raw ? JSON.parse(raw) : { passTecnico: 'tecnico123', passAdmin: 'admin2026' };
    } catch {
      return { passTecnico: 'tecnico123', passAdmin: 'admin2026' };
    }
  }

  function setAuthConfig(cfg) {
    localStorage.setItem(AUTH_KEY, JSON.stringify(cfg));
  }

  function verificarPassTecnico(pass) {
    const cfg = getAuthConfig();
    return pass === cfg.passTecnico;
  }

  function verificarPassAdmin(pass) {
    const cfg = getAuthConfig();
    return pass === cfg.passAdmin;
  }

  /* ---------- Iconos SVG técnicos ---------- */
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

  const UBICACION_DEFAULT = {
    nombreLocal: 'REPARACEL · Taller Central',
    direccion: 'Av. Amazonas N24-196 y Luis Cordero',
    referencia: 'Edificio España, Local #12 (Planta Baja)',
    ciudad: 'Quito, Ecuador',
    telefono: '099 999 9999',
    horario: 'Lunes a Viernes: 09:00 – 18:00 | Sábados: 09:00 – 13:00',
    lat: -0.2038,
    lng: -78.4947
  };

  const KEY = 'reparcel_db_v1';
  const CHANNEL_NAME = 'reparacel_broadcast_channel';
  const PING_KEY = 'reparacel_ping';

  let canal = null;
  try {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      canal = new BroadcastChannel(CHANNEL_NAME);
    }
  } catch (e) {
    console.warn('BroadcastChannel no disponible en este entorno:', e);
  }

  const oyentes = [];

  /* ---------- Almacenamiento ---------- */
  const vacio = () => ({
    turnos: [],
    tecnicos: [],
    contadores: { A: 0, B: 0, C: 0 },
    seq: 0,
    extraSeq: 0,
    modo: 'auto',
    ubicacion: Object.assign({}, UBICACION_DEFAULT),
    ultimoCambio: Date.now()
  });

  function cargar() {
    try {
      const raw = localStorage.getItem(KEY);
      const db = raw ? JSON.parse(raw) : null;
      const base = vacio();
      if (db) {
        return Object.assign(base, db, {
          ubicacion: Object.assign({}, UBICACION_DEFAULT, db.ubicacion || {})
        });
      }
      return base;
    } catch {
      return vacio();
    }
  }

  function getUbicacion(db) {
    const d = db || cargar();
    return Object.assign({}, UBICACION_DEFAULT, d.ubicacion || {});
  }

  function actualizarUbicacion(nueva) {
    const db = cargar();
    db.ubicacion = Object.assign(getUbicacion(db), nueva);
    guardar(db, { accion: 'actualizar_ubicacion' });
    return db.ubicacion;
  }

  function guardar(db, metadata = {}) {
    db.ultimoCambio = Date.now();
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
      localStorage.setItem(PING_KEY, String(db.ultimoCambio));
    } catch (e) {
      console.error('Error al guardar en localStorage:', e);
    }

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

    oyentes.forEach(fn => {
      try { fn(db); } catch (e) { console.error('Error en oyente:', e); }
    });
  }

  function onChange(fn) {
    oyentes.push(fn);
  }

  /* ---------- Recepción multi-pantalla ---------- */
  if (canal) {
    canal.addEventListener('message', (event) => {
      try {
        const dbRecibida = (event && event.data && event.data.db) ? event.data.db : cargar();
        oyentes.forEach(fn => {
          try { fn(dbRecibida); } catch (e) { console.error(e); }
        });
      } catch (err) {
        console.error(err);
      }
    });
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key === KEY || event.key === PING_KEY) {
        try {
          const dbActualizada = cargar();
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

    // Si el módulo NO tiene actualmente un turno en 'siguiente', este puede entrar a 'siguiente' si tampoco hay esperando
    const tieneSiguiente = db.turnos.some(t => t.modulo === modulo && t.estado === 'siguiente');
    const estadoInicial = tieneSiguiente ? 'espera' : 'espera'; // Se mantiene en espera y el motor o llamado lo promueve

    const turno = {
      n: db.seq,
      codigo: `${modulo}-${String(db.contadores[modulo]).padStart(3, '0')}`,
      modulo, cedula, dispositivo,
      dano,
      estado: estadoInicial,
      tecnico: null,
      creado: Date.now(),
      estadoDesde: Date.now()
    };
    db.turnos.push(turno);

    // Si no había ningún turno en siguiente en este módulo, promover inmediatamente a siguiente
    if (!tieneSiguiente) {
      turno.estado = 'siguiente';
      turno.estadoDesde = Date.now();
    }

    guardar(db, { accion: 'crear_turno', id: turno.n, estado: turno.estado });

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

  /* ---------- Cambiar Estado con Promoción Automática ---------- */
  function cambiarEstado(id, estado, tecnicoId) {
    const db = cargar();
    const t = db.turnos.find(x => x.n === id);
    if (!t) return { ok: false, error: 'Turno no encontrado.' };

    // Un módulo puede tener como máximo 1 en 'siguiente'
    if (estado === 'siguiente') {
      const otroSiguiente = db.turnos.find(x => x.modulo === t.modulo && x.n !== id && x.estado === 'siguiente');
      if (otroSiguiente) {
        return { ok: false, error: `El ${getModulo(db, t.modulo).nombre} ya tiene el turno ${otroSiguiente.codigo} como Siguiente.` };
      }
    }

    // Un módulo puede tener como máximo 1 en 'reparando'
    if (estado === 'reparando') {
      const otroReparando = db.turnos.find(x => x.modulo === t.modulo && x.n !== id && x.estado === 'reparando');
      if (otroReparando) {
        return { ok: false, error: `El ${getModulo(db, t.modulo).nombre} ya tiene el turno ${otroReparando.codigo} en reparación.` };
      }

      let tec = db.tecnicos.find(x => x.id === tecnicoId);
      if (!tec && db.tecnicos.length > 0) {
        const mod = getModulo(db, t.modulo);
        tec = mod.tecnicos.find(x => x.dispositivos.includes(t.dispositivo)) || db.tecnicos[0];
      }
      if (!tec) return { ok: false, error: 'Selecciona un técnico activo antes de iniciar la reparación.' };
      if (!tec.dispositivos.includes(t.dispositivo)) {
        return { ok: false, error: `${tec.nombre} no está certificado para trabajar con ${t.dispositivo}s.` };
      }
      const mod = getModulo(db, t.modulo);
      if (mod.tecnicos.length && !mod.tecnicos.some(x => x.id === tec.id)) {
        return { ok: false, error: `${tec.nombre} no está asignado al ${mod.nombre}.` };
      }
      t.tecnico = tec.nombre;
    }

    t.estado = estado;
    t.estadoDesde = Date.now();

    // =========================================================================
    // REGLA SOLICITADA: Cuando un cliente se va a "en reparación", aparece el
    // siguiente cliente al turno en todos los módulos inmediatamente.
    // =========================================================================
    if (estado === 'reparando') {
      // En TODOS los módulos: si un módulo tiene clientes esperando y no tiene turno como 'siguiente',
      // promover inmediatamente al siguiente turno en espera a 'siguiente'
      const modulos = getModulos(db);
      modulos.forEach(m => {
        const tieneSiguiente = db.turnos.some(x => x.modulo === m.letra && x.estado === 'siguiente');
        if (!tieneSiguiente) {
          const proxEspera = db.turnos
            .filter(x => x.modulo === m.letra && x.estado === 'espera' && x.n !== t.n)
            .sort((a, b) => a.n - b.n)[0];
          if (proxEspera) {
            proxEspera.estado = 'siguiente';
            proxEspera.estadoDesde = Date.now();
          }
        }
      });
    }

    // Si finalizó (listo) y el módulo quedó sin 'siguiente', promover el siguiente de espera
    if (estado === 'listo') {
      const tieneSiguiente = db.turnos.some(x => x.modulo === t.modulo && x.estado === 'siguiente');
      if (!tieneSiguiente) {
        const proxEspera = db.turnos
          .filter(x => x.modulo === t.modulo && x.estado === 'espera')
          .sort((a, b) => a.n - b.n)[0];
        if (proxEspera) {
          proxEspera.estado = 'siguiente';
          proxEspera.estadoDesde = Date.now();
        }
      }
    }

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

  /* ---------- Técnicos (Gestión exclusiva Super Admin) ---------- */
  function registrarTecnico({ nombre, cedula, dispositivos }) {
    if (!nombre || nombre.trim().length < 3) return { ok: false, error: 'Ingresa el nombre del técnico (mínimo 3 letras).' };
    if (!validarCedula(cedula)) return { ok: false, error: 'La cédula ingresada debe tener exactamente 10 dígitos numéricos.' };
    if (!dispositivos || !dispositivos.length) return { ok: false, error: 'Selecciona al menos un tipo de dispositivo.' };

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

  function editarTecnico({ id, nombre, cedula, dispositivos }) {
    if (!nombre || nombre.trim().length < 3) return { ok: false, error: 'Ingresa un nombre válido (mínimo 3 letras).' };
    if (!validarCedula(cedula)) return { ok: false, error: 'La cédula debe tener exactamente 10 dígitos numéricos.' };
    if (!dispositivos || !dispositivos.length) return { ok: false, error: 'Selecciona al menos un dispositivo.' };

    const db = cargar();
    const tec = db.tecnicos.find(t => t.id === id);
    if (!tec) return { ok: false, error: 'Técnico no encontrado.' };

    if (db.tecnicos.some(t => t.id !== id && t.cedula === cedula)) {
      return { ok: false, error: 'Ya existe otro técnico registrado con esa cédula.' };
    }

    tec.nombre = nombre.trim();
    tec.cedula = cedula.trim();
    tec.dispositivos = dispositivos;
    guardar(db, { accion: 'editar_tecnico', id });
    return { ok: true };
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
        // Pasa a reparando
        t.estado = 'reparando';
        t.estadoDesde = ahora;
        t.tecnico = t.tecnico || tecnicoDeModulo(db, t) || 'Taller Central';
        cambio = true;

        // INMEDIATO: promover el siguiente en espera de ese módulo a 'siguiente'
        const prox = db.turnos
          .filter(x => x.modulo === t.modulo && x.estado === 'espera')
          .sort((a, b) => a.n - b.n)[0];
        if (prox) {
          prox.estado = 'siguiente';
          prox.estadoDesde = ahora;
        }
      } else if (t.estado === 'reparando' && ahora - t.estadoDesde >= CONFIG.tiempoReparando) {
        t.estado = 'listo';
        t.estadoDesde = ahora;
        cambio = true;
      }
    });

    // En cualquier módulo que no tenga turno en 'siguiente', promover el primero de espera
    getModulos(db).forEach(({ letra: m }) => {
      const tieneSiguiente = db.turnos.some(t => t.modulo === m && t.estado === 'siguiente');
      if (!tieneSiguiente) {
        const prox = db.turnos.filter(t => t.modulo === m && t.estado === 'espera').sort((a, b) => a.n - b.n)[0];
        if (prox) {
          prox.estado = 'siguiente';
          prox.estadoDesde = ahora;
          cambio = true;
        }
      }
    });

    if (cambio) guardar(db, { accion: 'tick_auto' });
  }

  const iniciarMotor = () => setInterval(tick, 1000);

  return {
    KEY, CHANNEL_NAME, PING_KEY,
    CONFIG, MODULOS, ICONOS, ICONOS_SVG, ESTADOS, DANOS, activo,
    getModulos, getModulo, moduloPara, modulosDeTecnico, iconosDe,
    cargar, guardar, onChange, iniciarMotor,
    crearTurno, cambiarEstado, setModo, limpiarFinalizados, reiniciarTodo,
    registrarTecnico, editarTecnico, eliminarTecnico,
    UBICACION_DEFAULT, getUbicacion, actualizarUbicacion,
    getAuthConfig, setAuthConfig, verificarPassTecnico, verificarPassAdmin,
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

  /* ---------- Mapa Embebido sin API y Cómo Llegar al Taller ---------- */
  function generarUrlOsmEmbed(lat, lng) {
    const deltaLat = 0.005;
    const deltaLng = 0.008;
    const minLon = (lng - deltaLng).toFixed(5);
    const minLat = (lat - deltaLat).toFixed(5);
    const maxLon = (lng + deltaLng).toFixed(5);
    const maxLat = (lat + deltaLat).toFixed(5);
    return `https://www.openstreetmap.org/export/embed.html?bbox=${minLon}%2C${minLat}%2C${maxLon}%2C${maxLat}&layer=mapnik&marker=${lat.toFixed(5)}%2C${lng.toFixed(5)}`;
  }

  function generarUrlRutaOsmEmbed(lat1, lon1, lat2, lon2) {
    const minLon = (Math.min(lon1, lon2) - 0.01).toFixed(5);
    const maxLon = (Math.max(lon1, lon2) + 0.01).toFixed(5);
    const minLat = (Math.min(lat1, lat2) - 0.01).toFixed(5);
    const maxLat = (Math.max(lat1, lat2) + 0.01).toFixed(5);
    return `https://www.openstreetmap.org/export/embed.html?bbox=${minLon}%2C${minLat}%2C${maxLon}%2C${maxLat}&layer=mapnik&marker=${lat2.toFixed(5)}%2C${lon2.toFixed(5)}`;
  }

  function actualizarTextosUbicacion(ubicacion) {
    if ($('#info-horario')) $('#info-horario').innerHTML = RC.esc(ubicacion.horario).replace(/\|/g, '<br>');
    if ($('#info-ubicacion')) $('#info-ubicacion').innerHTML = `${RC.esc(ubicacion.direccion)}<br>${RC.esc(ubicacion.ciudad)}` + (ubicacion.referencia ? `<br><small style="color:var(--muted);">${RC.esc(ubicacion.referencia)}</small>` : '');
    if ($('#info-contacto')) $('#info-contacto').innerHTML = `Tel: ${RC.esc(ubicacion.telefono)}<br>soporte@reparacel.com`;
    if ($('#mapa-titulo-local')) $('#mapa-titulo-local').textContent = ubicacion.nombreLocal;
    if ($('#btn-abrir-gmaps')) {
      $('#btn-abrir-gmaps').href = `https://www.google.com/maps/dir/?api=1&destination=${ubicacion.lat},${ubicacion.lng}`;
    }
    const iframe = $('#mapa-iframe');
    if (iframe) {
      iframe.src = generarUrlOsmEmbed(ubicacion.lat, ubicacion.lng);
    }
  }

  function initMapa() {
    const iframe = $('#mapa-iframe');
    const u = RC.getUbicacion();
    actualizarTextosUbicacion(u);

    if ($('#btn-mi-gps')) {
      $('#btn-mi-gps').addEventListener('click', () => {
        if (!navigator.geolocation) {
          toast('La geolocalización no es soportada por tu navegador', true);
          return;
        }
        toast('Obteniendo tu posición GPS actual...');
        navigator.geolocation.getCurrentPosition(
          pos => {
            const { latitude, longitude } = pos.coords;
            const input = $('#input-origen-ruta');
            if (input) input.value = `Mi GPS (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
            aplicarRuta(latitude, longitude, `${latitude},${longitude}`);
            toast('Ruta lista. Presiona Iniciar Ruta para navegar');
          },
          () => {
            toast('No se pudo acceder a tu GPS. Escribe tu dirección de partida.', true);
          },
          { enableHighAccuracy: true, timeout: 8000 }
        );
      });
    }

    if ($('#btn-trazar-ruta')) {
      $('#btn-trazar-ruta').addEventListener('click', () => {
        const input = $('#input-origen-ruta');
        const val = input ? input.value.trim() : '';
        if (!val) {
          toast('Ingresa tu punto de partida', true);
          return;
        }
        const partes = val.split(',');
        if (partes.length === 2 && !isNaN(parseFloat(partes[0])) && !isNaN(parseFloat(partes[1]))) {
          aplicarRuta(parseFloat(partes[0]), parseFloat(partes[1]), val);
        } else {
          aplicarRuta(null, null, val);
        }
      });
    }

    if ($('#btn-limpiar-ruta')) {
      $('#btn-limpiar-ruta').addEventListener('click', () => {
        const curU = RC.getUbicacion();
        if (iframe) iframe.src = generarUrlOsmEmbed(curU.lat, curU.lng);
        if ($('#input-origen-ruta')) $('#input-origen-ruta').value = '';
        if ($('#ruta-stats')) $('#ruta-stats').hidden = true;
        if ($('#btn-limpiar-ruta')) $('#btn-limpiar-ruta').hidden = true;
      });
    }

    function aplicarRuta(origLat, origLng, textoOrigen) {
      const curU = RC.getUbicacion();
      if (iframe && origLat !== null && origLng !== null) {
        iframe.src = generarUrlRutaOsmEmbed(origLat, origLng, curU.lat, curU.lng);

        const R = 6371;
        const dLat = (curU.lat - origLat) * Math.PI / 180;
        const dLon = (curU.lng - origLng) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(origLat * Math.PI / 180) * Math.cos(curU.lat * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const distKm = (R * c).toFixed(1);

        if ($('#stat-distancia')) $('#stat-distancia').textContent = `${distKm} km`;
        if ($('#stat-distancia-wrap')) $('#stat-distancia-wrap').hidden = false;
        if ($('#stat-tiempo')) $('#stat-tiempo').textContent = `~${Math.round(distKm * 2.5)} min en auto`;
        if ($('#stat-tiempo-wrap')) $('#stat-tiempo-wrap').hidden = false;
      } else {
        if ($('#stat-distancia-wrap')) $('#stat-distancia-wrap').hidden = true;
        if ($('#stat-tiempo-wrap')) $('#stat-tiempo-wrap').hidden = true;
      }

      if ($('#stat-destino')) $('#stat-destino').textContent = curU.nombreLocal;
      if ($('#btn-link-gps-directo')) {
        $('#btn-link-gps-directo').href = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(textoOrigen)}&destination=${curU.lat},${curU.lng}&travelmode=driving`;
      }
      if ($('#ruta-stats')) $('#ruta-stats').hidden = false;
      if ($('#btn-limpiar-ruta')) $('#btn-limpiar-ruta').hidden = false;
    }
  }

  initMapa();

  RC.onChange(db => {
    if (db && db.ubicacion) {
      actualizarTextosUbicacion(db.ubicacion);
    }
  });
}

/* =====================================================================
   PANTALLA 3: pantalla.html (cliente - FLUJO CONTINUO Y ALTA VISIBILIDAD)
   ===================================================================== */
function initPantalla() {
  let previo = {};
  let ultimoTimestamp = 0;

  function render(db) {
    if (!db) return;
    ultimoTimestamp = db.ultimoCambio || Date.now();

    const chipModo = $('#chip-modo');
    if (chipModo) {
      chipModo.textContent = db.modo === 'auto' ? 'Modo: Automático' : 'Modo: Manual (Técnico)';
      chipModo.className = db.modo === 'auto' ? 'chip' : 'chip chip-manual';
    }

    const html = RC.getModulos(db).map(m => {
      const letra = m.letra;
      const tecHtml = m.tecnicos.length
        ? m.tecnicos.map(t => `<span class="tec-chip">${RC.ICONOS_SVG.tecnico} ${RC.esc(t.nombre)}</span>`).join('')
        : '<span class="tec-vacio">Sin técnico asignado</span>';
      
      const delMod = db.turnos.filter(t => t.modulo === letra);
      const rep = delMod.find(t => t.estado === 'reparando');
      // Siguiente en Turno: el que esté en 'siguiente' o el primer turno en espera que no sea el que se está reparando
      const sig = delMod.find(t => t.estado === 'siguiente') || delMod.find(t => t.estado === 'espera' && (!rep || t.n !== rep.n));
      const esperando = delMod.filter(t => t.estado === 'espera' && (!sig || t.n !== sig.n)).length;

      return `
        <article class="modulo ${sig && sig.estado === 'siguiente' ? 'modulo-llamando' : ''}">
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
              ${sig && sig.estado === 'siguiente' ? '<span class="badge siguiente">Acercarse al banco</span>' : ''}
              ${sig && sig.estado === 'espera' ? '<span class="badge espera">En cola</span>' : ''}
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

  function pulsarSincronizacion() {
    const chip = $('#chip-sync');
    if (chip) {
      chip.classList.add('pulse-sync');
      setTimeout(() => chip.classList.remove('pulse-sync'), 600);
    }
  }

  // 1. Escuchar actualizaciones por el canal central
  RC.onChange(db => {
    render(db);
    pulsarSincronizacion();
  });

  // 2. Conexión de BroadcastChannel directa e independiente para pantalla.html
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    try {
      const canalPantalla = new BroadcastChannel(RC.CHANNEL_NAME || 'reparacel_broadcast_channel');
      canalPantalla.addEventListener('message', (event) => {
        if (event && event.data) {
          const db = event.data.db || RC.cargar();
          render(db);
          pulsarSincronizacion();
        }
      });
    } catch (e) {
      console.warn('Error conectando canal directo en pantalla:', e);
    }
  }

  // 3. Render inicial
  render(RC.cargar());

  // 4. Poller de alta fidelidad para sincronización continua sin pérdidas
  setInterval(() => {
    try {
      const raw = localStorage.getItem(RC.KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.ultimoCambio && parsed.ultimoCambio !== ultimoTimestamp) {
          render(parsed);
          pulsarSincronizacion();
        }
      }
    } catch (e) {}
  }, 250);

  RC.iniciarMotor();
}

/* =====================================================================
   PANTALLA 4: tecnico.html (panel con acceso por CONTRASEÑA GENERAL)
   ===================================================================== */
function initTecnico() {
  const bloqueLogin = $('#bloque-login-tec');
  const bloquePanel = $('#bloque-panel-tec');
  const formLogin = $('#form-login-tec');
  const errLogin = $('#error-login-tec');
  const btnLogout = $('#btn-logout-tec');

  // Control de sesión de técnico
  function estaAutenticado() {
    return sessionStorage.getItem('reparacel_tec_auth') === 'true';
  }

  function actualizarVistaAuth() {
    const auth = estaAutenticado();
    if (bloqueLogin) bloqueLogin.hidden = auth;
    if (bloquePanel) bloquePanel.hidden = !auth;
    if (btnLogout) btnLogout.hidden = !auth;
    if (auth) render(RC.cargar());
  }

  if (formLogin) {
    formLogin.addEventListener('submit', e => {
      e.preventDefault();
      errLogin.textContent = '';
      const pass = $('#pass-tec').value;
      if (RC.verificarPassTecnico(pass)) {
        sessionStorage.setItem('reparacel_tec_auth', 'true');
        $('#pass-tec').value = '';
        actualizarVistaAuth();
        toast('Acceso concedido al panel técnico');
      } else {
        errLogin.textContent = 'Contraseña incorrecta. (Por defecto: tecnico123)';
      }
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      sessionStorage.removeItem('reparacel_tec_auth');
      actualizarVistaAuth();
      toast('Sesión de técnico finalizada');
    });
  }

  const selTec = $('#tec-activo');
  let tecnicoActivo = null;

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

  // Despacho de turnos por parte del técnico
  if ($('#tabla-gestion')) {
    $('#tabla-gestion').addEventListener('click', e => {
      const b = e.target.closest('[data-estado]');
      if (!b) return;
      const turnoId = Number(b.dataset.id);
      const nuevoEstado = b.dataset.estado;

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
    if (!estaAutenticado()) return;
    const manual = db.modo === 'manual';
    if ($('#modo-auto')) $('#modo-auto').classList.toggle('on', !manual);
    if ($('#modo-manual')) $('#modo-manual').classList.toggle('on', manual);
    if ($('#hint-modo')) {
      $('#hint-modo').textContent = manual
        ? 'Modo manual: tú decides cuándo cambia el estado de cada turno. Al pasar a "Reparar", el siguiente en espera aparece automáticamente en la pantalla de clientes.'
        : `Modo automático: cada turno pasa de "Siguiente" a "Listo" en ${(RC.CONFIG.tiempoSiguiente + RC.CONFIG.tiempoReparando) / 1000} segundos.`;
    }

    if (selTec) {
      if (!tecnicoActivo && db.tecnicos.length > 0) {
        tecnicoActivo = db.tecnicos[0].id;
      }
      selTec.innerHTML = '<option value="">— Selecciona técnico activo —</option>' +
        db.tecnicos.map(t => `<option value="${t.id}" ${t.id === tecnicoActivo ? 'selected' : ''}>${RC.esc(t.nombre)} (${t.dispositivos.join(', ')})</option>`).join('');
      if (!db.tecnicos.some(t => t.id === tecnicoActivo)) tecnicoActivo = null;
    }

    const dis = manual ? '' : 'disabled';
    const acciones = t => {
      if (t.estado === 'espera')    return `<button class="btn-accion" ${dis} data-id="${t.n}" data-estado="siguiente" title="Llamar al banco">Llamar</button>`;
      if (t.estado === 'siguiente') return `<button class="btn-accion rep" ${dis} data-id="${t.n}" data-estado="reparando" title="Iniciar reparación (promueve al siguiente de espera)">Reparar</button>
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
  actualizarVistaAuth();
  RC.iniciarMotor();
}

/* =====================================================================
   PANTALLA 5: admin.html (PANEL SUPER ADMIN CON CONTRASEÑA ÚNICA)
   ===================================================================== */
function initAdmin() {
  const bloqueLogin = $('#bloque-login-admin');
  const bloqueAdmin = $('#bloque-panel-admin');
  const formLogin = $('#form-login-admin');
  const errLogin = $('#error-login-admin');
  const btnLogout = $('#btn-logout-admin');

  const formTecnico = $('#form-admin-tecnico');
  const errTec = $('#error-admin-tec');
  const listaTec = $('#lista-admin-tecnicos');
  const modalEdit = $('#modal-edit-tecnico');
  const formEdit = $('#form-edit-tecnico');

  function estaAutenticado() {
    return sessionStorage.getItem('reparacel_admin_auth') === 'true';
  }

  function actualizarVistaAuth() {
    const auth = estaAutenticado();
    if (bloqueLogin) bloqueLogin.hidden = auth;
    if (bloqueAdmin) bloqueAdmin.hidden = !auth;
    if (btnLogout) btnLogout.hidden = !auth;
    if (auth) render(RC.cargar());
  }

  if (formLogin) {
    formLogin.addEventListener('submit', e => {
      e.preventDefault();
      errLogin.textContent = '';
      const pass = $('#pass-admin').value;
      if (RC.verificarPassAdmin(pass)) {
        sessionStorage.setItem('reparacel_admin_auth', 'true');
        $('#pass-admin').value = '';
        actualizarVistaAuth();
        toast('Bienvenido al Panel Super Admin');
      } else {
        errLogin.textContent = 'Contraseña de Super Admin incorrecta. (Por defecto: admin2026)';
      }
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      sessionStorage.removeItem('reparacel_admin_auth');
      actualizarVistaAuth();
      toast('Sesión de Super Admin cerrada');
    });
  }

  // Registrar técnico nuevo
  if (formTecnico) {
    if ($('#adm-cedula')) {
      $('#adm-cedula').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });
    }

    formTecnico.addEventListener('submit', e => {
      e.preventDefault();
      errTec.textContent = '';
      const dispositivos = [...formTecnico.querySelectorAll('input[name="disp"]:checked')].map(c => c.value);
      const r = RC.registrarTecnico({
        nombre: $('#adm-nombre').value,
        cedula: $('#adm-cedula').value.trim(),
        dispositivos
      });
      if (!r.ok) {
        errTec.textContent = r.error;
        toast(r.error, true);
        return;
      }
      formTecnico.reset();
      toast(r.modulo ? `Técnico registrado. Se habilitó el Módulo ${r.modulo}` : 'Técnico registrado satisfactoriamente');
    });
  }

  // Acciones en la lista: Editar / Eliminar
  if (listaTec) {
    listaTec.addEventListener('click', e => {
      const btnDel = e.target.closest('[data-del]');
      if (btnDel) {
        const id = Number(btnDel.dataset.del);
        if (confirm('¿Estás seguro de eliminar este técnico de la nómina?')) {
          RC.eliminarTecnico(id);
          toast('Técnico eliminado de la nómina');
        }
        return;
      }

      const btnEdit = e.target.closest('[data-edit]');
      if (btnEdit) {
        const id = Number(btnEdit.dataset.edit);
        abrirModalEditar(id);
      }
    });
  }

  function abrirModalEditar(id) {
    const db = RC.cargar();
    const tec = db.tecnicos.find(t => t.id === id);
    if (!tec || !modalEdit) return;

    $('#edit-id').value = tec.id;
    $('#edit-nombre').value = tec.nombre;
    $('#edit-cedula').value = tec.cedula;

    formEdit.querySelectorAll('input[name="edit-disp"]').forEach(chk => {
      chk.checked = tec.dispositivos.includes(chk.value);
    });

    $('#error-edit-tec').textContent = '';
    modalEdit.hidden = false;
  }

  if ($('#btn-cancel-edit')) {
    $('#btn-cancel-edit').addEventListener('click', () => {
      if (modalEdit) modalEdit.hidden = true;
    });
  }

  if (formEdit) {
    if ($('#edit-cedula')) {
      $('#edit-cedula').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });
    }

    formEdit.addEventListener('submit', e => {
      e.preventDefault();
      const id = Number($('#edit-id').value);
      const nombre = $('#edit-nombre').value;
      const cedula = $('#edit-cedula').value.trim();
      const dispositivos = [...formEdit.querySelectorAll('input[name="edit-disp"]:checked')].map(c => c.value);

      const r = RC.editarTecnico({ id, nombre, cedula, dispositivos });
      if (!r.ok) {
        $('#error-edit-tec').textContent = r.error;
        toast(r.error, true);
        return;
      }

      modalEdit.hidden = true;
      toast('Técnico actualizado correctamente');
    });
  }

  // Configuración de contraseñas
  const formPass = $('#form-passwords');
  if (formPass) {
    formPass.addEventListener('submit', e => {
      e.preventDefault();
      const passTec = $('#cfg-pass-tec').value.trim();
      const passAdm = $('#cfg-pass-adm').value.trim();
      if (!passTec || !passAdm) {
        toast('Las contraseñas no pueden estar vacías', true);
        return;
      }
      RC.setAuthConfig({ passTecnico: passTec, passAdmin: passAdm });
      toast('Contraseñas de acceso actualizadas');
    });
  }

  // Configuración de Ubicación y Dirección del Local
  const formUbicacion = $('#form-ubicacion-admin');
  if (formUbicacion) {
    formUbicacion.addEventListener('submit', e => {
      e.preventDefault();
      const u = {
        nombreLocal: $('#adm-loc-nombre').value.trim(),
        direccion: $('#adm-loc-direccion').value.trim(),
        referencia: $('#adm-loc-referencia').value.trim(),
        ciudad: $('#adm-loc-ciudad').value.trim(),
        telefono: $('#adm-loc-telefono').value.trim(),
        horario: $('#adm-loc-horario').value.trim(),
        lat: parseFloat($('#adm-loc-lat').value) || RC.UBICACION_DEFAULT.lat,
        lng: parseFloat($('#adm-loc-lng').value) || RC.UBICACION_DEFAULT.lng
      };
      RC.actualizarUbicacion(u);
      toast('Ubicación y dirección del taller actualizadas');
    });

    if ($('#btn-gps-admin')) {
      $('#btn-gps-admin').addEventListener('click', () => {
        if (!navigator.geolocation) {
          toast('Geolocalización no soportada', true);
          return;
        }
        toast('Obteniendo coordenadas GPS...');
        navigator.geolocation.getCurrentPosition(
          pos => {
            $('#adm-loc-lat').value = pos.coords.latitude.toFixed(6);
            $('#adm-loc-lng').value = pos.coords.longitude.toFixed(6);
            toast('Coordenadas capturadas con éxito');
          },
          () => toast('No se pudo acceder al GPS', true)
        );
      });
    }
  }

  function render(db) {
    if (!estaAutenticado()) return;

    if (listaTec) {
      listaTec.innerHTML = db.tecnicos.length
        ? db.tecnicos.map(t => `
            <li class="admin-tec-item">
              <div>
                <strong>${RC.esc(t.nombre)}</strong>
                <small>CI ${t.cedula} · Línea(s): ${t.dispositivos.join(', ')}<br>Módulo: ${RC.modulosDeTecnico(db, t).join(', ') || 'Base'}</small>
              </div>
              <div class="admin-tec-actions">
                <button class="btn-sm btn-edit" data-edit="${t.id}" title="Editar técnico">Editar</button>
                <button class="btn-sm btn-del" data-del="${t.id}" title="Eliminar técnico">Eliminar</button>
              </div>
            </li>`).join('')
        : '<li class="vacio">Sin técnicos registrados en la nómina</li>';
    }

    const cfg = RC.getAuthConfig();
    if ($('#cfg-pass-tec')) $('#cfg-pass-tec').value = cfg.passTecnico;
    if ($('#cfg-pass-adm')) $('#cfg-pass-adm').value = cfg.passAdmin;

    const u = RC.getUbicacion(db);
    if ($('#adm-loc-nombre')) $('#adm-loc-nombre').value = u.nombreLocal;
    if ($('#adm-loc-direccion')) $('#adm-loc-direccion').value = u.direccion;
    if ($('#adm-loc-referencia')) $('#adm-loc-referencia').value = u.referencia;
    if ($('#adm-loc-ciudad')) $('#adm-loc-ciudad').value = u.ciudad;
    if ($('#adm-loc-telefono')) $('#adm-loc-telefono').value = u.telefono;
    if ($('#adm-loc-horario')) $('#adm-loc-horario').value = u.horario;
    if ($('#adm-loc-lat')) $('#adm-loc-lat').value = u.lat;
    if ($('#adm-loc-lng')) $('#adm-loc-lng').value = u.lng;
  }

  RC.onChange(render);
  actualizarVistaAuth();
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
  if (pagina === 'admin') initAdmin();
});