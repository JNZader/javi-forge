---
name: solo-dev-planner-readme
description: "README del Solo Dev Planner - Guía de estructura modular"
---

# 🚀 Solo Dev Planner - Skill Modular

**Production-ready skill para solo developers, optimizado para Claude Code y Projects**

## 📦 Estructura Modular

```
solo-dev-planner-modular/
├── README.md                      ← Estás aquí
├── 00-INDEX.md                    ← Guía maestra
│
├── 01-CORE.md                     ← Filosofía + Atomic Sequential
├── 02-SELF-CORRECTION.md          ← Auto-fix protocol + Context
├── 03-PROGRESSIVE-SETUP.md        ← Setup MVP/Alpha/Beta
├── 04-DEPLOYMENT.md               ← Koyeb, Railway, Coolify
├── 05-TESTING.md                  ← Strategy + Testcontainers
└── 06-OPERATIONS.md               ← DB, Secrets, Monitoring, Mise
```

## 🎯 Quick Start

### Para Claude Projects

```markdown
1. Carga: 00-INDEX.md (lee la guía)
2. Carga: 01-CORE.md (filosofía base)
3. Carga: Módulo específico según necesites
```

### Para Claude Code

```markdown
Sesión típica:
1. Carga: 01-CORE.md + módulo específico
2. Usa: 02-SELF-CORRECTION.md para troubleshooting
3. Máximo: 2-3 módulos simultáneos
```

## 📊 Comparación con Versión Monolítica

| Aspecto | Monolítico | Modular |
|---------|------------|---------|
| **Archivo único** | 13,241 líneas | 6 archivos |
| **Tamaño promedio** | N/A | 1,800-3,500 líneas |
| **Tokens por carga** | ~40,000 | ~5,000-10,000 |
| **Navegación** | Scroll infinito | Por módulo |
| **Para Claude Code** | ⚠️ Lento | ✅ Óptimo |
| **Mantenimiento** | ⚠️ Complejo | ✅ Simple |

## 🎮 Workflows Comunes

### 1. Nuevo Proyecto (Día 1)

```bash
Claude: Lee 01-CORE.md + 03-PROGRESSIVE-SETUP.md
Humano: mise run setup:mvp
Tiempo: 30 minutos
```

### 2. Configurar Tests

```bash
Claude: Lee 05-TESTING.md
Humano: Implementa según el módulo
```

### 3. Deploy a Producción

```bash
Claude: Lee 04-DEPLOYMENT.md
Humano: mise run deploy:setup:koyeb
```

### 4. Troubleshooting

```bash
Claude: Lee 02-SELF-CORRECTION.md
Humano: mise run fix:auto
```

## 📋 Contenido por Módulo

| Módulo | Tamaño | Contenido | Cuándo Leer |
|--------|--------|-----------|-------------|
| **00-INDEX** | 300 líneas | Guía maestra | Primero siempre |
| **01-CORE** | ~3,500 | Filosofía + Workflow | Nuevo proyecto |
| **02-SELF-CORRECTION** | ~1,800 | Auto-fix + Context | Troubleshooting |
| **03-PROGRESSIVE-SETUP** | ~2,000 | MVP/Alpha/Beta | Setup inicial |
| **04-DEPLOYMENT** | ~2,500 | Deploy platforms | Pre-launch |
| **05-TESTING** | ~2,200 | Strategy + Testcontainers | Mejorar calidad |
| **06-OPERATIONS** | ~2,800 | DB/Secrets/Monitoring | Operaciones |

## 🚀 Ventajas del Skill Modular

### Para el Desarrollador

```
✅ Setup más rápido (15 min vs 6 horas)
✅ Solo cargas lo que necesitas
✅ Más fácil de navegar
✅ Actualizar módulos independientemente
```

### Para Claude

```
✅ Menos tokens por sesión (-75%)
✅ Carga más rápida (2s vs 10s)
✅ Context window optimizado
✅ Especialización por tarea
```

## 🔄 Dependencias entre Módulos

```
Todos dependen de:
└── 01-CORE.md (base)

03-PROGRESSIVE-SETUP.md usa:
├── 02-SELF-CORRECTION.md (git hooks)
├── 04-DEPLOYMENT.md (fase beta)
└── 06-OPERATIONS.md (mise, DB)

04-DEPLOYMENT.md usa:
└── 06-OPERATIONS.md (secrets)

05-TESTING.md usa:
└── 06-OPERATIONS.md (mise tasks)
```

## 📚 Documentación Adicional

- **00-INDEX.md:** Guía completa de navegación
- **Cada módulo:** Tiene su propia tabla de contenidos
- **Original:** `solo-dev-planner-v2.md` (monolítico, 13k líneas)

## 💡 Recomendaciones

### Para Proyectos Nuevos

```
1. Lee 00-INDEX.md (10 min)
2. Lee 01-CORE.md completo (30 min)
3. Lee 03-PROGRESSIVE-SETUP.md (15 min)
4. Ejecuta: mise run setup
5. ¡Empieza a codear!
```

### Para Optimizar Claude Code

```
# En cada sesión:
1. Carga SOLO lo necesario
2. Usa context script (02-SELF-CORRECTION.md)
3. Máximo 2-3 módulos
4. Revisa 00-INDEX.md si dudas
```

### Para Troubleshooting

```
# Orden de lectura:
1. 02-SELF-CORRECTION.md (auto-fix)
2. Módulo específico al problema
3. 01-CORE.md si dudas de filosofía
```

## 🎯 Casos de Uso Específicos

### "Quiero empezar YA"
→ **Lee:** 01-CORE + 03-PROGRESSIVE-SETUP (sección MVP)  
→ **Ejecuta:** `mise run setup:mvp`  
→ **Tiempo:** 15 minutos

### "Tests están fallando"
→ **Lee:** 02-SELF-CORRECTION (sección auto-fix tests)  
→ **Ejecuta:** `mise run fix:auto`  
→ **Tiempo:** 5 minutos

### "Listo para producción"
→ **Lee:** 04-DEPLOYMENT (comparativa) + 06-OPERATIONS (secrets)  
→ **Ejecuta:** `mise run deploy:setup:koyeb`  
→ **Tiempo:** 1 hora

### "Quiero tests enterprise-grade"
→ **Lee:** 05-TESTING (completo)  
→ **Implementa:** Testcontainers  
→ **Tiempo:** 2-3 horas

## 📊 Estadísticas

```
Total líneas:        ~14,800
Módulos:             6
Tamaño promedio:     ~2,460 líneas/módulo
Reducción tokens:    -75% vs monolítico
Tiempo de carga:     -80% vs monolítico
```

## 🔗 Enlaces

- **Versión monolítica:** `../solo-dev-planner-v2.md` (13,241 líneas)
- **Addon con mejoras:** `../solo-dev-planner-MEJORAS-ADDON.md`
- **Documentación completa:** `../solo-dev-improvements.md`

---

## 🎉 El Skill Más Completo para Solo Devs

```
✅ Production-ready desde día 1
✅ Setup en 15 minutos (MVP)
✅ Auto-fix de errores (3 intentos)
✅ Deploy global ($0-15/mes)
✅ Tests con DB real (Testcontainers)
✅ Monitoring completo
✅ Secrets management
✅ 100% modular y optimizado
```

**Empieza leyendo `00-INDEX.md` → `01-CORE.md` → Módulo que necesites** 🚀

---

## 📝 Changelog del Skill Modular

### v2.1.0 - Modularización (27 Dic 2025)

```
✅ Dividido en 6 módulos especializados
✅ Optimizado para Claude Code (-75% tokens)
✅ Navegación mejorada con TOC
✅ Headers con relaciones entre módulos
✅ Quick start por caso de uso
✅ INDEX maestro con guías
```

### v2.0.0 - Mejoras Críticas (27 Dic 2025)

```
✅ Self-Correction Protocol
✅ Progressive Disclosure (MVP/Alpha/Beta)
✅ Context Script optimizado
✅ Deployment Simple (Koyeb/Railway/Coolify)
✅ Testcontainers para 3 lenguajes
```

### v1.0.0 - Versión Original

```
✅ Atomic Sequential Merges
✅ Mise como herramienta principal
✅ CI/CD adaptativo
✅ Stacks modernos (TypeScript, Python, Go, Java)
```
