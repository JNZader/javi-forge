---
name: solo-dev-planner-progressive-setup
description: "Módulo 3: Setup en 3 fases (MVP, Alpha, Beta)"
---

# 🎯 Solo Dev Planner - Progressive Disclosure Setup

> Módulo 3 de 6: Setup en 3 fases (MVP → Alpha → Beta)

## 📚 Relacionado con:
- 01-CORE.md (Filosofía base)
- 02-SELF-CORRECTION.md (Auto-fix usado en setup)
- 04-DEPLOYMENT.md (Fase Beta usa deployment)
- 06-OPERATIONS.md (Mise, DB, Secrets)

---

        patterns:
          - "*"
  
  # ═══════════════════════════════════════════════════════════
  # Java/Kotlin (Gradle)
  # ═══════════════════════════════════════════════════════════
  - package-ecosystem: "gradle"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    groups:
      spring-dependencies:
        patterns:
          - "org.springframework.boot:*"
          - "org.springframework:*"
      kotlin-dependencies:
        patterns:
          - "org.jetbrains.kotlin:*"
  
  # ═══════════════════════════════════════════════════════════
  # GitHub Actions
  # ═══════════════════════════════════════════════════════════
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    groups:
      actions:
        patterns:
          - "*"
```

### Auto-merge Dependabot PRs (Patches)

```yaml
# .github/workflows/dependabot-auto-merge.yml
name: Dependabot Auto-Merge

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: write
  pull-requests: write

jobs:
  auto-merge:
    runs-on: ubuntu-latest
    if: github.actor == 'dependabot[bot]'
    
    steps:
      - name: Fetch PR Details
        id: pr
        uses: actions/github-script@v7
        with:
          script: |
            const pr = await github.rest.pulls.get({
              owner: context.repo.owner,
              repo: context.repo.repo,
              pull_number: context.issue.number
            });
            
            const title = pr.data.title;
            
            // Detectar si es patch update
            const isPatch = title.includes('patch') || 
                           /bump.*from \d+\.\d+\.\d+ to \d+\.\d+\.\d+$/.test(title);
            
            console.log(`PR title: ${title}`);
            console.log(`Is patch: ${isPatch}`);
            
            return { isPatch };
      
      - name: Enable Auto-merge
        if: fromJSON(steps.pr.outputs.result).isPatch
        run: gh pr merge --auto --squash "${{ github.event.pull_request.number }}"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Approve PR
        if: fromJSON(steps.pr.outputs.result).isPatch
        run: gh pr review --approve "${{ github.event.pull_request.number }}"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### GitHub Code Scanning (CodeQL)

```yaml
# .github/workflows/codeql.yml
name: CodeQL Security Scan

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]
  schedule:
    - cron: '0 6 * * 1'  # Lunes a las 6am

jobs:
  analyze:
    name: Analyze
    runs-on: ubuntu-latest
    
    permissions:
      actions: read
      contents: read
      security-events: write
    
    strategy:
      fail-fast: false
      matrix:
        language: ['javascript', 'python', 'go', 'java']
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      
      - name: Initialize CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: ${{ matrix.language }}
          queries: security-extended,security-and-quality
      
      - name: Autobuild
        uses: github/codeql-action/autobuild@v3
      
      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v3
        with:
          category: "/language:${{ matrix.language }}"
```

### Características
- ✅ Control total del formato del changelog
- ✅ Documentación generada por AI (Gemini)
- ✅ README.md automático
- ✅ Docs API automáticas por lenguaje
- ✅ Deploy a GitHub Pages

### Setup Avanzado

#### 1. Git Cliff para Changelog

**Instalación:**
```bash
# macOS
brew install git-cliff

# Linux
cargo install git-cliff

# O descargar binario
wget https://github.com/orhun/git-cliff/releases/download/v1.4.0/git-cliff-1.4.0-x86_64-unknown-linux-gnu.tar.gz
```

**cliff.toml**
```toml
[changelog]
header = """
# 📋 Changelog

Todos los cambios notables de este proyecto se documentan aquí.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es/1.0.0/),
y este proyecto adhiere a [Semantic Versioning](https://semver.org/lang/es/).

"""

body = """
{% if version %}\
    ## [{{ version | trim_start_matches(pat="v") }}] - {{ timestamp | date(format="%Y-%m-%d") }}
{% else %}\
    ## [Unreleased]
{% endif %}\

{% for group, commits in commits | group_by(attribute="group") %}
    ### {{ group | striptags | trim | upper_first }}
    {% for commit in commits %}
        - {% if commit.scope %}**{{ commit.scope }}:** {% endif %}\
            {% if commit.breaking %}[**breaking**] {% endif %}\
            {{ commit.message | upper_first }} \
            ([{{ commit.id | truncate(length=7, end="") }}]({{ commit.link }}))
    {% endfor %}
{% endfor %}\n
"""

trim = true
footer = """
<!-- generated by git-cliff -->
"""

[git]
conventional_commits = true
filter_unconventional = true
split_commits = false

commit_parsers = [
    { message = "^feat", group = "✨ Features" },
    { message = "^fix", group = "🐛 Bug Fixes" },
    { message = "^doc", group = "📚 Documentation" },
    { message = "^perf", group = "⚡ Performance" },
    { message = "^refactor", group = "♻️ Refactor" },
    { message = "^style", group = "🎨 Styling" },
    { message = "^test", group = "🧪 Testing" },
    { message = "^chore\\(release\\): prepare for", skip = true },
    { message = "^chore\\(deps\\)", skip = true },
    { message = "^chore\\(pr\\)", skip = true },
    { message = "^chore\\(pull\\)", skip = true },
    { message = "^chore|^ci", group = "🔧 Miscellaneous" },
    { body = ".*security", group = "🔒 Security" },
    { message = "^revert", group = "⏪ Revert" },
]

protect_breaking_commits = false
filter_commits = false
tag_pattern = "v[0-9].*"
skip_tags = "v0.1.0-beta.1"
ignore_tags = ""
topo_order = false
sort_commits = "oldest"

[bump]
features_always_bump_minor = true
breaking_always_bump_major = true
```

**GitHub Actions:**
```yaml
# .github/workflows/changelog-advanced.yml
name: Changelog (Advanced)

on:
  push:
    branches:
      - main
    tags:
      - 'v*'

jobs:
  changelog:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Install git-cliff
        run: |
          wget https://github.com/orhun/git-cliff/releases/download/v1.4.0/git-cliff-1.4.0-x86_64-unknown-linux-gnu.tar.gz
          tar -xzf git-cliff-1.4.0-x86_64-unknown-linux-gnu.tar.gz
          chmod +x git-cliff
          sudo mv git-cliff /usr/local/bin/
      
      - name: Generate Changelog
        run: |
          git-cliff -o CHANGELOG.md
      
      - name: Commit Changelog
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add CHANGELOG.md
          git commit -m "docs: update CHANGELOG.md" || echo "No changes"
          git push
```

#### 2. Documentación AI con Gemini (Gratuita)

**scripts/generate-docs.js**
```javascript
import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function analyzeCodebase() {
  // Leer estructura del proyecto
  const structure = getProjectStructure('.');
  
  // Leer archivos principales
  const mainFiles = [
    'package.json',
    'src/index.ts',
    'src/main.py',
    'cmd/api/main.go',
    // ... detectar automáticamente
  ].filter(f => existsSync(f));
  
  const codeContext = mainFiles.map(f => ({
    path: f,
    content: readFileSync(f, 'utf-8')
  }));
  
  return { structure, codeContext };
}

async function generateREADME() {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  
  const { structure, codeContext } = await analyzeCodebase();
  
  const prompt = `
Analiza este proyecto y genera un README.md profesional en markdown.

ESTRUCTURA DEL PROYECTO:
${JSON.stringify(structure, null, 2)}

ARCHIVOS PRINCIPALES:
${codeContext.map(f => `
### ${f.path}
\`\`\`
${f.content}
\`\`\`
`).join('\n')}

GENERA UN README.md QUE INCLUYA:

1. Título y descripción breve del proyecto
2. Características principales
3. Tech stack detectado
4. Requisitos previos
5. Instalación paso a paso
6. Uso con ejemplos
7. Estructura del proyecto
8. Scripts disponibles
9. Testing
10. Contribución (opcional)
11. Licencia

IMPORTANTE:
- Usa emojis apropiados
- Formato markdown limpio
- Ejemplos de código con syntax highlighting
- Badges relevantes (build status, license, etc.)
- TOC si el README es largo

RESPONDE SOLO CON EL CONTENIDO DEL README.MD, SIN EXPLICACIONES ADICIONALES.
`;

  const result = await model.generateContent(prompt);
  const readme = result.response.text();
  
  writeFileSync('README.md', readme);
  console.log('✅ README.md generado automáticamente');
}

function getProjectStructure(dir, depth = 0, maxDepth = 3) {
  if (depth > maxDepth) return null;
  
  const items = readdirSync(dir, { withFileTypes: true });
  const structure = {};
  
  for (const item of items) {
    // Ignorar node_modules, .git, etc.
    if (['node_modules', '.git', 'dist', 'build', '.next'].includes(item.name)) {
      continue;
    }
    
    if (item.isDirectory()) {
      structure[item.name] = getProjectStructure(
        join(dir, item.name),
        depth + 1,
        maxDepth
      );
    } else {
      structure[item.name] = 'file';
    }
  }
  
  return structure;
}

// Ejecutar
generateREADME().catch(console.error);
```

**package.json (para proyectos Node/Bun):**
```json
{
  "scripts": {
    "docs:generate": "bun run scripts/generate-docs.js"
  },
  "devDependencies": {
    "@google/generative-ai": "^0.21.0"
  }
}
```

**GitHub Actions con Gemini:**
```yaml
# .github/workflows/auto-docs.yml
name: Auto Documentation (AI)

on:
  push:
    branches: [main]
    paths:
      - 'src/**'
      - 'cmd/**'
      - 'app/**'
      - '!README.md'

jobs:
  generate-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
      
      - name: Install dependencies
        run: bun install @google/generative-ai
      
      - name: Generate README with Gemini
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
        run: bun run scripts/generate-docs.js
      
      - name: Generate API Docs (language-specific)
        run: |
          if [ -f "package.json" ]; then
            # TypeScript/JavaScript
            npx typedoc --out docs/api src/
          elif [ -f "pyproject.toml" ]; then
            # Python
            pip install pdoc3
            pdoc --html --output-dir docs/api app/
          elif [ -f "go.mod" ]; then
            # Go
            go install golang.org/x/tools/cmd/godoc@latest
            mkdir -p docs/api
            # Generar docs estáticas
          elif [ -f "build.gradle.kts" ]; then
            # Kotlin/Java
            ./gradlew dokkaHtml
            mv build/dokka/html docs/api
          fi
      
      - name: Commit Documentation
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add README.md docs/
          git commit -m "docs: auto-update documentation [skip ci]" || echo "No changes"
          git push
      
      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./docs
```

#### 3. Configurar GitHub Pages

```bash
# En GitHub repo settings:
# Settings > Pages > Source > gh-pages branch
```

---

---

## 📢 Notificaciones (Discord / Slack)

### Discord Webhooks

#### Setup
```bash
# 1. En tu servidor Discord
# Server Settings > Integrations > Webhooks > New Webhook

# 2. Copiar Webhook URL

# 3. GitHub Settings > Secrets
# Name: DISCORD_WEBHOOK
# Value: https://discord.com/api/webhooks/...
```

#### Workflow de Notificaciones

```yaml
# .github/workflows/notifications.yml
name: Notifications

on:
  workflow_run:
    workflows: ["CI/CD Pipeline"]
    types: [completed]
  
  issues:
    types: [opened, labeled]

jobs:
  discord-notify:
    runs-on: ubuntu-latest
    if: vars.DISCORD_ENABLED == 'true'
    
    steps:
      - name: Notify Merge Success
        if: |
          github.event.workflow_run.conclusion == 'success' &&
          github.event.workflow_run.event == 'pull_request'
        run: |
          curl -X POST ${{ secrets.DISCORD_WEBHOOK }} \
            -H "Content-Type: application/json" \
            -d '{
              "embeds": [{
                "title": "✅ PR Auto-Merged",
                "description": "CI passed and PR was automatically merged",
                "color": 3066993,
                "fields": [
                  {
                    "name": "Branch",
                    "value": "'"${{ github.event.workflow_run.head_branch }}"'",
                    "inline": true
                  },
                  {
                    "name": "Author",
                    "value": "'"${{ github.event.workflow_run.actor.login }}"'",
                    "inline": true
                  }
                ],
                "timestamp": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
              }]
            }'
```

### Slack Webhooks (Similar config)

[Documentación similar a Discord pero para Slack]

### Configurar en Variables

```bash
# GitHub repo > Settings > Variables > Actions
# DISCORD_ENABLED = false  (por defecto)
# SLACK_ENABLED = false    (por defecto)
```

---

## ⏱️ Estimación de Tiempo en Planes

[Sección completa con templates y ejemplos de estimación]

---

## 💰 Cloud Cost Estimation (Desactivado por defecto)

[Sección completa con Infracost]

---

## 🎯 Modo Híbrido (Recomendado): Simple + Docs On-Demand

### Filosofía
```
Durante desarrollo:
✅ Release Please (changelog automático)
✅ Commits convencionales
✅ Sin complicaciones

Cuando estés listo (feature completa, v1.0, etc.):
✅ Ejecutar workflow manual de documentación
✅ Generar docs API según tu lenguaje
✅ Deploy automático a GitHub Pages
```

### Ventajas
- ✅ **Lo mejor de ambos mundos**
- ✅ **No genera docs en cada commit** (innecesario)
- ✅ **Control total sobre cuándo documentar**
- ✅ **Bajo overhead durante desarrollo**

---

## 📚 Documentación API On-Demand

### Setup: Workflow Manual con Detección Automática

```yaml
# .github/workflows/docs-api.yml
name: Generate API Documentation

on:
  # Trigger manual desde GitHub UI
  workflow_dispatch:
    inputs:
      deploy_to_pages:
        description: 'Deploy to GitHub Pages?'
        required: true
        default: 'true'
        type: boolean
  
  # O automático en releases
  release:
    types: [published]
  
  # O automático en tags
  push:
    tags:
      - 'v*'

permissions:
  contents: write
  pages: write
  id-token: write

jobs:
  detect-and-generate:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      # ═══════════════════════════════════════════════════════════
      # DETECCIÓN AUTOMÁTICA DE LENGUAJE
      # ═══════════════════════════════════════════════════════════
      - name: Detect Language
        id: detect
        run: |
          if [ -f "package.json" ]; then
            echo "language=typescript" >> $GITHUB_OUTPUT
            echo "📦 TypeScript/JavaScript detectado"
          elif [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then
            echo "language=python" >> $GITHUB_OUTPUT
            echo "🐍 Python detectado"
          elif [ -f "go.mod" ]; then
            echo "language=go" >> $GITHUB_OUTPUT
            echo "🐹 Go detectado"
          elif [ -f "build.gradle.kts" ] || [ -f "build.gradle" ]; then
            echo "language=java" >> $GITHUB_OUTPUT
            echo "☕ Java/Kotlin detectado"
          elif [ -f "Cargo.toml" ]; then
            echo "language=rust" >> $GITHUB_OUTPUT
            echo "🦀 Rust detectado"
          else
            echo "language=unknown" >> $GITHUB_OUTPUT
            echo "❌ Lenguaje no detectado"
            exit 1
          fi
      
      # ═══════════════════════════════════════════════════════════
      # TYPESCRIPT / JAVASCRIPT - TypeDoc
      # ═══════════════════════════════════════════════════════════
      - name: Setup Node
        if: steps.detect.outputs.language == 'typescript'
        uses: actions/setup-node@v4
        with:
          node-version: 20
      
      - name: Generate TypeScript Docs
        if: steps.detect.outputs.language == 'typescript'
        run: |
          # Instalar TypeDoc
          npm install -g typedoc
          
          # Generar docs
          typedoc \
            --out docs/api \
            --entryPointStrategy expand \
            --exclude "**/*.test.ts" \
            --exclude "**/*.spec.ts" \
            --excludePrivate \
            --theme default \
            src/
          
          echo "✅ TypeDoc generado en docs/api"
      
      # ═══════════════════════════════════════════════════════════
      # PYTHON - Sphinx
      # ═══════════════════════════════════════════════════════════
      - name: Setup Python
        if: steps.detect.outputs.language == 'python'
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      
      - name: Generate Python Docs
        if: steps.detect.outputs.language == 'python'
        run: |
          # Instalar Sphinx y tema
          pip install sphinx sphinx-rtd-theme sphinx-autodoc-typehints
          
          # Crear estructura si no existe
          if [ ! -d "docs" ]; then
            sphinx-quickstart docs \
              --project="API Documentation" \
              --author="Auto-generated" \
              --release="1.0" \
              --language="en" \
              --sep \
              --ext-autodoc \
              --ext-viewcode \
              --no-batchfile
          fi
          
          # Generar documentación automática
          sphinx-apidoc -o docs/source app/
          
          # Build HTML
          sphinx-build -b html docs/source docs/api
          
          echo "✅ Sphinx generado en docs/api"
      
      # ═══════════════════════════════════════════════════════════
      # GO - pkgsite (Go's official doc server)
      # ═══════════════════════════════════════════════════════════
      - name: Setup Go
        if: steps.detect.outputs.language == 'go'
        uses: actions/setup-go@v5
        with:
          go-version: '1.25'
      
      - name: Generate Go Docs
        if: steps.detect.outputs.language == 'go'
        run: |
          # Instalar pkgsite
          go install golang.org/x/pkgsite/cmd/pkgsite@latest
          
          # Generar documentación estática
          mkdir -p docs/api
          
          # Extraer docs en formato HTML
          pkgsite -http=:6060 &
          PKGSITE_PID=$!
          sleep 5
          
          # Descargar páginas HTML (ejemplo para módulo principal)
          MODULE_NAME=$(go list -m)
          wget -r -np -nH --cut-dirs=1 -P docs/api http://localhost:6060/$MODULE_NAME
          
          kill $PKGSITE_PID
          
          echo "✅ Go docs generado en docs/api"
      
      # ═══════════════════════════════════════════════════════════
      # JAVA/KOTLIN - Dokka
      # ═══════════════════════════════════════════════════════════
      - name: Setup Java
        if: steps.detect.outputs.language == 'java'
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '25'
      
      - name: Generate Java/Kotlin Docs
        if: steps.detect.outputs.language == 'java'
        run: |
          # Asegurar que Dokka está en build.gradle.kts
          if ! grep -q "dokka" build.gradle.kts; then
            echo "⚠️  Dokka no configurado. Agregando plugin..."
            sed -i '1i id("org.jetbrains.dokka") version "1.9.20"' build.gradle.kts
          fi
          
          # Generar docs
          ./gradlew dokkaHtml
          
          # Mover a docs/api
          mkdir -p docs/api
          cp -r build/dokka/html/* docs/api/
          
          echo "✅ Dokka generado en docs/api"
      
      # ═══════════════════════════════════════════════════════════
      # RUST - rustdoc
      # ═══════════════════════════════════════════════════════════
      - name: Setup Rust
        if: steps.detect.outputs.language == 'rust'
        uses: dtolnay/rust-toolchain@stable
      
      - name: Generate Rust Docs
        if: steps.detect.outputs.language == 'rust'
        run: |
          # Generar docs
          cargo doc --no-deps --document-private-items
          
          # Mover a docs/api
          mkdir -p docs/api
          cp -r target/doc/* docs/api/
          
          echo "✅ Rustdoc generado en docs/api"
      
      # ═══════════════════════════════════════════════════════════
      # CREAR INDEX.HTML PERSONALIZADO
      # ═══════════════════════════════════════════════════════════
      - name: Create Custom Index
        run: |
          cat > docs/index.html << 'EOF'
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>API Documentation</title>
            <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
              }
              .container {
                background: white;
                border-radius: 20px;
                padding: 60px;
                max-width: 600px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                text-align: center;
              }
              h1 {
                font-size: 3em;
                margin-bottom: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
              }
              p {
                color: #666;
                font-size: 1.2em;
                margin-bottom: 40px;
              }
              .btn {
                display: inline-block;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 15px 40px;
                border-radius: 50px;
                text-decoration: none;
                font-weight: 600;
                transition: transform 0.3s, box-shadow 0.3s;
                font-size: 1.1em;
              }
              .btn:hover {
                transform: translateY(-3px);
                box-shadow: 0 10px 30px rgba(102, 126, 234, 0.4);
              }
              .meta {
                margin-top: 40px;
                padding-top: 40px;
                border-top: 1px solid #eee;
                color: #999;
                font-size: 0.9em;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>📚 API Documentation</h1>
              <p>Documentación completa generada automáticamente</p>
              <a href="./api/index.html" class="btn">Ver Documentación →</a>
              <div class="meta">
                <p>Generado el: $(date '+%Y-%m-%d %H:%M:%S')</p>
                <p>Commit: $(git rev-parse --short HEAD)</p>
              </div>
            </div>
          </body>
          </html>
          EOF
          
          echo "✅ Index personalizado creado"
      
      # ═══════════════════════════════════════════════════════════
      # DEPLOY A GITHUB PAGES
      # ═══════════════════════════════════════════════════════════
      - name: Deploy to GitHub Pages
        if: inputs.deploy_to_pages == 'true' || github.event_name == 'release'
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./docs
          cname: docs.tudominio.com  # Opcional: custom domain
      
      # ═══════════════════════════════════════════════════════════
      # COMMIT DOCS AL REPO (OPCIONAL)
      # ═══════════════════════════════════════════════════════════
      - name: Commit Docs to Repo
        if: inputs.deploy_to_pages == 'false'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add docs/
          git commit -m "docs: update API documentation [skip ci]" || echo "No changes"
