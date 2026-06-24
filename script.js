/**
 * ═══════════════════════════════════════════════════════════════
 *   MARRERO PRODUCTIONS — script.js
 *   Lógica de: navegación, carrusel, Drive API, scroll reveals
 * ═══════════════════════════════════════════════════════════════
 */

// ══════════════════════════════════════
//   CONFIGURACIÓN — edita SOLO este bloque
// ══════════════════════════════════════

/**
 * API_KEY: Tu clave de Google Drive API v3.
 *   - Ve a https://console.cloud.google.com/
 *   - Crea un proyecto → Habilita "Google Drive API"
 *   - Credenciales → Crear credenciales → Clave de API
 *   - Restringe la clave a "Google Drive API" por seguridad
 */
const API_KEY = "AIzaSyDfnETV2SHde32Tp8eqxP-i6SwCZHXrnT0";

/**
 * FOLDER_ID: El ID de tu carpeta pública de Google Drive.
 *   - Abre la carpeta en Drive
 *   - Copia el ID de la URL: drive.google.com/drive/folders/[ESTE_ES_EL_ID]
 *   - La carpeta DEBE estar compartida como "Cualquier persona con el enlace puede ver"
 */
const FOLDER_ID = "1w69brE4h0L-RYUGCgbBc1rW-uU8hVos9";

/**
 * INTERVALO: Milisegundos entre slides (los videos pausan el autoplay
 * hasta que terminan su reproducción).
 */
const INTERVALO = 6000;

/**
 * DESCRIPCIONES: Texto opcional para cada archivo por nombre exacto.
 * Si un archivo no tiene entrada aquí, el overlay mostrará solo
 * el badge de tipo (para videos) o nada (para imágenes).
 */
const DESCRIPCIONES = {
  // "nombre-exacto-del-archivo.jpg": "Descripción que aparecerá en pantalla",
  // "video-promo.mp4": "Conoce nuestros nuevos servicios",
};

// ══════════════════════════════════════
//   TIPOS MIME SOPORTADOS
// ══════════════════════════════════════
const MIME_IMAGENES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MIME_VIDEOS   = ["video/mp4", "video/quicktime", "video/x-msvideo", "video/webm"];

// ══════════════════════════════════════
//   REFERENCIAS AL DOM DEL CARRUSEL
// ══════════════════════════════════════
const track  = document.getElementById("track");
const dotsEl = document.getElementById("dots");
const progEl = document.getElementById("progress");

// Estado interno del carrusel
let current          = 0;
let total            = 0;
let timerInterval    = null;
let animFrame        = null;
let t0               = null;
let pausadoPorVideo  = false;

// ══════════════════════════════════════════════════════════════
//   1. CARGAR LISTA DE ARCHIVOS DESDE GOOGLE DRIVE API v3
// ══════════════════════════════════════════════════════════════

/**
 * Consulta la Drive API para listar imágenes y videos dentro de FOLDER_ID.
 * Usa mimeType como filtro para obtener solo los archivos compatibles.
 * @returns {Promise<Array>} Array de objetos {id, name, mimeType}
 */
async function cargarLista() {
  const mimes = [...MIME_IMAGENES, ...MIME_VIDEOS]
    .map(m => `mimeType='${m}'`)
    .join(" or ");

  const query = `'${FOLDER_ID}' in parents and (${mimes}) and trashed=false`;
  const fields = "files(id,name,mimeType)";

  const url = "https://www.googleapis.com/drive/v3/files"
    + `?q=${encodeURIComponent(query)}`
    + `&fields=${encodeURIComponent(fields)}`
    + `&orderBy=name`
    + `&pageSize=30`
    + `&key=${API_KEY}`;

  const res  = await fetch(url);
  const data = await res.json();

  if (data.error) throw new Error(data.error.message);
  if (!data.files || data.files.length === 0)
    throw new Error("No se encontraron archivos multimedia en la carpeta.");

  return data.files;
}

// ══════════════════════════════════════════════════════════════
//   2. CONSTRUIR LOS SLIDES EN EL DOM
// ══════════════════════════════════════════════════════════════

/**
 * Genera el HTML de cada slide y los inyecta en el track del carrusel.
 * Cada slide usa carga diferida (lazy loading) para optimizar rendimiento.
 * @param {Array} lista - Array de archivos obtenidos de Drive API
 */
function construirSlides(lista) {
  total = lista.length;

  lista.forEach((archivo, i) => {
    const esVideo = MIME_VIDEOS.includes(archivo.mimeType);
    const desc    = DESCRIPCIONES[archivo.name] || "";

    /**
     * URL directa con autenticación por API Key.
     * Sirve para videos y como fallback de imágenes.
     */
    const mediaUrl = `https://www.googleapis.com/drive/v3/files/${archivo.id}`
      + `?alt=media&key=${API_KEY}`;

    /**
     * URL CDN de Google Fotos para imágenes (más rápido, sin cuota de API).
     * Solo funciona si la carpeta es pública.
     */
    const imgUrl = `https://lh3.googleusercontent.com/d/${archivo.id}`;

    const slide = document.createElement("div");
    slide.className       = "slide";
    slide.dataset.idx     = i;
    slide.dataset.tipo    = esVideo ? "video" : "imagen";
    slide.dataset.loaded  = "false";

    if (esVideo) {
      slide.innerHTML = `
        <div class="slide-placeholder" id="ph-${i}">
          <div class="mini-spinner"></div>
          <span>Cargando video...</span>
        </div>
        <video
          data-src="${mediaUrl}"
          preload="none"
          playsinline
          muted
          style="display:none;"
        ></video>
        <div class="slide-overlay" style="${desc ? "" : "min-height:0;padding:1rem 2rem;"}">
          <span class="type-badge">▶ Video</span>
          ${desc ? `<p class="slide-desc">${desc}</p>` : ""}
        </div>`;
    } else {
      slide.innerHTML = `
        <div class="slide-placeholder" id="ph-${i}">
          <div class="mini-spinner"></div>
        </div>
        <img
          data-src="${imgUrl}"
          data-fallback="${mediaUrl}"
          alt="${archivo.name}"
        >
        ${desc ? `<div class="slide-overlay"><p class="slide-desc">${desc}</p></div>` : ""}`;
    }

    track.appendChild(slide);

    // Crear punto de navegación
    const dot = document.createElement("button");
    dot.className = "dot" + (i === 0 ? " active" : "");
    dot.setAttribute("aria-label", `Ir al slide ${i + 1}`);
    dot.setAttribute("role", "tab");
    dot.onclick = () => {
      clearInterval(timerInterval);
      goTo(i);
      empezarTimer();
    };
    dotsEl.appendChild(dot);
  });

  // Revelar controles del carrusel
  document.getElementById("loading").style.display      = "none";
  track.style.display                                    = "flex";
  document.getElementById("btn-left").style.display     = "flex";
  document.getElementById("btn-right").style.display    = "flex";
  document.getElementById("progress-bar").style.display = "block";

  // Precargar el primero y el segundo slide
  cargarSlide(0);
  if (total > 1) cargarSlide(1);

  empezarTimer();
}

// ══════════════════════════════════════════════════════════════
//   3. CARGA BAJO DEMANDA (LAZY LOADING POR SLIDE)
// ══════════════════════════════════════════════════════════════

/**
 * Carga el contenido multimedia de un slide específico.
 * Para imágenes: intenta primero el CDN (más rápido), luego la API Key.
 * Para videos: asigna el src solo cuando el slide va a mostrarse.
 * @param {number} idx - Índice del slide a cargar
 */
function cargarSlide(idx) {
  const slides = track.querySelectorAll(".slide");
  const slide  = slides[idx];
  if (!slide || slide.dataset.loaded === "true") return;
  slide.dataset.loaded = "true";

  const ph = slide.querySelector(".slide-placeholder");

  if (slide.dataset.tipo === "imagen") {
    const img      = slide.querySelector("img");
    const src      = img.dataset.src;
    const fallback = img.dataset.fallback;

    // Intentar carga por CDN
    const tmp = new Image();
    tmp.onload = () => {
      img.src = src;
      img.classList.add("loaded");
      if (ph) ph.style.display = "none";
    };
    tmp.onerror = () => {
      // CDN falló → usar URL con API Key
      const tmp2 = new Image();
      tmp2.onload = () => {
        img.src = fallback;
        img.classList.add("loaded");
        if (ph) ph.style.display = "none";
      };
      tmp2.onerror = () => {
        if (ph) ph.innerHTML = '<span style="opacity:0.4;font-size:13px;">Sin imagen</span>';
      };
      tmp2.src = fallback;
    };
    tmp.src = src;

  } else {
    // Video: asignar src y mostrar cuando esté listo
    const video = slide.querySelector("video");
    video.src = video.dataset.src;
    video.style.display = "block";
    if (ph) ph.style.display = "none";

    video.addEventListener("canplay", () => {
      if (ph) ph.style.display = "none";
    }, { once: true });
  }
}

// ══════════════════════════════════════════════════════════════
//   4. GESTIÓN DE VIDEO (REPRODUCCIÓN AUTOMÁTICA)
// ══════════════════════════════════════════════════════════════

/**
 * Pausa todos los videos y reproduce el del slide actual.
 * El autoplay del carrusel se pausa mientras un video está activo.
 * Al terminar el video, avanza al siguiente slide automáticamente.
 * @param {number} idx - Índice del slide actual
 */
function gestionarVideo(idx) {
  // Pausar y reiniciar todos los videos; limpiar cualquier handler previo
  track.querySelectorAll("video").forEach(v => {
    v.pause();
    v.currentTime = 0;
    v.onended = null;
  });

  const slides = track.querySelectorAll(".slide");
  const slide  = slides[idx];
  if (!slide || slide.dataset.tipo !== "video") {
    pausadoPorVideo = false;
    return;
  }

  const video = slide.querySelector("video");

  // Si aún no tiene src cargado, cargarlo ahora
  if (!video.src || video.src === window.location.href) {
    video.src = video.dataset.src;
    video.style.display = "block";
    const ph = slide.querySelector(".slide-placeholder");
    if (ph) ph.style.display = "none";
  }

  // Pausar autoplay del carrusel mientras dura el video
  pausadoPorVideo = true;
  clearInterval(timerInterval);
  cancelAnimationFrame(animFrame);
  progEl.style.width = "0%";

  // Asignar onended ANTES de play() para no perder el evento
  video.onended = () => {
    video.onended = null;
    pausadoPorVideo = false;
    goTo(current + 1);
    empezarTimer();
  };

  video.play().catch(() => {
    // Autoplay bloqueado por el navegador → continuar con timer normal
    video.onended = null;
    pausadoPorVideo = false;
    empezarTimer();
  });
}

// ══════════════════════════════════════════════════════════════
//   5. NAVEGACIÓN DEL CARRUSEL
// ══════════════════════════════════════════════════════════════

/**
 * Navega al slide indicado, actualiza la posición visual,
 * los puntos de navegación y precarga los slides adyacentes.
 * @param {number} n - Índice destino (se normaliza con módulo)
 */
function goTo(n) {
  current = (n + total) % total;
  track.style.transform = `translateX(-${current * 100}%)`;

  // Actualizar puntos activos
  document.querySelectorAll(".dot").forEach((dot, i) =>
    dot.classList.toggle("active", i === current));

  reiniciarProgreso();

  // Precargar slide actual y el siguiente
  cargarSlide(current);
  cargarSlide((current + 1) % total);

  gestionarVideo(current);
}

/**
 * Mueve el carrusel una posición (llamado desde los botones de flecha).
 * @param {number} dir - Dirección: 1 (siguiente) o -1 (anterior)
 */
function mover(dir) {
  // Si hay un video activo, limpiar su handler antes de navegar
  track.querySelectorAll("video").forEach(v => {
    v.pause();
    v.currentTime = 0;
    v.onended = null;
  });
  pausadoPorVideo = false;
  clearInterval(timerInterval);
  cancelAnimationFrame(animFrame);
  goTo(current + dir);
  empezarTimer();
}

// Exponer mover() globalmente para los onclick del HTML
window.mover = mover;

// ══════════════════════════════════════════════════════════════
//   6. BARRA DE PROGRESO ANIMADA
// ══════════════════════════════════════════════════════════════

function reiniciarProgreso() {
  cancelAnimationFrame(animFrame);
  progEl.style.width = "0%";
  if (!pausadoPorVideo) animarProgreso();
}

function animarProgreso() {
  t0 = performance.now();
  function tick(now) {
    const pct = Math.min(((now - t0) / INTERVALO) * 100, 100);
    progEl.style.width = pct + "%";
    if (pct < 100) animFrame = requestAnimationFrame(tick);
  }
  animFrame = requestAnimationFrame(tick);
}

function empezarTimer() {
  clearInterval(timerInterval);
  if (pausadoPorVideo) return;
  reiniciarProgreso();
  timerInterval = setInterval(() => goTo(current + 1), INTERVALO);
}

// ══════════════════════════════════════════════════════════════
//   7. EVENTOS DEL CARRUSEL (HOVER, TÁCTIL, TECLADO)
// ══════════════════════════════════════════════════════════════

const carouselWrapper = document.getElementById("carousel");

// Pausa al pasar el ratón (solo en imágenes, no interrumpe videos)
carouselWrapper.addEventListener("mouseenter", () => {
  if (!pausadoPorVideo) {
    clearInterval(timerInterval);
    cancelAnimationFrame(animFrame);
  }
});

carouselWrapper.addEventListener("mouseleave", () => {
  if (!pausadoPorVideo) empezarTimer();
});

// Soporte táctil — swipe horizontal
let touchX = 0;
carouselWrapper.addEventListener("touchstart", e => {
  touchX = e.touches[0].clientX;
}, { passive: true });

carouselWrapper.addEventListener("touchend", e => {
  const diff = touchX - e.changedTouches[0].clientX;
  if (Math.abs(diff) > 50) mover(diff > 0 ? 1 : -1);
}, { passive: true });

// Soporte teclado — flechas izquierda/derecha
document.addEventListener("keydown", e => {
  if (e.key === "ArrowLeft")  mover(-1);
  if (e.key === "ArrowRight") mover(1);
});

// ══════════════════════════════════════════════════════════════
//   8. NAVEGACIÓN — MENÚS DROPDOWN
// ══════════════════════════════════════════════════════════════

const navItems = document.querySelectorAll(".nav-item.has-dropdown");

navItems.forEach(item => {
  const btn      = item.querySelector(".nav-btn");
  const dropdown = item.querySelector(".dropdown");

  // Abrir/cerrar con clic
  btn.addEventListener("click", e => {
    e.stopPropagation();
    const isOpen = item.classList.contains("open");

    // Cerrar todos los demás
    navItems.forEach(other => {
      other.classList.remove("open");
      other.querySelector(".nav-btn").setAttribute("aria-expanded", "false");
    });

    if (!isOpen) {
      item.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
    }
  });
});

// Cerrar dropdowns al hacer clic fuera
document.addEventListener("click", () => {
  navItems.forEach(item => {
    item.classList.remove("open");
    item.querySelector(".nav-btn").setAttribute("aria-expanded", "false");
  });
});

// ── Smooth scroll para los links del dropdown ──
document.querySelectorAll('.dropdown-link[href^="#"]').forEach(link => {
  link.addEventListener("click", e => {
    e.preventDefault();
    const targetId = link.getAttribute("href").slice(1);
    const target   = document.getElementById(targetId);

    // Cerrar nav móvil si está abierta
    mainNav.classList.remove("open");
    hamburger.classList.remove("open");
    hamburger.setAttribute("aria-expanded", "false");

    if (target) {
      const offset = target.getBoundingClientRect().top + window.scrollY
        - parseInt(getComputedStyle(document.documentElement).getPropertyValue("--header-h"));
      window.scrollTo({ top: offset, behavior: "smooth" });
    }

    // Cerrar dropdowns
    navItems.forEach(item => item.classList.remove("open"));
  });
});

// ══════════════════════════════════════════════════════════════
//   9. HAMBURGER MENU (MÓVIL)
// ══════════════════════════════════════════════════════════════

const hamburger = document.getElementById("hamburger");
const mainNav   = document.getElementById("main-nav");

hamburger.addEventListener("click", e => {
  e.stopPropagation();
  const isOpen = mainNav.classList.contains("open");
  mainNav.classList.toggle("open");
  hamburger.classList.toggle("open");
  hamburger.setAttribute("aria-expanded", String(!isOpen));
});

// Cerrar nav móvil al hacer clic fuera
document.addEventListener("click", e => {
  if (!mainNav.contains(e.target) && !hamburger.contains(e.target)) {
    mainNav.classList.remove("open");
    hamburger.classList.remove("open");
    hamburger.setAttribute("aria-expanded", "false");
  }
});

// ══════════════════════════════════════════════════════════════
//   10. HEADER STICKY — cambio de estilo al hacer scroll
// ══════════════════════════════════════════════════════════════

const siteHeader = document.getElementById("site-header");

window.addEventListener("scroll", () => {
  siteHeader.classList.toggle("scrolled", window.scrollY > 80);
}, { passive: true });

// ══════════════════════════════════════════════════════════════
//   11. SCROLL REVEAL — animación de elementos al aparecer
// ══════════════════════════════════════════════════════════════

const revealObserver = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        // Pequeño delay escalonado entre columnas
        const delay = entry.target.classList.contains("reveal-right") ? 150 : 0;
        setTimeout(() => entry.target.classList.add("visible"), delay);
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
);

document.querySelectorAll(".reveal-left, .reveal-right").forEach(el =>
  revealObserver.observe(el));

// ══════════════════════════════════════════════════════════════
//   12. AÑO DINÁMICO EN EL FOOTER
// ══════════════════════════════════════════════════════════════

const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

// ══════════════════════════════════════════════════════════════
//   13. INICIAR — Cargar archivos desde Google Drive
// ══════════════════════════════════════════════════════════════

cargarLista()
  .then(construirSlides)
  .catch(err => {
    // Mostrar error elegante en la pantalla de carga
    const loadingScreen = document.getElementById("loading");
    if (loadingScreen) {
      loadingScreen.innerHTML = `
        <div style="text-align:center;padding:2rem;max-width:400px;">
          <div style="font-family:'Cinzel',serif;font-size:2rem;color:#D4AF37;letter-spacing:0.15em;margin-bottom:1rem;">
            MARRERO
          </div>
          <p style="color:#ff6b6b;font-size:0.9rem;margin-bottom:0.75rem;">
            ⚠ ${err.message}
          </p>
          <p style="color:rgba(245,240,232,0.35);font-size:0.75rem;line-height:1.6;">
            Verifica la API Key, el Folder ID y que la carpeta<br>
            esté compartida como pública en Google Drive.
          </p>
        </div>
      `;
    }
    console.error("[Marrero Productions] Error al cargar Drive:", err);
  });
