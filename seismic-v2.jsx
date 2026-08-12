import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─── CONSTANTS ─────────────────────────────────────────────────────────────
const USGS_API = "https://earthquake.usgs.gov/fdsnws/event/1/query";

const FAULT_ZONES = [
  { id: "bocono",    name: "Falla de Boconó",           lat: 8.5,  lon: -71.0, risk: 0.87, type: "strike-slip", length: 500, country: "Venezuela" },
  { id: "oca",       name: "Falla de Oca-Ancón",        lat: 11.2, lon: -72.5, risk: 0.74, type: "strike-slip", length: 400, country: "VEN/COL" },
  { id: "bucaramanga",name: "Nido Sísmico Bucaramanga", lat: 6.8,  lon: -73.1, risk: 0.91, type: "deep-focus",  length: 50,  country: "Colombia" },
  { id: "subduccion",name: "Zona Subducción Pacífico",  lat: 3.0,  lon: -77.0, risk: 0.95, type: "subduction",  length: 800, country: "Colombia" },
  { id: "caribe",    name: "Placa Caribe",              lat: 12.0, lon: -68.0, risk: 0.62, type: "convergent",  length: 600, country: "Caribe" },
  { id: "romeral",   name: "Sistema de Fallas Romeral", lat: 4.5,  lon: -75.8, risk: 0.78, type: "strike-slip", length: 350, country: "Colombia" },
  { id: "merida",    name: "Cordillera de Mérida",      lat: 8.2,  lon: -71.5, risk: 0.83, type: "thrust",      length: 250, country: "Venezuela" },
];

const TECTONIC_PLATES = [
  { name: "Placa Suramericana", color: "#00D4FF", points: [[-85,18],[-55,18],[-55,-5],[-85,-5]] },
  { name: "Placa Caribe",       color: "#FF9F0A", points: [[-85,18],[-55,18],[-55,22],[-85,22]] },
  { name: "Placa Nazca",        color: "#FF3B30", points: [[-85,-5],[-78,-5],[-78,10],[-85,10]] },
];

const getMagColor  = m => m>=7?"#FF3B30":m>=6?"#FF6B35":m>=5?"#FF9F0A":m>=4?"#FFD60A":m>=3?"#34C759":"#00D4FF";
const getMagLabel  = m => m>=7?"CRÍTICO":m>=6?"MAYOR":m>=5?"FUERTE":m>=4?"MODERADO":m>=3?"MENOR":"MICRO";
const getRiskColor = r => r>=0.9?"#FF3B30":r>=0.75?"#FF9F0A":r>=0.6?"#FFD60A":"#34C759";
const getRiskLabel = r => r>=0.9?"MUY ALTO":r>=0.75?"ALTO":r>=0.6?"MODERADO":"BAJO";
const fmtTime      = ts => new Date(ts).toLocaleString("es-ES",{month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit"});
const fmtDate      = ts => new Date(ts).toLocaleDateString("es-ES",{day:"2-digit",month:"short"});

// ─── OMORI-UTSU AFTERSHOCK MODEL ───────────────────────────────────────────
// Rate(t) = K / (t + c)^p  — standard seismology model
function computeAftershockForecast(mainshock, hoursAhead = 168) {
  if (!mainshock) return [];
  const M  = mainshock.properties.mag;
  const K  = Math.pow(10, 0.75 * (M - 3)); // productivity
  const c  = 0.05;   // time offset (hours)
  const p  = 1.1;    // Omori decay exponent
  const Mc = 3.0;    // minimum completeness magnitude
  const b  = 1.0;    // Gutenberg-Richter b-value

  const points = [];
  for (let t = 1; t <= hoursAhead; t += (t < 24 ? 1 : 6)) {
    const rate = K / Math.pow(t + c, p);
    const cumulative = K * (Math.pow(c, 1-p) - Math.pow(t+c, 1-p)) / (p-1);
    // Expected mag distribution via G-R
    const pM5 = rate * Math.pow(10, -b * (5 - Mc));
    const pM6 = rate * Math.pow(10, -b * (6 - Mc));
    points.push({ t, rate: +rate.toFixed(3), cumulative: +cumulative.toFixed(1), pM5: +pM5.toFixed(4), pM6: +pM6.toFixed(5) });
  }
  return points;
}

// ─── TECTONIC STRESS ESTIMATOR ─────────────────────────────────────────────
function estimateStress(quakes, faultZone) {
  const nearby = quakes.filter(q => {
    const dlat = q.geometry.coordinates[1] - faultZone.lat;
    const dlon = q.geometry.coordinates[0] - faultZone.lon;
    return Math.sqrt(dlat*dlat + dlon*dlon) < 3;
  });
  if (!nearby.length) return { level: faultZone.risk, events: 0, energy: 0 };
  const energy = nearby.reduce((s, q) => s + Math.pow(10, 1.5 * q.properties.mag + 4.8), 0);
  const logE = Math.log10(energy + 1);
  const normalized = Math.min(0.99, faultZone.risk * 0.6 + (logE / 22) * 0.4);
  return { level: +normalized.toFixed(2), events: nearby.length, energy: +logE.toFixed(1) };
}

// ─── CANVAS COMPONENTS ─────────────────────────────────────────────────────
const SineWave = ({ color, amplitude, frequency, speed, yOffset = 0 }) => {
  const ref = useRef(null), animRef = useRef(null), off = useRef(0);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d"), W = c.width, H = c.height;
    const draw = () => {
      ctx.clearRect(0,0,W,H);
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.shadowBlur = 10; ctx.shadowColor = color;
      for (let x=0;x<W;x++){
        const y = H/2 + yOffset
          + Math.sin((x*frequency + off.current)*0.05)*amplitude
          + Math.sin((x*frequency*0.3 + off.current*1.7)*0.05)*(amplitude*0.4)
          + Math.sin((x*frequency*0.07 + off.current*0.5)*0.05)*(amplitude*0.2);
        x===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
      }
      ctx.stroke(); off.current += speed;
      animRef.current = requestAnimationFrame(draw);
    };
    draw(); return () => cancelAnimationFrame(animRef.current);
  }, [color, amplitude, frequency, speed, yOffset]);
  return <canvas ref={ref} width={900} height={64} style={{width:"100%",height:"64px",display:"block"}} />;
};

const Seismograph = ({ intensity = 0, color = "#00D4FF", label }) => {
  const ref = useRef(null), animRef = useRef(null);
  const data = useRef(Array(180).fill(0)), t = useRef(0);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d"), W = c.width, H = c.height;
    const draw = () => {
      ctx.fillStyle = "rgba(5,10,15,0.25)"; ctx.fillRect(0,0,W,H);
      // grid lines
      ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.lineWidth = 0.5;
      [H*0.25, H*0.5, H*0.75].forEach(y => { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); });

      const amp = intensity * 18;
      const noise = (Math.random()-0.5)*amp + Math.sin(t.current*0.4)*amp*0.6 + Math.sin(t.current*0.11)*amp*0.3;
      data.current.push(noise); data.current.shift();

      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.4;
      ctx.shadowBlur = intensity > 0.3 ? 8 : 2; ctx.shadowColor = color;
      data.current.forEach((v,i) => { const x=(i/180)*W, y=H/2+v; i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
      ctx.stroke(); t.current++;
      animRef.current = requestAnimationFrame(draw);
    };
    draw(); return () => cancelAnimationFrame(animRef.current);
  }, [intensity, color]);
  return (
    <div>
      {label && <div style={{fontSize:"10px",color:"#4A7FA5",fontFamily:"'JetBrains Mono',monospace",marginBottom:"4px",letterSpacing:"0.06em"}}>{label}</div>}
      <canvas ref={ref} width={260} height={56} style={{width:"100%",height:"56px",borderRadius:"4px",background:"#050A0F"}} />
    </div>
  );
};

const AfterShockChart = ({ data, mainMag }) => {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c || !data.length) return;
    const ctx = c.getContext("2d"), W = c.width, H = c.height;
    ctx.clearRect(0,0,W,H);

    // background
    ctx.fillStyle = "#050A0F"; ctx.fillRect(0,0,W,H);
    // grid
    ctx.strokeStyle = "rgba(0,212,255,0.06)"; ctx.lineWidth = 0.5;
    for (let i=1;i<5;i++){ ctx.beginPath(); ctx.moveTo(0,H*i/5); ctx.lineTo(W,H*i/5); ctx.stroke(); }
    for (let i=1;i<8;i++){ ctx.beginPath(); ctx.moveTo(W*i/8,0); ctx.lineTo(W*i/8,H); ctx.stroke(); }

    const maxRate = Math.max(...data.map(d=>d.rate));
    const pts = data.map((d,i) => ({ x: (i/(data.length-1))*W, y: H - (d.rate/maxRate)*(H*0.82) - H*0.08 }));

    // fill area
    ctx.beginPath();
    ctx.moveTo(pts[0].x, H);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(pts[pts.length-1].x, H);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0,0,0,H);
    grad.addColorStop(0,"rgba(255,159,10,0.35)");
    grad.addColorStop(1,"rgba(255,159,10,0.02)");
    ctx.fillStyle = grad; ctx.fill();

    // line
    ctx.beginPath(); ctx.strokeStyle = "#FF9F0A"; ctx.lineWidth = 2;
    ctx.shadowBlur = 8; ctx.shadowColor = "#FF9F0A";
    pts.forEach((p,i) => i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));
    ctx.stroke();

    // 24h marker
    const idx24 = data.findIndex(d=>d.t>=24);
    if(idx24>0){
      const x24 = (idx24/(data.length-1))*W;
      ctx.beginPath(); ctx.strokeStyle = "rgba(0,212,255,0.5)"; ctx.lineWidth = 1;
      ctx.setLineDash([4,4]); ctx.moveTo(x24,0); ctx.lineTo(x24,H); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle="#00D4FF"; ctx.font="9px 'JetBrains Mono',monospace";
      ctx.fillText("24h",x24+3,12);
    }

    // axis labels
    ctx.fillStyle = "#4A7FA5"; ctx.font = "9px 'JetBrains Mono',monospace";
    ctx.fillText("Tasa de réplicas/hr", 6, 14);
    ctx.fillText("0h", 4, H-4);
    ctx.fillText("7d", W-20, H-4);
  }, [data, mainMag]);
  return <canvas ref={ref} width={520} height={140} style={{width:"100%",height:"140px",borderRadius:"6px"}} />;
};

const StressGauge = ({ value, label, color }) => {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d"), W = c.width, H = c.height;
    ctx.clearRect(0,0,W,H);
    const cx=W/2, cy=H*0.72, r=Math.min(W,H*1.2)*0.38;
    const startA = Math.PI*0.85, endA = Math.PI*0.15 + Math.PI;

    // track
    ctx.beginPath(); ctx.arc(cx,cy,r,startA,endA);
    ctx.strokeStyle="#1E3A5F"; ctx.lineWidth=10; ctx.lineCap="round"; ctx.stroke();

    // fill
    const fillEnd = startA + (endA-startA)*Math.min(value,1);
    const grad = ctx.createLinearGradient(cx-r,cy,cx+r,cy);
    grad.addColorStop(0,"#34C759"); grad.addColorStop(0.5,"#FF9F0A"); grad.addColorStop(1,"#FF3B30");
    ctx.beginPath(); ctx.arc(cx,cy,r,startA,fillEnd);
    ctx.strokeStyle=grad; ctx.lineWidth=10; ctx.lineCap="round"; ctx.stroke();

    // needle
    const angle = startA + (endA-startA)*Math.min(value,1);
    const nx = cx + (r*0.75)*Math.cos(angle), ny = cy + (r*0.75)*Math.sin(angle);
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(nx,ny);
    ctx.strokeStyle=color; ctx.lineWidth=2.5; ctx.lineCap="round"; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx,cy,5,0,Math.PI*2); ctx.fillStyle=color; ctx.fill();

    // value text
    ctx.fillStyle=color; ctx.font="bold 18px 'JetBrains Mono',monospace";
    ctx.textAlign="center";
    ctx.shadowBlur=12; ctx.shadowColor=color;
    ctx.fillText(`${Math.round(value*100)}%`, cx, cy+20);
    ctx.shadowBlur=0;
    ctx.fillStyle="#4A7FA5"; ctx.font="9px Inter,sans-serif";
    ctx.fillText(label, cx, cy+34);
  }, [value, label, color]);
  return <canvas ref={ref} width={130} height={90} style={{width:"100%",height:"90px"}} />;
};

// ─── MAP COMPONENT ──────────────────────────────────────────────────────────
const SeismicMap = ({ quakes, faultStress, selectedFault, onSelectFault, showHeatmap, tab }) => {
  const ref = useRef(null);
  const animRef = useRef(null);
  const pulseRef = useRef(0);
  const [tooltip, setTooltip] = useState(null);

  const CENTER = { lat: 7, lon: -72 };
  const SCALE = 22;

  const toXY = useCallback((lat, lon, W, H) => ({
    x: W/2 + (lon - CENTER.lon)*SCALE,
    y: H/2 - (lat - CENTER.lat)*SCALE,
  }), []);

  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;

    const draw = () => {
      ctx.clearRect(0,0,W,H);

      // ocean background
      const oceanGrad = ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,W*0.7);
      oceanGrad.addColorStop(0,"#071520"); oceanGrad.addColorStop(1,"#030810");
      ctx.fillStyle = oceanGrad; ctx.fillRect(0,0,W,H);

      // grid
      ctx.strokeStyle="rgba(0,212,255,0.04)"; ctx.lineWidth=0.5;
      for(let lat=-5;lat<=18;lat+=5){
        const {y} = toXY(lat,CENTER.lon,W,H);
        ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
        ctx.fillStyle="rgba(0,212,255,0.25)"; ctx.font="9px 'JetBrains Mono',monospace";
        ctx.fillText(`${lat}°`,4,y-2);
      }
      for(let lon=-85;lon<=-55;lon+=5){
        const {x} = toXY(CENTER.lat,lon,W,H);
        ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
        ctx.fillStyle="rgba(0,212,255,0.25)"; ctx.font="9px 'JetBrains Mono',monospace";
        ctx.fillText(`${lon}°`,x+2,H-4);
      }

      // heatmap if enabled
      if (showHeatmap && quakes.length) {
        const heatCanvas = document.createElement("canvas");
        heatCanvas.width = W; heatCanvas.height = H;
        const hctx = heatCanvas.getContext("2d");
        quakes.forEach(q => {
          const {x,y} = toXY(q.geometry.coordinates[1], q.geometry.coordinates[0], W, H);
          const r = Math.max(20, q.properties.mag * 12);
          const g = hctx.createRadialGradient(x,y,0,x,y,r);
          const intensity = q.properties.mag >= 6 ? 0.6 : q.properties.mag >= 5 ? 0.4 : 0.2;
          g.addColorStop(0,`rgba(255,80,0,${intensity})`);
          g.addColorStop(0.4,`rgba(255,160,0,${intensity*0.5})`);
          g.addColorStop(1,"rgba(255,0,0,0)");
          hctx.fillStyle = g; hctx.fillRect(x-r,y-r,r*2,r*2);
        });
        ctx.globalAlpha = 0.55; ctx.drawImage(heatCanvas,0,0); ctx.globalAlpha = 1;
      }

      // fault zones
      FAULT_ZONES.forEach(fz => {
        const {x,y} = toXY(fz.lat, fz.lon, W, H);
        const stress = faultStress[fz.id];
        const risk = stress?.level ?? fz.risk;
        const col = getRiskColor(risk);
        const isSelected = selectedFault?.id === fz.id;

        // fault line
        ctx.save();
        ctx.translate(x,y); ctx.rotate(-0.28);
        const lineLen = Math.min(fz.length/8, 60);
        ctx.beginPath(); ctx.moveTo(-lineLen/2,0); ctx.lineTo(lineLen/2,0);
        ctx.strokeStyle = isSelected ? col : col+"88";
        ctx.lineWidth = isSelected ? 3 : 1.5;
        ctx.shadowBlur = isSelected ? 16 : 6; ctx.shadowColor = col;
        ctx.stroke(); ctx.restore();

        // stress glow
        if (risk > 0.75) {
          const pulse = (Math.sin(pulseRef.current * 0.05 + fz.lat) + 1) / 2;
          ctx.beginPath(); ctx.arc(x,y,8+pulse*4,0,Math.PI*2);
          ctx.fillStyle = col + Math.round(pulse*60+20).toString(16).padStart(2,"0");
          ctx.fill();
        }

        // dot
        ctx.beginPath(); ctx.arc(x,y,isSelected?7:5,0,Math.PI*2);
        ctx.fillStyle = col; ctx.shadowBlur=12; ctx.shadowColor=col; ctx.fill(); ctx.shadowBlur=0;

        if (isSelected || risk > 0.8) {
          ctx.fillStyle="#C8D8E8"; ctx.font=`${isSelected?"bold ":""}10px Inter,sans-serif`;
          ctx.fillText(fz.name, x+10, y-6);
        }
      });

      // earthquake dots
      quakes.forEach(q => {
        const {x,y} = toXY(q.geometry.coordinates[1], q.geometry.coordinates[0], W, H);
        if(x<0||x>W||y<0||y>H) return;
        const mag = q.properties.mag;
        const col = getMagColor(mag);
        const r = Math.max(3, mag*2.2);

        if (mag >= 5) {
          const pulse = (Math.sin(pulseRef.current*0.06 + x*0.1) + 1)/2;
          ctx.beginPath(); ctx.arc(x,y,r+pulse*r*1.5,0,Math.PI*2);
          ctx.fillStyle = col + "30"; ctx.fill();
        }

        ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
        ctx.fillStyle = col; ctx.shadowBlur = mag>=5?16:6; ctx.shadowColor=col; ctx.fill(); ctx.shadowBlur=0;

        if (mag >= 6) {
          ctx.fillStyle="#FFF"; ctx.font="bold 9px 'JetBrains Mono',monospace"; ctx.textAlign="center";
          ctx.fillText(`M${mag.toFixed(1)}`,x,y-r-3); ctx.textAlign="left";
        }
      });

      // country labels
      [["VENEZUELA",-71.5,8.8],["COLOMBIA",-74.5,5.5],["TRINIDAD",-61.5,10.6],["GUYANA",-59,6]].forEach(([name,lon,lat]) => {
        const {x,y} = toXY(lat,lon,W,H);
        if(x>0&&x<W&&y>0&&y<H){
          ctx.fillStyle="rgba(74,127,165,0.5)"; ctx.font="bold 11px Inter,sans-serif";
          ctx.letterSpacing="0.15em"; ctx.fillText(name,x,y);
        }
      });

      pulseRef.current++;
      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [quakes, faultStress, selectedFault, showHeatmap, toXY]);

  const handleClick = useCallback((e) => {
    const rect = ref.current.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (ref.current.width / rect.width);
    const my = (e.clientY - rect.top)  * (ref.current.height / rect.height);
    const W = ref.current.width, H = ref.current.height;

    let closest = null, minDist = 20;
    FAULT_ZONES.forEach(fz => {
      const {x,y} = toXY(fz.lat, fz.lon, W, H);
      const d = Math.sqrt((mx-x)**2+(my-y)**2);
      if (d < minDist) { minDist=d; closest=fz; }
    });
    onSelectFault(closest);
  }, [onSelectFault, toXY]);

  return (
    <div style={{position:"relative"}}>
      <canvas ref={ref} width={720} height={420}
        onClick={handleClick}
        style={{width:"100%",height:"420px",borderRadius:"0 0 12px 12px",cursor:"crosshair",display:"block"}}
      />
    </div>
  );
};

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────
export default function SeismicV2() {
  const [quakes, setQuakes]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [timeRange, setTimeRange]     = useState("week");
  const [tab, setTab]                 = useState("monitor");
  const [selectedFault, setSelectedFault] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [filter, setFilter]           = useState("all");
  const [lastUpdate, setLastUpdate]   = useState(null);
  const [alerts, setAlerts]           = useState([]);

  // fetch
  const fetchQuakes = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const days = { day:1, week:7, month:30 }[timeRange];
      const start = new Date(Date.now() - days*864e5).toISOString();
      const url = `${USGS_API}?format=geojson&starttime=${start}&minlatitude=-5&maxlatitude=18&minlongitude=-85&maxlongitude=-55&minmagnitude=2&orderby=time&limit=300`;
      const r = await fetch(url);
      if (!r.ok) throw new Error("Sin respuesta del USGS");
      const d = await r.json();
      const features = d.features || [];
      setQuakes(features);
      setLastUpdate(new Date());
      // auto-alerts for M5+
      const newAlerts = features.filter(q=>q.properties.mag>=5).slice(0,5).map(q=>({
        id: q.id,
        msg: `M${q.properties.mag.toFixed(1)} · ${q.properties.place?.split(",")[0]||"Zona Andina"}`,
        mag: q.properties.mag,
        time: fmtTime(q.properties.time),
        depth: q.geometry.coordinates[2]?.toFixed(0),
      }));
      setAlerts(newAlerts);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }, [timeRange]);

  useEffect(() => { fetchQuakes(); const i=setInterval(fetchQuakes,60000); return ()=>clearInterval(i); }, [fetchQuakes]);

  // derived
  const faultStress = useMemo(() => {
    const out = {};
    FAULT_ZONES.forEach(fz => { out[fz.id] = estimateStress(quakes, fz); });
    return out;
  }, [quakes]);

  const mainshock = useMemo(() => quakes.slice(0,50).reduce((a,b)=>(!a||b.properties.mag>a.properties.mag)?b:a, null), [quakes]);
  const aftershockData = useMemo(() => computeAftershockForecast(mainshock), [mainshock]);

  const filtered = useMemo(() => quakes.filter(q => {
    if (filter==="critical") return q.properties.mag>=6;
    if (filter==="strong")   return q.properties.mag>=5&&q.properties.mag<6;
    if (filter==="moderate") return q.properties.mag>=3&&q.properties.mag<5;
    return true;
  }), [quakes, filter]);

  const stats = useMemo(() => ({
    total: quakes.length,
    critical: quakes.filter(q=>q.properties.mag>=6).length,
    strong:   quakes.filter(q=>q.properties.mag>=5&&q.properties.mag<6).length,
    maxMag:   quakes.length ? Math.max(...quakes.map(q=>q.properties.mag)).toFixed(1) : "—",
    avgDepth: quakes.length ? (quakes.reduce((a,q)=>a+(q.geometry.coordinates[2]||0),0)/quakes.length).toFixed(0)+"km" : "—",
    energy:   quakes.length ? (quakes.reduce((a,q)=>a+Math.pow(10,1.5*q.properties.mag+4.8),0)) : 0,
  }), [quakes]);

  const highestRisk = useMemo(() => FAULT_ZONES.map(fz=>({...fz, currentRisk: faultStress[fz.id]?.level??fz.risk})).sort((a,b)=>b.currentRisk-a.currentRisk)[0], [faultStress]);

  // ─── STYLES ───
  const S = {
    app: { background:"#050A0F", minHeight:"100vh", color:"#C8D8E8", fontFamily:"'Inter',sans-serif", fontSize:"13px" },
    card: { background:"#080F18", border:"1px solid #1E3A5F", borderRadius:"12px", overflow:"hidden" },
    tab: (active) => ({
      padding:"8px 20px", border:"none", background:"transparent", cursor:"pointer",
      fontFamily:"'JetBrains Mono',monospace", fontSize:"11px", letterSpacing:"0.06em",
      color: active?"#050A0F":"#4A7FA5",
      background: active?"#00D4FF":"transparent",
      borderRadius:"6px", transition:"all 0.2s",
    }),
    chip: (active, ac, ic) => ({
      padding:"4px 12px", borderRadius:"20px", border:`1px solid ${active?ac:ic||"#1E3A5F"}`,
      background: active?ac+"22":"transparent", color:active?ac:"#4A7FA5",
      cursor:"pointer", fontSize:"11px", fontFamily:"'JetBrains Mono',monospace",
    }),
    mono: { fontFamily:"'JetBrains Mono',monospace" },
    label: { fontSize:"10px", color:"#4A7FA5", letterSpacing:"0.08em", marginBottom:"6px" },
  };

  const TABS = [
    { id:"monitor",    icon:"📡", label:"MONITOREO" },
    { id:"stress",     icon:"🌋", label:"PRESIÓN TECTÓNICA" },
    { id:"forecast",   icon:"📈", label:"PREDICCIÓN RÉPLICAS" },
    { id:"alerts",     icon:"🚨", label:`ALERTAS ${alerts.length>0?`(${alerts.length})`:""}` },
    { id:"data",       icon:"📋", label:"DATOS" },
  ];

  return (
    <div style={S.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;} ::-webkit-scrollbar-track{background:#0D1B2A;} ::-webkit-scrollbar-thumb{background:#1E3A5F;border-radius:2px;}
        @keyframes pulse{0%,100%{transform:scale(1);opacity:1;}50%{transform:scale(2.2);opacity:0.3;}}
        @keyframes blink{0%,100%{opacity:1;}50%{opacity:0.2;}}
        @keyframes slideIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
        .hover-row:hover{background:rgba(0,212,255,0.05)!important;cursor:pointer;}
        .hover-card:hover{border-color:#00D4FF!important;}
      `}</style>

      {/* ── HEADER ── */}
      <div style={{background:"linear-gradient(180deg,#0D1B2A 0%,#050A0F 100%)",borderBottom:"1px solid #1E3A5F"}}>
        <div style={{opacity:0.55}}><SineWave color="#00D4FF" amplitude={9} frequency={1} speed={2} /></div>

        <div style={{padding:"10px 20px 14px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:"14px"}}>
            <div style={{width:"40px",height:"40px",borderRadius:"10px",background:"linear-gradient(135deg,#00D4FF22,#00D4FF44)",border:"1px solid #00D4FF55",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"20px"}}>🌍</div>
            <div>
              <div style={{...S.mono,fontSize:"15px",fontWeight:700,color:"#00D4FF",letterSpacing:"0.1em"}}>SISMÓGRAFO ANDINO v2.0</div>
              <div style={{fontSize:"11px",color:"#4A7FA5"}}>Monitor sísmico · Venezuela & Colombia · USGS · Modelo Omori-Utsu</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:"16px"}}>
            {highestRisk && (
              <div style={{padding:"6px 14px",borderRadius:"8px",background:getRiskColor(highestRisk.currentRisk)+"18",border:`1px solid ${getRiskColor(highestRisk.currentRisk)}44`}}>
                <div style={{fontSize:"9px",color:"#4A7FA5",marginBottom:"2px"}}>ZONA MÁS ACTIVA</div>
                <div style={{...S.mono,fontSize:"11px",color:getRiskColor(highestRisk.currentRisk)}}>{highestRisk.name} · {getRiskLabel(highestRisk.currentRisk)}</div>
              </div>
            )}
            <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
              <div style={{width:"7px",height:"7px",borderRadius:"50%",background:loading?"#FF9F0A":"#34C759",animation:"blink 1.5s infinite",boxShadow:`0 0 6px ${loading?"#FF9F0A":"#34C759"}`}} />
              <span style={{...S.mono,fontSize:"11px",color:loading?"#FF9F0A":"#34C759"}}>{loading?"SYNC...":"EN VIVO"}</span>
            </div>
            <button onClick={fetchQuakes} style={{background:"transparent",border:"1px solid #1E3A5F",color:"#00D4FF",padding:"6px 14px",borderRadius:"6px",cursor:"pointer",...S.mono,fontSize:"11px"}}>⟳</button>
          </div>
        </div>

        <div style={{opacity:0.3}}><SineWave color="#FF3B30" amplitude={5} frequency={2.5} speed={3.5} /></div>

        {/* TABS */}
        <div style={{padding:"0 20px 12px",display:"flex",gap:"6px",flexWrap:"wrap"}}>
          {TABS.map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)} style={S.tab(tab===t.id)}>
              {t.icon} {t.label}
            </button>
          ))}
          <div style={{marginLeft:"auto",display:"flex",gap:"8px",alignItems:"center"}}>
            {["day","week","month"].map((v,_,arr)=>(
              <button key={v} onClick={()=>setTimeRange(v)} style={S.chip(timeRange===v,"#00D4FF")}>
                {v==="day"?"24H":v==="week"?"7D":"30D"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:"14px"}}>

        {/* STAT STRIP */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:"10px"}}>
          {[
            {label:"SISMOS",  val:stats.total,    color:"#00D4FF", icon:"📡"},
            {label:"CRÍTICOS M6+", val:stats.critical, color:"#FF3B30", icon:"🚨"},
            {label:"FUERTES M5+", val:stats.strong, color:"#FF9F0A", icon:"⚠️"},
            {label:"MÁX. MAGNITUD",val:stats.maxMag, color:"#FF3B30", icon:"📊"},
            {label:"PROF. MEDIA",  val:stats.avgDepth, color:"#34C759", icon:"⬇️"},
          ].map((s,i)=>(
            <div key={i} className="hover-card" style={{...S.card,padding:"12px 14px",transition:"all 0.2s"}}>
              <div style={{...S.label,display:"flex",gap:"6px"}}><span>{s.icon}</span>{s.label}</div>
              <div style={{...S.mono,fontSize:"24px",fontWeight:700,color:s.color,textShadow:`0 0 18px ${s.color}44`}}>{s.val}</div>
            </div>
          ))}
        </div>

        {/* ════ TAB: MONITOR ════ */}
        {tab==="monitor" && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 280px",gap:"14px",animation:"slideIn 0.3s ease"}}>
            <div style={S.card}>
              <div style={{padding:"12px 16px",borderBottom:"1px solid #1E3A5F",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{...S.label,marginBottom:0}}>🗺️ MAPA SÍSMICO EN TIEMPO REAL</span>
                <button onClick={()=>setShowHeatmap(h=>!h)} style={S.chip(showHeatmap,"#FF9F0A")}>
                  🔥 HEATMAP {showHeatmap?"ON":"OFF"}
                </button>
              </div>
              <SeismicMap quakes={filtered} faultStress={faultStress} selectedFault={selectedFault} onSelectFault={setSelectedFault} showHeatmap={showHeatmap} />
            </div>

            <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
              {/* Selected fault detail */}
              {selectedFault && (
                <div style={{...S.card,padding:"14px",border:`1px solid ${getRiskColor(faultStress[selectedFault.id]?.level??selectedFault.risk)}44`,animation:"slideIn 0.2s ease"}}>
                  <div style={{...S.label}}>ZONA SELECCIONADA</div>
                  <div style={{fontWeight:600,color:"#C8D8E8",marginBottom:"8px"}}>{selectedFault.name}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                    {[
                      ["Tipo",selectedFault.type],
                      ["País",selectedFault.country],
                      ["Long.",`${selectedFault.length} km`],
                      ["Eventos",`${faultStress[selectedFault.id]?.events??0} sismos`],
                    ].map(([k,v])=>(
                      <div key={k} style={{background:"#0D1B2A",borderRadius:"6px",padding:"8px"}}>
                        <div style={{...S.label,marginBottom:"2px"}}>{k}</div>
                        <div style={{...S.mono,fontSize:"12px",color:"#8AAABF"}}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{marginTop:"10px"}}>
                    <div style={{...S.label}}>NIVEL DE ESTRÉS TECTÓNICO</div>
                    <StressGauge value={faultStress[selectedFault.id]?.level??selectedFault.risk} label={getRiskLabel(faultStress[selectedFault.id]?.level??selectedFault.risk)} color={getRiskColor(faultStress[selectedFault.id]?.level??selectedFault.risk)} />
                  </div>
                  <button onClick={()=>setSelectedFault(null)} style={{marginTop:"8px",width:"100%",background:"transparent",border:"1px solid #1E3A5F",color:"#4A7FA5",padding:"6px",borderRadius:"6px",cursor:"pointer",fontSize:"11px"}}>✕ CERRAR</button>
                </div>
              )}

              {/* Top events */}
              <div style={S.card}>
                <div style={{padding:"10px 14px",borderBottom:"1px solid #1E3A5F"}}><span style={S.label}>🔺 TOP EVENTOS</span></div>
                {[...quakes].sort((a,b)=>b.properties.mag-a.properties.mag).slice(0,6).map((q,i)=>(
                  <div key={q.id} className="hover-row" style={{padding:"8px 14px",borderBottom:"1px solid #0D1B2A",display:"flex",gap:"10px",alignItems:"center"}}>
                    <div style={{...S.mono,fontWeight:700,fontSize:"16px",color:getMagColor(q.properties.mag),minWidth:"44px",textShadow:`0 0 10px ${getMagColor(q.properties.mag)}55`}}>M{q.properties.mag?.toFixed(1)}</div>
                    <div style={{flex:1,overflow:"hidden"}}>
                      <div style={{color:"#8AAABF",fontSize:"11px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{q.properties.place?.split(",")[0]||"Zona Andina"}</div>
                      <div style={{...S.mono,fontSize:"10px",color:"#4A7FA5"}}>{fmtDate(q.properties.time)} · {q.geometry.coordinates[2]?.toFixed(0)}km prof.</div>
                    </div>
                    <div style={{fontSize:"9px",padding:"2px 6px",borderRadius:"8px",background:getMagColor(q.properties.mag)+"22",color:getMagColor(q.properties.mag),...S.mono}}>{getMagLabel(q.properties.mag)}</div>
                  </div>
                ))}
              </div>

              {/* Seismographs */}
              <div style={{...S.card,padding:"14px"}}>
                <div style={{...S.label,marginBottom:"12px"}}>📈 ESTACIONES SÍSMICAS</div>
                {[
                  {label:"EST. VEN-01 · Caracas",  intensity: Math.min(1,(stats.critical||0)*0.4+(stats.strong||0)*0.15), color:"#FF3B30"},
                  {label:"EST. COL-04 · Bogotá",   intensity: Math.min(1,(stats.strong||0)*0.25+(stats.total||0)*0.003), color:"#FF9F0A"},
                  {label:"EST. AND-07 · Andes",    intensity: Math.min(0.4,(stats.total||0)*0.002), color:"#00D4FF"},
                ].map((s,i)=><div key={i} style={{marginBottom:"10px"}}><Seismograph {...s} /></div>)}
              </div>
            </div>
          </div>
        )}

        {/* ════ TAB: STRESS ════ */}
        {tab==="stress" && (
          <div style={{animation:"slideIn 0.3s ease"}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"12px",marginBottom:"14px"}}>
              {FAULT_ZONES.map(fz => {
                const stress = faultStress[fz.id] || { level: fz.risk, events: 0, energy: 0 };
                const col = getRiskColor(stress.level);
                return (
                  <div key={fz.id} className="hover-card" onClick={()=>{setSelectedFault(fz);setTab("monitor");}}
                    style={{...S.card,padding:"16px",cursor:"pointer",transition:"all 0.2s",border:`1px solid ${col}33`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"10px"}}>
                      <div>
                        <div style={{fontWeight:600,color:"#C8D8E8",fontSize:"13px",marginBottom:"3px"}}>{fz.name}</div>
                        <div style={{fontSize:"11px",color:"#4A7FA5"}}>{fz.country} · {fz.type}</div>
                      </div>
                      <div style={{fontSize:"9px",padding:"3px 8px",borderRadius:"10px",background:col+"22",color:col,...S.mono}}>{getRiskLabel(stress.level)}</div>
                    </div>
                    <StressGauge value={stress.level} label={`${Math.round(stress.level*100)}% presión`} color={col} />
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"6px",marginTop:"10px"}}>
                      {[
                        {k:"Longitud",v:`${fz.length}km`},
                        {k:"Sismos cercanos",v:stress.events},
                        {k:"Energía log",v:stress.energy||"—"},
                      ].map(({k,v})=>(
                        <div key={k} style={{background:"#0D1B2A",borderRadius:"6px",padding:"7px",textAlign:"center"}}>
                          <div style={{fontSize:"9px",color:"#4A7FA5",marginBottom:"3px"}}>{k}</div>
                          <div style={{...S.mono,fontSize:"12px",color:col}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    {stress.level >= 0.85 && (
                      <div style={{marginTop:"10px",padding:"7px 10px",borderRadius:"6px",background:"#FF3B3018",border:"1px solid #FF3B3044",fontSize:"11px",color:"#FF6B6B"}}>
                        ⚠️ Zona en observación prioritaria
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{...S.card,padding:"16px"}}>
              <div style={{...S.label,marginBottom:"12px"}}>📊 COMPARATIVA DE ESTRÉS TECTÓNICO</div>
              <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                {FAULT_ZONES.sort((a,b)=>(faultStress[b.id]?.level||b.risk)-(faultStress[a.id]?.level||a.risk)).map(fz=>{
                  const stress = faultStress[fz.id]||{level:fz.risk};
                  const col = getRiskColor(stress.level);
                  return (
                    <div key={fz.id} style={{display:"flex",alignItems:"center",gap:"12px"}}>
                      <div style={{width:"180px",fontSize:"12px",color:"#8AAABF",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{fz.name}</div>
                      <div style={{flex:1,height:"10px",background:"#0D1B2A",borderRadius:"5px",overflow:"hidden"}}>
                        <div style={{width:`${stress.level*100}%`,height:"100%",background:`linear-gradient(90deg,${col}88,${col})`,borderRadius:"5px",transition:"width 0.6s ease",boxShadow:`0 0 8px ${col}44`}} />
                      </div>
                      <div style={{...S.mono,fontSize:"13px",fontWeight:700,color:col,width:"40px",textAlign:"right"}}>{Math.round(stress.level*100)}%</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ════ TAB: FORECAST ════ */}
        {tab==="forecast" && mainshock && (
          <div style={{animation:"slideIn 0.3s ease",display:"flex",flexDirection:"column",gap:"14px"}}>
            <div style={{...S.card,padding:"16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"14px"}}>
                <div>
                  <div style={{...S.label}}>SISMO PRINCIPAL ANALIZADO</div>
                  <div style={{display:"flex",alignItems:"baseline",gap:"10px"}}>
                    <span style={{...S.mono,fontSize:"36px",fontWeight:700,color:getMagColor(mainshock.properties.mag),textShadow:`0 0 25px ${getMagColor(mainshock.properties.mag)}55`}}>M{mainshock.properties.mag?.toFixed(1)}</span>
                    <span style={{color:"#8AAABF"}}>{mainshock.properties.place}</span>
                  </div>
                  <div style={{...S.mono,fontSize:"11px",color:"#4A7FA5",marginTop:"4px"}}>{fmtTime(mainshock.properties.time)} · {mainshock.geometry.coordinates[2]?.toFixed(0)}km profundidad</div>
                </div>
                <div style={{padding:"10px 16px",borderRadius:"8px",background:"#FF9F0A18",border:"1px solid #FF9F0A44",textAlign:"center"}}>
                  <div style={{...S.label}}>MODELO</div>
                  <div style={{...S.mono,fontSize:"12px",color:"#FF9F0A"}}>Omori-Utsu</div>
                  <div style={{fontSize:"10px",color:"#4A7FA5",marginTop:"2px"}}>p=1.1 · b=1.0</div>
                </div>
              </div>

              <div style={{...S.label,marginBottom:"8px"}}>TASA DE RÉPLICAS ESPERADA — 7 DÍAS</div>
              <AfterShockChart data={aftershockData} mainMag={mainshock.properties.mag} />

              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"10px",marginTop:"14px"}}>
                {[
                  {label:"Réplicas esperadas 24h", val: aftershockData.find(d=>d.t>=24)?.cumulative?.toFixed(0)||"—", color:"#FF9F0A"},
                  {label:"Réplicas esperadas 7d",  val: aftershockData[aftershockData.length-1]?.cumulative?.toFixed(0)||"—", color:"#FF9F0A"},
                  {label:"Prob. M5+ en 24h",       val: `${((aftershockData.slice(0,24).reduce((s,d)=>s+d.pM5,0))*100).toFixed(1)}%`, color:"#FF3B30"},
                  {label:"Prob. M6+ en 7d",        val: `${((aftershockData.reduce((s,d)=>s+d.pM6,0))*100).toFixed(2)}%`, color:"#FF3B30"},
                ].map(({label,val,color})=>(
                  <div key={label} style={{...S.card,padding:"12px 14px"}}>
                    <div style={{...S.label}}>{label}</div>
                    <div style={{...S.mono,fontSize:"22px",fontWeight:700,color,textShadow:`0 0 15px ${color}44`}}>{val}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{...S.card,padding:"16px"}}>
              <div style={{...S.label,marginBottom:"12px"}}>📅 PRONÓSTICO HORA A HORA (primeras 24h)</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(8,1fr)",gap:"6px"}}>
                {aftershockData.filter(d=>d.t<=24).map(d=>{
                  const intensity = d.rate / aftershockData[0].rate;
                  const col = intensity>0.5?"#FF3B30":intensity>0.2?"#FF9F0A":"#34C759";
                  return (
                    <div key={d.t} style={{background:"#0D1B2A",borderRadius:"6px",padding:"8px 6px",textAlign:"center",border:`1px solid ${col}22`}}>
                      <div style={{fontSize:"9px",color:"#4A7FA5",marginBottom:"3px"}}>{d.t}h</div>
                      <div style={{height:"30px",display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
                        <div style={{width:"12px",background:col,height:`${Math.max(4,intensity*30)}px`,borderRadius:"2px 2px 0 0",boxShadow:`0 0 6px ${col}55`}} />
                      </div>
                      <div style={{...S.mono,fontSize:"9px",color:col,marginTop:"3px"}}>{d.rate.toFixed(2)}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{marginTop:"10px",fontSize:"11px",color:"#4A7FA5",padding:"8px 12px",background:"#0D1B2A",borderRadius:"6px"}}>
                ℹ️ Modelo Omori-Utsu estándar. La predicción exacta de sismos no existe científicamente; estos son valores estadísticos de probabilidad basados en el historial global de sismicidad.
              </div>
            </div>
          </div>
        )}

        {/* ════ TAB: ALERTS ════ */}
        {tab==="alerts" && (
          <div style={{animation:"slideIn 0.3s ease",display:"flex",flexDirection:"column",gap:"12px"}}>
            <div style={{...S.card,padding:"16px",border:"1px solid #FF3B3033"}}>
              <div style={{...S.label,color:"#FF3B30",marginBottom:"14px"}}>🚨 SISTEMA DE ALERTAS ACTIVAS</div>
              {alerts.length===0 ? (
                <div style={{textAlign:"center",padding:"30px",color:"#4A7FA5"}}>✅ No hay alertas M5+ en el período seleccionado</div>
              ) : alerts.map((a,i)=>(
                <div key={a.id} style={{display:"flex",gap:"14px",alignItems:"center",padding:"12px",borderRadius:"8px",background:"#FF3B3010",border:"1px solid #FF3B3033",marginBottom:"8px",animation:"slideIn 0.3s ease"}}>
                  <div style={{fontSize:"28px"}}>⚠️</div>
                  <div style={{flex:1}}>
                    <div style={{...S.mono,fontSize:"18px",fontWeight:700,color:getMagColor(a.mag)}}>{a.msg}</div>
                    <div style={{...S.mono,fontSize:"11px",color:"#4A7FA5",marginTop:"3px"}}>{a.time} · Profundidad: {a.depth}km</div>
                  </div>
                  <div style={{fontSize:"9px",padding:"4px 10px",borderRadius:"10px",background:getMagColor(a.mag)+"22",color:getMagColor(a.mag),...S.mono}}>{getMagLabel(a.mag)}</div>
                </div>
              ))}
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
              <div style={S.card}>
                <div style={{padding:"12px 16px",borderBottom:"1px solid #1E3A5F"}}><span style={S.label}>📊 DISTRIBUCIÓN DE MAGNITUDES</span></div>
                <div style={{padding:"16px",display:"flex",flexDirection:"column",gap:"8px"}}>
                  {[[7,"M7+","CRÍTICO"],[6,"M6-7","MAYOR"],[5,"M5-6","FUERTE"],[4,"M4-5","MODERADO"],[3,"M3-4","MENOR"],[0,"M2-3","MICRO"]].map(([min,range,label])=>{
                    const max2 = min===7?99:min+1;
                    const count = quakes.filter(q=>q.properties.mag>=min&&(min===7||q.properties.mag<max2)).length;
                    const pct = quakes.length ? (count/quakes.length)*100 : 0;
                    const col = getMagColor(min+0.5);
                    return (
                      <div key={min} style={{display:"flex",alignItems:"center",gap:"10px"}}>
                        <div style={{...S.mono,fontSize:"11px",color:col,width:"50px"}}>{range}</div>
                        <div style={{flex:1,height:"16px",background:"#0D1B2A",borderRadius:"3px",overflow:"hidden"}}>
                          <div style={{width:`${pct}%`,height:"100%",background:col,borderRadius:"3px",transition:"width 0.6s",opacity:0.85}} />
                        </div>
                        <div style={{...S.mono,fontSize:"11px",color:"#4A7FA5",width:"30px",textAlign:"right"}}>{count}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={S.card}>
                <div style={{padding:"12px 16px",borderBottom:"1px solid #1E3A5F"}}><span style={S.label}>⚡ ENERGÍA LIBERADA</span></div>
                <div style={{padding:"20px",textAlign:"center"}}>
                  <div style={{...S.mono,fontSize:"11px",color:"#4A7FA5",marginBottom:"8px"}}>ENERGÍA SÍSMICA TOTAL</div>
                  <div style={{...S.mono,fontSize:"28px",fontWeight:700,color:"#FF9F0A",textShadow:"0 0 20px #FF9F0A44"}}>
                    {stats.energy > 0 ? `${(Math.log10(stats.energy)).toFixed(1)}` : "—"}
                  </div>
                  <div style={{fontSize:"11px",color:"#4A7FA5",marginTop:"4px"}}>log₁₀ Julios</div>
                  <div style={{marginTop:"20px",padding:"10px",background:"#0D1B2A",borderRadius:"8px",fontSize:"11px",color:"#8AAABF"}}>
                    Equivalente a <span style={{color:"#FF9F0A",...S.mono}}>{stats.energy>0?(Math.pow(10,Math.log10(stats.energy)-15)).toFixed(1):"—"}</span> bombas atómicas estándar (15kt)
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ════ TAB: DATA ════ */}
        {tab==="data" && (
          <div style={{animation:"slideIn 0.3s ease"}}>
            <div style={{display:"flex",gap:"8px",marginBottom:"12px",flexWrap:"wrap"}}>
              {[["all","TODOS"],["critical","M6+ CRÍTICOS"],["strong","M5+ FUERTES"],["moderate","M3-5 MODERADOS"]].map(([v,l])=>(
                <button key={v} onClick={()=>setFilter(v)} style={S.chip(filter===v,"#FF9F0A")}>
                  {l}
                </button>
              ))}
              <div style={{marginLeft:"auto",...S.mono,fontSize:"11px",color:"#4A7FA5",alignSelf:"center"}}>
                {filtered.length} eventos
              </div>
            </div>
            <div style={S.card}>
              <div style={{maxHeight:"480px",overflowY:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead>
                    <tr style={{background:"#0D1B2A",position:"sticky",top:0,zIndex:1}}>
                      {["MAG","NIVEL","UBICACIÓN","PROF.","LAT","LON","FECHA/HORA"].map(h=>(
                        <th key={h} style={{padding:"9px 12px",textAlign:"left",fontSize:"10px",color:"#4A7FA5",letterSpacing:"0.07em",fontWeight:500}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((q,i)=>{
                      const mag=q.properties.mag, col=getMagColor(mag);
                      return (
                        <tr key={q.id} className="hover-row" style={{borderBottom:"1px solid #0D1B2A",background:i%2===0?"transparent":"rgba(13,27,42,0.3)"}}>
                          <td style={{padding:"8px 12px"}}>
                            <span style={{...S.mono,fontWeight:700,fontSize:"15px",color:col,textShadow:`0 0 10px ${col}44`}}>M{mag?.toFixed(1)}</span>
                          </td>
                          <td style={{padding:"8px 12px"}}>
                            <span style={{fontSize:"10px",padding:"2px 7px",borderRadius:"8px",background:col+"18",color:col,...S.mono}}>{getMagLabel(mag)}</span>
                          </td>
                          <td style={{padding:"8px 12px",color:"#8AAABF",maxWidth:"180px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{q.properties.place||"Zona Andina"}</td>
                          <td style={{padding:"8px 12px",...S.mono,color:"#4A7FA5",fontSize:"12px"}}>{q.geometry.coordinates[2]?.toFixed(0)}km</td>
                          <td style={{padding:"8px 12px",...S.mono,fontSize:"11px",color:"#4A7FA5"}}>{q.geometry.coordinates[1]?.toFixed(3)}°</td>
                          <td style={{padding:"8px 12px",...S.mono,fontSize:"11px",color:"#4A7FA5"}}>{q.geometry.coordinates[0]?.toFixed(3)}°</td>
                          <td style={{padding:"8px 12px",...S.mono,fontSize:"11px",color:"#4A7FA5"}}>{fmtTime(q.properties.time)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* FOOTER */}
        <div style={{textAlign:"center",padding:"8px 0",borderTop:"1px solid #0D1B2A"}}>
          <span style={{...S.mono,fontSize:"10px",color:"#1E3A5F"}}>
            USGS Earthquake Hazards Program · Modelo Omori-Utsu (1894/1961) · Gutenberg-Richter · Actualización cada 60s
          </span>
        </div>
      </div>
    </div>
  );
}
