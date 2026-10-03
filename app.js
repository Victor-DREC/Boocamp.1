'use strict';

/* =====================================================================
   REPARACEL - Sistema de turnos
   - Datos: localStorage (persisten al recargar)
   - Sincronización entre pantallas: BroadcastChannel
   ===================================================================== */

const RC = (() => {

  /* ---------- Configuración ---------- */
  const CONFIG = {
    tiempoSiguiente: 5000,   // ms que un turno permanece como "Siguiente" (modo automático)
    tiempoReparando: 5000,   // ms que permanece "Reparando"  -> total: 10 s hasta finalizar
    validarCedula: true      // false = acepta cualquier número de 10 dígitos (útil para pruebas)
  };

  const MODULOS = {
    A: { dispositivo: 'celular', nombre: 'Módulo A', icono: '📱' },
    B: { dispositivo: 'tablet',  nombre: 'Módulo B', icono: '📟' },
    C: { dispositivo: 'laptop',  nombre: 'Módulo C', icono: '💻' }
  };

  const ICONOS = { celular: '📱', tablet: '📟', laptop: '💻' };

  const ESTADOS = {
    espera:    'En espera',
    siguiente: 'Siguiente',
    reparando: 'Reparando',
    listo:     'Listo'
  };

  // Opciones que el cliente puede elegir (ya no se escribe texto libre)
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
  const canal = ('BroadcastChannel' in window) ? new BroadcastChannel('reparcel') : null;
  const oyentes = [];

  /* ---------- Almacenamiento ---------- */
  const vacio = () => ({ turnos: [], tecnicos: [], contadores: { A: 0, B: 0, C: 0 }, seq: 0, extraSeq: 0, modo: 'auto' });

  function cargar() {
    try {
      const db = JSON.parse(localStorage.getItem(KEY));
      return db ? Object.assign(vacio(), db) : vacio();
    } catch { return vacio(); }
  }

  function guardar(db) {
    localStorage.setItem(KEY, JSON.stringify(db));
    if (canal) canal.postMessage({ tipo: 'actualizado', t: Date.now() });
    oyentes.forEach(fn => fn(db));          // BroadcastChannel no notifica a la misma pestaña
  }

  function onChange(fn) { oyentes.push(fn); }
  if (canal) canal.onmessage = () => { const db = cargar(); oyentes.forEach(fn => fn(db)); };

  /* ---------- Utilidades ---------- */
  /* ---------- Módulos dinámicos ----------
     A, B y C son los módulos base (uno por dispositivo). En ellos se muestran los
     técnicos "base" (los 3 primeros registrados) que trabajan con ese dispositivo.
     Desde el 4.º técnico se crea un módulo nuevo (D, E, F...) con sus dispositivos. */
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

  const iconosDe = disps => disps.map(d => ICONOS[d]).join(' ');

  // Elige el módulo con menos turnos pendientes entre los que atienden ese dispositivo
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
    if (!validarCedula(cedula)) return { ok: false, error: 'La cédula ingresada no es válida.' };
    if (!ICONOS[dispositivo]) return { ok: false, error: 'Selecciona un tipo de dispositivo.' };
    if (!DANOS.includes(dano)) return { ok: false, error: 'Selecciona el tipo de daño o servicio.' };

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
    guardar(db);

    const adelante = db.turnos.filter(t => t.modulo === modulo && t.n < turno.n && t.estado !== 'listo').length;
    return { ok: true, turno, adelante };
  }

  // Técnico del módulo del turno (prefiere uno que no esté reparando otro equipo)
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

    // Un solo turno activo por módulo (un técnico por módulo)
    if (estado === 'siguiente' && db.turnos.some(x => x.modulo === t.modulo && x.n !== id && activo(x))) {
      return { ok: false, error: `El ${getModulo(db, t.modulo).nombre} ya tiene un turno en atención.` };
    }

    if (estado === 'reparando') {
      const tec = db.tecnicos.find(x => x.id === tecnicoId);
      if (!tec) return { ok: false, error: 'Selecciona un técnico activo antes de iniciar la reparación.' };
      if (!tec.dispositivos.includes(t.dispositivo)) {
        return { ok: false, error: `${tec.nombre} no trabaja con ${t.dispositivo}s.` };
      }
      const mod = getModulo(db, t.modulo);
      if (mod.tecnicos.length && !mod.tecnicos.some(x => x.id === tec.id)) {
        return { ok: false, error: `${tec.nombre} no está asignado al ${mod.nombre}.` };
      }
      t.tecnico = tec.nombre;
    }

    t.estado = estado;
    t.estadoDesde = Date.now();
    guardar(db);
    return { ok: true };
  }

  function setModo(modo) {
    const db = cargar();
    db.modo = modo;
    db.turnos.forEach(t => { if (activo(t)) t.estadoDesde = Date.now(); });
    guardar(db);
  }

  function limpiarFinalizados() {
    const db = cargar();
    db.turnos = db.turnos.filter(t => t.estado !== 'listo');
    guardar(db);
  }

  function reiniciarTodo() {
    const db = cargar();
    guardar(Object.assign(vacio(), { tecnicos: db.tecnicos, extraSeq: db.extraSeq, modo: db.modo }));
  }

  /* ---------- Técnicos ---------- */
  function registrarTecnico({ nombre, cedula, dispositivos }) {
    if (!nombre || nombre.trim().length < 3) return { ok: false, error: 'Ingresa el nombre del técnico.' };
    if (!validarCedula(cedula)) return { ok: false, error: 'La cédula ingresada no es válida.' };
    if (!dispositivos.length) return { ok: false, error: 'Selecciona al menos un dispositivo.' };

    const db = cargar();
    if (db.tecnicos.some(t => t.cedula === cedula)) return { ok: false, error: 'Ya existe un técnico con esa cédula.' };

    // Los 3 primeros técnicos (base) se muestran en los módulos A/B/C según sus dispositivos.
    // Desde el 4.º se crea un módulo nuevo (D, E, F...) para ese técnico.
    const id = Math.max(Date.now(), ...db.tecnicos.map(t => t.id + 1));
    const nuevo = { id, nombre: nombre.trim(), cedula, dispositivos, modulo: null };
    const base = db.tecnicos.filter(t => !t.modulo).length;
    if (base >= 3) {
      if (db.extraSeq >= 23) return { ok: false, error: 'Se alcanzó el máximo de módulos.' };
      nuevo.modulo = String.fromCharCode(68 + db.extraSeq);   // 68 = 'D'
      db.extraSeq++;
    }
    db.tecnicos.push(nuevo);
    guardar(db);
    return { ok: true, modulo: nuevo.modulo };
  }

  function eliminarTecnico(id) {
    const db = cargar();
    const tec = db.tecnicos.find(t => t.id === id);
    db.tecnicos = db.tecnicos.filter(t => t.id !== id);
    // Si tenía módulo propio, sus turnos pendientes vuelven a la cola de otro módulo
    if (tec && tec.modulo) {
      db.turnos.filter(t => t.modulo === tec.modulo && t.estado !== 'listo').forEach(t => {
        t.modulo = moduloPara(db, t.dispositivo);
        t.estado = 'espera'; t.tecnico = null; t.estadoDesde = Date.now();
      });
    }
    guardar(db);
  }

  /* ---------- Motor automático ----------
     Idempotente: se basa en marcas de tiempo guardadas, por lo que puede
     correr en varias pestañas sin duplicar transiciones.
     En espera -> Siguiente (5 s) -> Reparando (5 s) -> Listo  = 10 s */
  function tick() {
    const db = cargar();
    if (db.modo !== 'auto') return;
    const ahora = Date.now();
    let cambio = false;

    db.turnos.forEach(t => {
      if (t.estado === 'siguiente' && ahora - t.estadoDesde >= CONFIG.tiempoSiguiente) {
        t.estado = 'reparando'; t.estadoDesde = ahora;
        t.tecnico = t.tecnico || tecnicoDeModulo(db, t) || 'Sin asignar';
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

    if (cambio) guardar(db);
  }

  const iniciarMotor = () => setInterval(tick, 1000);

  return {
    CONFIG, MODULOS, ICONOS, ESTADOS, DANOS, activo,
    getModulos, getModulo, moduloPara, modulosDeTecnico, iconosDe,
    cargar, onChange, iniciarMotor,
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
const porNumDesc = (a, b) => b.n - a.n;   // orden descendente por turno generado

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

  // Llenar la lista desplegable de daños
  $('#dano').innerHTML = '<option value="">— Selecciona una opción —</option>' +
    RC.DANOS.map(d => `<option value="${d}">${d}</option>`).join('');

  function ruta() {
    const enTurno = location.hash === '#turno';
    vistaInicio.hidden = enTurno;
    vistaTurno.hidden = !enTurno;
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', ruta);
  ruta();

  // Solo números en cédula
  $('#cedula').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });

  // Vista previa del módulo
  const actualizarHint = () => {
    const db = RC.cargar();
    const m = RC.getModulo(db, RC.moduloPara(db, form.dispositivo.value));
    $('#hint-modulo').textContent = `Se asignará al ${m.nombre} (según disponibilidad)`;
  };
  form.querySelectorAll('input[name="dispositivo"]').forEach(r => r.addEventListener('change', actualizarHint));

  form.addEventListener('submit', e => {
    e.preventDefault();
    errorEl.textContent = '';
    const r = RC.crearTurno({
      cedula: form.cedula.value.trim(),
      dispositivo: form.dispositivo.value,
      dano: form.dano.value
    });
    if (!r.ok) { errorEl.textContent = r.error; return; }

    $('#ticket-codigo').textContent = r.turno.codigo;
    $('#ticket-detalle').textContent =
      `${RC.getModulo(RC.cargar(), r.turno.modulo).nombre} · ${r.turno.dispositivo}. ` +
      (r.adelante === 0 ? 'No hay turnos delante de ti.' : `Hay ${r.adelante} turno(s) delante de ti.`);
    bloqueForm.hidden = true;
    bloqueTicket.hidden = false;
    form.reset();
    actualizarHint();
  });

  $('#btn-otro').addEventListener('click', () => {
    bloqueTicket.hidden = true;
    bloqueForm.hidden = false;
  });
}

/* =====================================================================
   PANTALLA 3: pantalla.html (cliente)
   ===================================================================== */
function initPantalla() {
  let previo = {};

  function render(db) {
    // Chip de modo
    $('#chip-modo').textContent = db.modo === 'auto' ? 'Modo: automático' : 'Modo: manual (técnico)';

    // Tarjetas por módulo
    const html = RC.getModulos(db).map(m => {
      const letra = m.letra;
      const tecHtml = m.tecnicos.length
        ? m.tecnicos.map(t => `<span class="tec-chip">👨‍🔧 ${RC.esc(t.nombre)}</span>`).join('')
        : '<span class="tec-vacio">Sin técnico asignado</span>';
      const delMod = db.turnos.filter(t => t.modulo === letra);
      const sig = delMod.find(t => t.estado === 'siguiente');
      const rep = delMod.find(t => t.estado === 'reparando');
      const esperando = delMod.filter(t => t.estado === 'espera').length;
      return `
        <article class="modulo">
          <div class="modulo-head"><strong>${m.nombre}${m.extra ? '<small class="nuevo">nuevo</small>' : ''}</strong><span>${RC.iconosDe(m.dispositivos)} ${m.dispositivos.join(' / ')}</span></div>
          <div class="modulo-tec">${tecHtml}</div>
          <div class="modulo-body">
            <div class="slot"><div><small>Siguiente</small><span class="num ${sig ? 'siguiente' : 'nada'}">${sig ? sig.codigo : '—'}</span></div>
              ${sig ? '<span class="badge siguiente">Siguiente</span>' : ''}</div>
            <div class="slot"><div><small>Reparando</small><span class="num ${rep ? 'reparando' : 'nada'}">${rep ? rep.codigo : '—'}</span></div>
              ${rep ? `<span class="badge reparando">${RC.esc(rep.tecnico || '')}</span>` : ''}</div>
          </div>
          <div class="modulo-foot">En espera: <strong>${esperando}</strong></div>
        </article>`;
    }).join('');
    $('#modulos').innerHTML = html;

    // Tabla (descendente por turno)
    const filas = [...db.turnos].sort(porNumDesc).map(t => {
      const cambio = previo[t.n] && previo[t.n] !== t.estado ? 'flash' : '';
      return `<tr class="${cambio}">
        <td class="codigo">${t.codigo}</td>
        <td>${RC.getModulo(db, t.modulo).nombre}</td>
        <td>${RC.ICONOS[t.dispositivo]} ${t.dispositivo}</td>
        <td>${RC.enmascarar(t.cedula)}</td>
        <td>${RC.hora(t.creado)}</td>
        <td><span class="badge ${t.estado}">${RC.ESTADOS[t.estado]}</span></td>
      </tr>`;
    }).join('');
    $('#tabla-turnos').innerHTML = filas || '<tr><td class="vacio" colspan="6">Aún no hay turnos generados</td></tr>';

    previo = Object.fromEntries(db.turnos.map(t => [t.n, t.estado]));
  }

  const reloj = () => { $('#reloj').textContent = new Date().toLocaleTimeString('es-EC'); };
  setInterval(reloj, 1000); reloj();

  RC.onChange(render);
  render(RC.cargar());
  RC.iniciarMotor();
}

/* =====================================================================
   PANTALLA 4: tecnico.html
   ===================================================================== */
function initTecnico() {
  const form = $('#form-tecnico');
  const errorEl = $('#error-tec');
  const selTec = $('#tec-activo');
  let tecnicoActivo = null;

  $('#t-cedula').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });

  form.addEventListener('submit', e => {
    e.preventDefault();
    errorEl.textContent = '';
    const dispositivos = [...form.querySelectorAll('input[name="disp"]:checked')].map(c => c.value);
    const r = RC.registrarTecnico({
      nombre: $('#t-nombre').value,
      cedula: $('#t-cedula').value.trim(),
      dispositivos
    });
    if (!r.ok) { errorEl.textContent = r.error; return; }
    form.reset();
    toast(r.modulo ? `Técnico registrado. Se creó el Módulo ${r.modulo}` : 'Técnico registrado correctamente');
  });

  selTec.addEventListener('change', () => { tecnicoActivo = Number(selTec.value) || null; });

  $('#modo-auto').addEventListener('click', () => RC.setModo('auto'));
  $('#modo-manual').addEventListener('click', () => RC.setModo('manual'));
  $('#btn-limpiar').addEventListener('click', () => { RC.limpiarFinalizados(); toast('Turnos finalizados eliminados'); });
  $('#btn-reiniciar').addEventListener('click', () => {
    if (confirm('¿Reiniciar todos los turnos y contadores? Los técnicos se conservan.')) RC.reiniciarTodo();
  });

  // Delegación de eventos
  $('#lista-tecnicos').addEventListener('click', e => {
    const b = e.target.closest('[data-del]');
    if (b) RC.eliminarTecnico(Number(b.dataset.del));
  });

  $('#tabla-gestion').addEventListener('click', e => {
    const b = e.target.closest('[data-estado]');
    if (!b) return;
    const r = RC.cambiarEstado(Number(b.dataset.id), b.dataset.estado, tecnicoActivo);
    if (!r.ok) toast(r.error, true);
  });

  function render(db) {
    const manual = db.modo === 'manual';
    $('#modo-auto').classList.toggle('on', !manual);
    $('#modo-manual').classList.toggle('on', manual);
    $('#hint-modo').textContent = manual
      ? 'Modo manual: tú decides cuándo cambia el estado de cada turno.'
      : `Modo automático: cada turno pasa de "Siguiente" a "Listo" en ${(RC.CONFIG.tiempoSiguiente + RC.CONFIG.tiempoReparando) / 1000} segundos.`;

    // Técnicos
    $('#lista-tecnicos').innerHTML = db.tecnicos.length
      ? db.tecnicos.map(t => `<li><div><strong>${RC.esc(t.nombre)}</strong>
          <small>CI ${t.cedula} · ${t.dispositivos.join(', ')}<br>Módulo(s): ${RC.modulosDeTecnico(db, t).join(', ') || '—'}</small></div>
          <button class="btn-x" data-del="${t.id}" title="Eliminar">✕</button></li>`).join('')
      : '<li class="vacio">Sin técnicos registrados</li>';

    // Selector de técnico activo (conserva selección)
    selTec.innerHTML = '<option value="">— Selecciona —</option>' +
      db.tecnicos.map(t => `<option value="${t.id}" ${t.id === tecnicoActivo ? 'selected' : ''}>${RC.esc(t.nombre)}</option>`).join('');
    if (!db.tecnicos.some(t => t.id === tecnicoActivo)) tecnicoActivo = null;

    // Gestión de turnos (descendente)
    const dis = manual ? '' : 'disabled';
    const acciones = t => {
      if (t.estado === 'espera')    return `<button class="btn-accion" ${dis} data-id="${t.n}" data-estado="siguiente">Llamar</button>`;
      if (t.estado === 'siguiente') return `<button class="btn-accion" ${dis} data-id="${t.n}" data-estado="reparando">Reparar</button>
                                            <button class="btn-accion ok" ${dis} data-id="${t.n}" data-estado="listo">Finalizar</button>`;
      if (t.estado === 'reparando') return `<button class="btn-accion ok" ${dis} data-id="${t.n}" data-estado="listo">Finalizar</button>`;
      return '—';
    };
    const filas = [...db.turnos].sort(porNumDesc).map(t => `<tr>
        <td class="codigo">${t.codigo}</td>
        <td>${RC.ICONOS[t.dispositivo]} ${t.dispositivo} <small>· Mód. ${t.modulo}</small></td>
        <td>${RC.esc(t.dano)}</td>
        <td>${RC.esc(t.tecnico || '—')}</td>
        <td><span class="badge ${t.estado}">${RC.ESTADOS[t.estado]}</span></td>
        <td>${acciones(t)}</td>
      </tr>`).join('');
    $('#tabla-gestion').innerHTML = filas || '<tr><td class="vacio" colspan="6">No hay turnos generados</td></tr>';
  }

  RC.onChange(render);
  render(RC.cargar());
  RC.iniciarMotor();
}

/* ---------- Arranque según la página ---------- */
document.addEventListener('DOMContentLoaded', () => {
  const pagina = document.body.dataset.page;
  if (pagina === 'index') initIndex();
  if (pagina === 'pantalla') initPantalla();
  if (pagina === 'tecnico') initTecnico();
});
