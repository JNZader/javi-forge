---
name: ide-plugins-intellij
description: >
  IntelliJ Platform plugin development. Actions, services, PSI, code generation.
  Trigger: apigen-ide-plugins, IntelliJ plugin, PSI, AnAction, @Service
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [ide, intellij, plugin, java]
  scope: ["apigen-ide-plugins/**"]
---

# IntelliJ Plugin Development (apigen-ide-plugins)

## Project Setup

### build.gradle.kts
```kotlin
plugins {
    id("java")
    id("org.jetbrains.intellij.platform") version "2.2.0"
}

intellijPlatform {
    pluginConfiguration {
        name = "APiGen Support"
        version = "1.0.0"
        ideaVersion {
            sinceBuild = "243"
            untilBuild = "243.*"
        }
    }
}

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity("2024.3")
        bundledPlugin("com.intellij.java")
    }
}
```

### plugin.xml
```xml
<idea-plugin>
    <id>com.jnzader.apigen</id>
    <name>APiGen Support</name>
    <vendor>APiGen Team</vendor>

    <depends>com.intellij.modules.platform</depends>
    <depends>com.intellij.modules.java</depends>

    <extensions defaultExtensionNs="com.intellij">
        <!-- File templates -->
        <internalFileTemplate name="APiGen Controller"/>
        <internalFileTemplate name="APiGen Service"/>
        <internalFileTemplate name="APiGen Entity"/>

        <!-- Completion contributor -->
        <completion.contributor
            language="yaml"
            implementationClass="com.jnzader.apigen.ide.completion.YamlCompletionContributor"/>

        <!-- Annotator for validation -->
        <annotator
            language="JAVA"
            implementationClass="com.jnzader.apigen.ide.annotator.ApigenAnnotator"/>

        <!-- Project service -->
        <projectService
            serviceImplementation="com.jnzader.apigen.ide.service.ApigenProjectService"/>

        <!-- Tool window -->
        <toolWindow
            id="APiGen"
            anchor="right"
            factoryClass="com.jnzader.apigen.ide.toolwindow.ApigenToolWindowFactory"/>
    </extensions>

    <actions>
        <group id="APiGen.GenerateGroup" text="APiGen" popup="true">
            <add-to-group group-id="GenerateGroup" anchor="last"/>
            <action id="APiGen.GenerateEntity"
                    class="com.jnzader.apigen.ide.action.GenerateEntityAction"
                    text="Entity from Table"
                    description="Generate entity from database table"/>
            <action id="APiGen.GenerateCrud"
                    class="com.jnzader.apigen.ide.action.GenerateCrudAction"
                    text="CRUD Stack"
                    description="Generate controller, service, repository"/>
        </group>
    </actions>
</idea-plugin>
```

## Actions

```java
public class GenerateEntityAction extends AnAction {

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        if (project == null) return;

        // Show dialog
        GenerateEntityDialog dialog = new GenerateEntityDialog(project);
        if (!dialog.showAndGet()) return;

        // Generate files
        WriteCommandAction.runWriteCommandAction(project, () -> {
            EntityGeneratorService generator =
                project.getService(EntityGeneratorService.class);

            generator.generateEntity(dialog.getTableDefinition(),
                                      dialog.getOptions());
        });
    }

    @Override
    public void update(@NotNull AnActionEvent e) {
        // Only enable in Java project
        Project project = e.getProject();
        boolean enabled = project != null &&
            ProjectRootManager.getInstance(project).getProjectSdk() != null;
        e.getPresentation().setEnabledAndVisible(enabled);
    }

    @Override
    public @NotNull ActionUpdateThread getActionUpdateThread() {
        return ActionUpdateThread.BGT;
    }
}
```

## Services

```java
@Service(Service.Level.PROJECT)
public final class ApigenProjectService {

    private final Project project;
    private final Map<String, ApigenModule> modules = new HashMap<>();

    public ApigenProjectService(Project project) {
        this.project = project;
        loadConfiguration();
    }

    private void loadConfiguration() {
        // Find apigen configuration files
        VirtualFile baseDir = project.getBaseDir();
        VirtualFile configFile = baseDir.findFileByRelativePath(
            "src/main/resources/application.yml");

        if (configFile != null) {
            parseConfiguration(configFile);
        }
    }

    public boolean isApigenProject() {
        // Check for apigen dependencies in build.gradle
        return modules.containsKey("apigen-core");
    }

    public List<String> getConfiguredEntities() {
        return modules.values().stream()
            .flatMap(m -> m.getEntities().stream())
            .map(EntityConfig::getName)
            .toList();
    }
}
```

## Code Completion

```java
public class YamlCompletionContributor extends CompletionContributor {

    public YamlCompletionContributor() {
        // Completion for app.* properties
        extend(CompletionType.BASIC,
            PlatformPatterns.psiElement()
                .inside(YAMLKeyValue.class)
                .withLanguage(YAMLLanguage.INSTANCE),
            new ApigenYamlCompletionProvider());
    }

    private static class ApigenYamlCompletionProvider extends CompletionProvider<CompletionParameters> {

        @Override
        protected void addCompletions(@NotNull CompletionParameters parameters,
                                       @NotNull ProcessingContext context,
                                       @NotNull CompletionResultSet result) {

            PsiElement position = parameters.getPosition();
            String prefix = getPrefix(position);

            if (prefix.startsWith("app.")) {
                // Add apigen-core properties
                addCoreProperties(result);
            } else if (prefix.startsWith("apigen.security.")) {
                // Add security properties
                addSecurityProperties(result);
            }
        }

        private void addCoreProperties(CompletionResultSet result) {
            result.addElement(LookupElementBuilder.create("app.cache.enabled")
                .withTypeText("boolean")
                .withTailText(" = true", true));

            result.addElement(LookupElementBuilder.create("app.pagination.default-size")
                .withTypeText("int")
                .withTailText(" = 20", true));

            result.addElement(LookupElementBuilder.create("app.rate-limit.enabled")
                .withTypeText("boolean")
                .withTailText(" = false", true));
        }
    }
}
```

## PSI Annotator

```java
public class ApigenAnnotator implements Annotator {

    @Override
    public void annotate(@NotNull PsiElement element, @NotNull AnnotationHolder holder) {
        if (!(element instanceof PsiClass psiClass)) return;

        // Check if extends BaseService
        PsiClass superClass = psiClass.getSuperClass();
        if (superClass != null && "BaseService".equals(superClass.getName())) {
            checkServiceImplementation(psiClass, holder);
        }

        // Check Entity annotations
        if (hasAnnotation(psiClass, "jakarta.persistence.Entity")) {
            checkEntityConfiguration(psiClass, holder);
        }
    }

    private void checkServiceImplementation(PsiClass psiClass, AnnotationHolder holder) {
        // Check for required methods
        if (findMethod(psiClass, "getRepository") == null) {
            holder.newAnnotation(HighlightSeverity.WARNING,
                "BaseService subclass should implement getRepository()")
                .range(psiClass.getNameIdentifier())
                .withFix(new ImplementGetRepositoryFix(psiClass))
                .create();
        }
    }

    private void checkEntityConfiguration(PsiClass psiClass, AnnotationHolder holder) {
        // Check for ID field
        boolean hasId = Arrays.stream(psiClass.getFields())
            .anyMatch(f -> hasAnnotation(f, "jakarta.persistence.Id"));

        if (!hasId) {
            holder.newAnnotation(HighlightSeverity.ERROR,
                "Entity must have an @Id field")
                .range(psiClass.getNameIdentifier())
                .create();
        }
    }
}
```

## Quick Fixes

```java
public class ImplementGetRepositoryFix implements LocalQuickFix {

    private final PsiClass psiClass;

    @Override
    public @NotNull String getFamilyName() {
        return "Implement getRepository() method";
    }

    @Override
    public void applyFix(@NotNull Project project, @NotNull ProblemDescriptor descriptor) {
        WriteCommandAction.runWriteCommandAction(project, () -> {
            PsiElementFactory factory = JavaPsiFacade.getElementFactory(project);

            // Find entity type from generic parameter
            String entityType = extractEntityType(psiClass);

            String methodText = String.format("""
                @Override
                protected JpaRepository<%s, UUID> getRepository() {
                    return repository;
                }
                """, entityType);

            PsiMethod method = factory.createMethodFromText(methodText, psiClass);
            psiClass.add(method);

            // Format and optimize imports
            CodeStyleManager.getInstance(project).reformat(method);
            JavaCodeStyleManager.getInstance(project).optimizeImports(psiClass.getContainingFile());
        });
    }
}
```

## Tool Window

```java
public class ApigenToolWindowFactory implements ToolWindowFactory {

    @Override
    public void createToolWindowContent(@NotNull Project project, @NotNull ToolWindow toolWindow) {
        ApigenToolWindowPanel panel = new ApigenToolWindowPanel(project);
        ContentFactory contentFactory = ContentFactory.getInstance();
        Content content = contentFactory.createContent(panel, "Entities", false);
        toolWindow.getContentManager().addContent(content);
    }
}

public class ApigenToolWindowPanel extends SimpleToolWindowPanel {

    private final Tree entityTree;

    public ApigenToolWindowPanel(Project project) {
        super(true, true);

        ApigenProjectService service = project.getService(ApigenProjectService.class);

        // Build tree model
        DefaultMutableTreeNode root = new DefaultMutableTreeNode("Entities");
        for (String entity : service.getConfiguredEntities()) {
            root.add(new DefaultMutableTreeNode(entity));
        }

        entityTree = new Tree(new DefaultTreeModel(root));
        setContent(ScrollPaneFactory.createScrollPane(entityTree));

        // Add toolbar
        ActionToolbar toolbar = ActionManager.getInstance()
            .createActionToolbar("ApigenToolbar", createActionGroup(), true);
        toolbar.setTargetComponent(this);
        setToolbar(toolbar.getComponent());
    }

    private ActionGroup createActionGroup() {
        DefaultActionGroup group = new DefaultActionGroup();
        group.add(new RefreshAction());
        group.add(new GenerateAction());
        return group;
    }
}
```

## File Templates

```java
// fileTemplates/internal/APiGen Controller.java.ft
#if (${PACKAGE_NAME} && ${PACKAGE_NAME} != "")package ${PACKAGE_NAME};#end

import com.jnzader.apigen.core.web.BaseController;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/${ENTITY_PATH}")
public class ${NAME} extends BaseController<${ENTITY}, ${DTO}, ${ID_TYPE}> {

    private final ${SERVICE} service;

    public ${NAME}(${SERVICE} service) {
        this.service = service;
    }

    @Override
    protected BaseService<${ENTITY}, ${DTO}, ${ID_TYPE}> getService() {
        return service;
    }
}
```

## Testing

```java
public class ApigenAnnotatorTest extends LightJavaCodeInsightFixtureTestCase {
```
