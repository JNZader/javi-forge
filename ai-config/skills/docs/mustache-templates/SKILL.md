---
name: mustache-templates
description: >
  Desarrollo de templates Mustache para generación de código. Sintaxis, contextos, partials.
  Trigger: template mustache, .mustache, generación código, template context
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
metadata:
  author: apigen-team
  version: "1.0"
  tags: [mustache, templates, codegen]
  scope: ["**/templates/**/*.mustache"]
---

# Mustache Templates

## Ubicación

```
apigen-codegen/src/main/resources/templates/
├── java/
├── kotlin/
├── csharp/
├── go-chi/
├── go-gin/
├── python-fastapi/
├── typescript-nestjs/
├── php-laravel/
└── rust-axum/
```

## Sintaxis Quick Reference

```mustache
{{! Comentario }}
{{variable}}              {{! Variable }}
{{{rawHtml}}}             {{! Sin escape }}
{{#section}}...{{/section}}  {{! Si truthy }}
{{^section}}...{{/section}}  {{! Si falsy }}
{{#list}}{{.}}{{/list}}      {{! Iterar }}
{{> partial}}             {{! Incluir }}
{{#-first}}...{{/-first}}    {{! Primer item }}
{{#-last}}...{{/-last}}      {{! Último item }}
```

## Patrones Comunes

### Imports Condicionales

```mustache
{{#hasValidation}}
import jakarta.validation.constraints.*;
{{/hasValidation}}
{{#hasJpa}}
import jakarta.persistence.*;
{{/hasJpa}}
```

### Lista con Separadores

```mustache
{{#columns}}
    {{propertyName}}{{^-last}},{{/-last}}
{{/columns}}
```

### If-Else

```mustache
{{#nullable}}
Optional<{{type}}>
{{/nullable}}
{{^nullable}}
{{type}}
{{/nullable}}
```

### Default Value

```mustache
{{propertyName}}{{^propertyName}}defaultValue{{/propertyName}}
```

## Context Objects (Java)

```java
public class EntityTemplateContext {
    String packageName;
    String className;
    String tableName;
    List<ColumnContext> columns;
    boolean hasAuditing;
    boolean hasSoftDelete;
}

public class ColumnContext {
    String columnName;
    String propertyName;
    String javaType;
    boolean required;
    boolean isId;
    boolean isRelationship;
    String relatedClassName;
}
```

## Template Ejemplo Completo

```mustache
package {{packageName}}.entity;

import jakarta.persistence.*;
{{#hasLombok}}
import lombok.*;
{{/hasLombok}}
{{#hasValidation}}
import jakarta.validation.constraints.*;
{{/hasValidation}}
{{#hasAuditing}}
import org.springframework.data.annotation.*;
{{/hasAuditing}}

@Entity
@Table(name = "{{tableName}}")
{{#hasLombok}}
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
{{/hasLombok}}
public class {{className}} {

    @Id
    @GeneratedValue(strategy = GenerationType.{{idStrategy}})
    private {{idType}} id;

{{#columns}}
{{^isId}}
{{#isRelationship}}
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "{{columnName}}")
    private {{relatedClassName}} {{propertyName}};
{{/isRelationship}}
{{^isRelationship}}
    @Column(name = "{{columnName}}"{{#required}}, nullable = false{{/required}})
    private {{javaType}} {{propertyName}};
{{/isRelationship}}

{{/isId}}
{{/columns}}
{{#hasAuditing}}
    @CreatedDate
    private Instant createdAt;

    @LastModifiedDate
    private Instant updatedAt;
{{/hasAuditing}}
}
```

## Testing Templates

```java
@Test
void shouldRenderEntity() {
    var context = new EntityTemplateContext();
    context.setClassName("User");
    context.setTableName("users");
    context.setColumns(List.of(
        column("name", "String", false)
    ));

    String result = engine.render("java/entity.mustache", context);

    assertThat(result)
        .contains("public class User")
        .contains("@Table(name = \"users\")")
        .contains("private String name");
}
```

## Related Skills

- `codegen-patterns`: Patrones de generación
- `apigen-codegen-dev`: Desarrollo del módulo

