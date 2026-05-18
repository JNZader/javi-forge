# CI-Local: Universal CI Simulation

Reproduce tu CI/CD localmente antes de push. Si pasa local → pasa en GitHub Actions/GitLab CI.

## Stack Soportados (auto-detectados)

| Stack | Build Tool | Lint | Test |
|-------|------------|------|------|
| Java | Gradle | spotlessCheck | ./gradlew test |
| Java | Maven | spotless:check | ./mvnw test |
| Node.js | npm/yarn/pnpm | lint | test |
| Python | pip/poetry | ruff/pylint | pytest |
| Go | go | golangci-lint | go test |
| Rust | cargo | clippy | cargo test |

## Instalación (30 segundos)

### Prerequisito obligatorio

Los hooks invocan la CLI `javi-forge`. Instalala global ANTES de correr `install.sh`:

```bash
npm install -g javi-forge
```

Si estás desarrollando javi-forge mismo, usá `pnpm link --global` desde la raíz del workspace.

### Copiar a un proyecto nuevo

```bash
# Copiar CI-Local y su dependencia lib/
cp -r .ci-local /path/to/new-project/
cp -r lib /path/to/new-project/

# En el nuevo proyecto
cd /path/to/new-project
./.ci-local/install.sh      # Linux/Mac/WSL
# o
.\.ci-local\install.ps1     # Windows (PowerShell 7+)
```

> **Importante:** CI-Local depende de `lib/common.sh` (Linux/Mac) y/o `lib/common.psm1` (Windows). Copiá ambos junto con el directorio `ci-local/`.

El installer (ambas variantes) falla con mensaje claro si `javi-forge` no está en el PATH.

### Soporte cross-platform

| Plataforma | Installer | Runner | Hooks | Requisitos |
|---|---|---|---|---|
| Linux | `install.sh` | `ci-local.sh` | bash | bash, perl, docker (opcional) |
| macOS | `install.sh` | `ci-local.sh` | bash | bash, perl, docker (opcional) |
| WSL | `install.sh` | `ci-local.sh` | bash | bash, perl, docker (opcional) |
| Windows nativo | `install.ps1` | `ci-local.ps1` | bash | PowerShell 7+, Git for Windows (MSYS2 bash), docker (opcional) |

Los git hooks (`pre-commit`, `commit-msg`, `pre-push`) son bash en todas las plataformas. En Windows nativo corren via el MSYS2 bash que viene con Git for Windows — no se necesita una versión PowerShell de los hooks.

### Dependencias opcionales

```bash
# Semgrep (análisis de seguridad, muy recomendado)
# Si Semgrep no está instalado localmente, CI-Local hace fallback automático
# a una imagen Docker de Semgrep cuando Docker está disponible.
pip install semgrep

# Docker (requerido para CI simulation y fallback de Semgrep)
# Instalar Docker Desktop
```

## Uso

### Automático (hooks)

```bash
git commit -m "..."   # → pre-commit: AI check + lint + security (~30s)
                      # → commit-msg: valida mensaje sin AI attribution
git push              # → pre-push: CI completo en Docker (~3min)
```

### AI Attribution Blocker (best-effort)

El hook `commit-msg` bloquea atribución accidental a herramientas de IA.
**Es best-effort, no es un control de seguridad adversarial.**

#### Qué bloquea

- `Co-authored-by: Claude`, `Co-authored-by: GPT`, etc.
- `Made/generated/written/built/produced by/with X` (con proveedores conocidos)
- `X-assisted` (anthropic-assisted, openai-assisted, etc.)
- Referencias a `@anthropic.com`, `@openai.com`, etc.
- Nombres de modelos: `claude opus`, `gpt-4`, `chatgpt`, `claude-sonnet`, `Claude3.5`
- AI IDEs: `Cursor`, `Windsurf`, `Codeium`, `Cody`, `Aider`
- Variantes con whitespace doble, markdown (`**Claude**`), puntuación entre tokens,
  emoji separadores, full-width latin (`Ｃｌａｕｄｅ`), combining diacritics (`Ćlaude`),
  y Unicode invisibles (ZWSP/RLM/NBSP).

#### Qué NO bloquea (limitaciones documentadas)

- **Homoglifos cross-script**: `Сlaude` (Cyrillic), `Ϲlaude` (Greek), `Ꮯlaude` (Cherokee).
  Requieren transliteración via módulos perl no-core.
- **Tag characters / variation selectors**: `Made by\u{E0063}laude`. Rangos Unicode
  específicos no estripeados.
- **Bare provider name sin verbo prepositional**: "asked Claude to refactor",
  "I used Claude for this", "claude helped me debug". El riesgo de false positive
  en nombres personales o conversaciones legítimas es alto.

Si tu modelo de amenaza requiere defensa contra adversarios motivados, usá
**signed commits** + revisor humano. Un regex no es cripto.

**Tú sos el único autor de tu código.**

### Manual

```bash
# Windows
.\.ci-local\ci-local.ps1 quick    # Lint + compile
.\.ci-local\ci-local.ps1 full     # CI completo
.\.ci-local\ci-local.ps1 shell    # Shell en entorno CI
.\.ci-local\ci-local.ps1 detect   # Ver stack detectado

# Linux/Mac
./.ci-local/ci-local.sh quick
./.ci-local/ci-local.sh full
./.ci-local/ci-local.sh shell
./.ci-local/ci-local.sh detect
```

### Skipear hooks (emergencia)

```bash
git commit --no-verify
git push --no-verify
```

## Como Funciona

```
Developer workflow:

1. Editar codigo
2. git add .
3. git commit -m "feat: add feature"
     |
     pre-commit hook:
     - [1/3] Verificar atribucion AI (BLOQUEADO si encuentra)
     - [2/3] Scan de seguridad Semgrep (reglas locales)
     - [3/3] Compile check rapido
     |
     commit-msg hook:
     - Validar formato conventional commit
     |
4. git push
     |
     pre-push hook:
     - Detectar stack (Java/Node/Python/Go/Rust)
     - Generar Dockerfile para el stack
     - Construir imagen Docker (con cache de hash)
     - Ejecutar test suite completo en contenedor
     |
5. Push exitoso → CI remoto pasara
```

## Estructura

```
.ci-local/
├── ci-local.ps1      # Script principal (Windows)
├── ci-local.sh       # Script principal (Linux/Mac)
├── install.ps1       # Instalador Windows
├── install.sh        # Instalador Linux/Mac
├── semgrep.yml       # Reglas de seguridad
├── README.md         # Esta guía
├── hooks/
│   ├── pre-commit    # AI check + lint + security
│   ├── commit-msg    # Valida mensaje sin AI attribution
│   └── pre-push      # CI simulation en Docker
└── docker/
    └── *.Dockerfile  # Se generan automáticamente

lib/                  # Dependencia requerida (copiar junto con .ci-local/)
├── common.sh         # Funciones compartidas (Bash)
└── Common.psm1       # Funciones compartidas (PowerShell)
```

## Personalización

### Agregar reglas Semgrep específicas

Editar `.ci-local/semgrep.yml` o crear `.semgrep.yml` en la raíz.

### Cambiar comandos de lint/test

Editar `lib/common.sh` (detección de stack) o `setup_ci_commands()` en `ci-local.sh` (comandos CI).

### Docker image custom

Editar los Dockerfiles en `.ci-local/docker/` después de la primera ejecución.

## FAQ

**¿Por qué falla en CI pero no en ci-local?**
- Verifica que Docker esté corriendo con la misma imagen
- Usa `ci-local.sh shell` para debug interactivo

**¿Cómo acelerar el pre-push?**
- Usa Docker image cache para evitar rebuilds innecesarios
- Usa `--no-verify` si estás seguro (no recomendado)

**¿Funciona sin Docker?**
- Los hooks de pre-commit funcionan sin Docker
- El pre-push requiere Docker para simular CI real

**¿Qué pasa si Semgrep no está instalado?**
- CI-Local detecta si Semgrep está disponible localmente
- Si no está instalado pero Docker está corriendo, usa la imagen `semgrep/semgrep` como fallback automático
- Si ni Semgrep ni Docker están disponibles, el scan de seguridad se omite con advertencia
