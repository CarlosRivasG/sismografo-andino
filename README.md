<div align="center">
  <img><img width="1752" height="536" alt="Logo_and_wordmark_design_2K_202608120112" src="https://github.com/user-attachments/assets/7157da3c-8422-4bd5-acdf-5e8d053d9df0" />
</img>

</div>


# 🌍 Sismógrafo Andino v2.0

> Monitor sísmico en tiempo real para Venezuela y Colombia — datos reales del USGS, modelo de predicción de réplicas Omori-Utsu y visualizador de presión tectónica por zona de falla.

![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite)
![USGS](https://img.shields.io/badge/Data-USGS%20Live-00D4FF?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-34C759?style=flat-square)

---

## 📸 Vista general

El dashboard se divide en 5 módulos navegables:

| Tab | Descripción |
|-----|-------------|
| 📡 **Monitoreo** | Mapa interactivo en tiempo real con heatmap de densidad y top eventos |
| 🌋 **Presión Tectónica** | Estimador de estrés por zona de falla (Boconó, Bucaramanga, Subducción Pacífico, etc.) |
| 📈 **Predicción de Réplicas** | Modelo Omori-Utsu con probabilidades de M5+ y M6+ hora a hora |
| 🚨 **Alertas** | Detección automática de sismos M5+, distribución de magnitudes y energía liberada |
| 📋 **Datos** | Tabla completa filtrable con coordenadas, profundidad y timestamps |

---

## ⚙️ Tecnologías

- **React 18** — UI reactiva con hooks (`useState`, `useEffect`, `useMemo`, `useCallback`, `useRef`)
- **Canvas API** — Renderizado de mapa, sismógrafos, gauges y gráficas sin librerías externas
- **USGS Earthquake API** — Datos sísmicos reales, actualizados cada 60 segundos
- **Vite** — Bundler y servidor de desarrollo

Sin dependencias externas de visualización. Todo el renderizado gráfico es Canvas nativo.

---

## 🧠 Modelos científicos implementados

### Ley de Omori-Utsu (1894 / 1961)
Predice la tasa de réplicas después de un sismo principal:

```
Rate(t) = K / (t + c)^p

K = 10^(0.75 * (M - 3))   productividad según magnitud
c = 0.05                   offset temporal (horas)
p = 1.1                    exponente de decaimiento
```

### Ley de Gutenberg-Richter
Distribuye las réplicas esperadas por rango de magnitud:

```
log₁₀(N) = a - b·M    donde b = 1.0
```

### Estimador de Estrés Tectónico
Combina el riesgo histórico de cada falla con la actividad sísmica reciente dentro de un radio de ~330 km:

```
stress = 0.6 × riesgo_histórico + 0.4 × (log₁₀(energía_reciente) / 22)
```

> ⚠️ **Importante:** La predicción exacta de terremotos (día, hora, magnitud específica) no existe científicamente. Los valores mostrados son estimaciones estadísticas de probabilidad basadas en sismicidad histórica global.

---

## 🗺️ Zonas de falla monitoreadas

| Zona | País | Tipo | Longitud | Riesgo base |
|------|------|------|----------|-------------|
| Falla de Boconó | Venezuela | Strike-slip | 500 km | 87% |
| Falla de Oca-Ancón | VEN/COL | Strike-slip | 400 km | 74% |
| Nido Sísmico de Bucaramanga | Colombia | Deep-focus | 50 km | 91% |
| Zona de Subducción del Pacífico | Colombia | Subducción | 800 km | 95% |
| Placa Caribe | Caribe | Convergente | 600 km | 62% |
| Sistema de Fallas Romeral | Colombia | Strike-slip | 350 km | 78% |
| Cordillera de Mérida | Venezuela | Thrust | 250 km | 83% |

---

## 🚀 Instalación y uso local

### Requisitos
- Node.js 18+ ([descargar aquí](https://nodejs.org))
- npm 9+

### Pasos

```bash
# 1. Clona el repositorio
git clone https://github.com/tu-usuario/sismografo-andino.git
cd sismografo-andino

# 2. Instala dependencias
npm install

# 3. Corre en modo desarrollo
npm run dev
```

Abre **http://localhost:5173** en tu navegador.

```bash
# Para build de producción
npm run build

# Para previsualizar el build
npm run preview
```

### Estructura del proyecto

```
sismografo-andino/
├── src/
│   ├── App.jsx          # Componente principal (dashboard completo)
│   ├── main.jsx         # Punto de entrada React
│   └── index.css        # Estilos base (vacío — estilos inline en App.jsx)
├── index.html
├── vite.config.js
├── package.json
└── README.md
```

---

## 🌐 Despliegue

### Vercel (recomendado)
```bash
npm install -g vercel
npm run build
vercel deploy --prod
```

### Netlify Drop
```bash
npm run build
# Arrastra la carpeta /dist a netlify.com/drop
```

### GitHub Pages
```bash
npm install -g gh-pages
npm run build
gh-pages -d dist
```

---

## 📡 API utilizada

**USGS Earthquake Hazards Program**
- Endpoint: `https://earthquake.usgs.gov/fdsnws/event/1/query`
- Formato: GeoJSON
- Cobertura: Región Andina (lat -5° a 18°, lon -85° a -55°)
- Magnitud mínima: M2.0
- Límite: 300 eventos por consulta
- Actualización: automática cada 60 segundos

Documentación completa: [earthquake.usgs.gov/fdsnws](https://earthquake.usgs.gov/fdsnws/event/1/)

---

## 🗺️ Roadmap

- [ ] Integración con FUNVISIS (Venezuela) y SGC (Colombia)
- [ ] Notificaciones push para M5+
- [ ] Exportación de datos en CSV
- [ ] Modo oscuro / claro
- [ ] Soporte GPS geodésico (UNAVCO) para deformación de corteza
- [ ] Modelo ML de clustering sísmico
- [ ] PWA con soporte offline
- [ ] API propia con historial persistente

---

## 🤝 Contribuciones

Las contribuciones son bienvenidas. Por favor:

1. Haz fork del repo
2. Crea una rama: `git checkout -b feature/nueva-funcionalidad`
3. Commitea tus cambios: `git commit -m 'Add: nueva funcionalidad'`
4. Push: `git push origin feature/nueva-funcionalidad`
5. Abre un Pull Request

---

## 📄 Licencia

MIT © 2026 — Libre para uso, modificación y distribución.

---

## 🙏 Créditos

- Datos sísmicos: [USGS Earthquake Hazards Program](https://earthquake.usgs.gov)
- Modelo Omori-Utsu: Omori (1894), Utsu (1961)
- Ley Gutenberg-Richter: Gutenberg & Richter (1944)
- Inspirado en la necesidad de monitoreo sísmico accesible para Latinoamérica

---

<div align="center">
   <sub>Construido con ❤️ para Venezuela y Colombia · Los datos son reales · La predicción exacta no existe aún en la ciencia</sub>
  <img><img width="2752" height="1536" alt="Logo_and_wordmark_design_2K_202608120112" src="https://github.com/user-attachments/assets/937d900c-59bc-4a80-a3d6-0efccc2f373d" />
</img>
 
</div>
