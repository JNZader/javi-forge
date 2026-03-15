---
name: gradle-multimodule
description: >
  Gradle 9.x multi-module configuration for APiGen. Build, dependencies, publishing.
  Trigger: gradle, build.gradle, multi-module, dependencies, publishing
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [gradle, build, multimodule]
  scope: ["*.gradle", "*.gradle.kts", "settings.gradle"]
---

# Gradle Multi-Module (APiGen)

## Estructura

```
apigen/
├── build.gradle              # Root: plugins, common config
├── settings.gradle           # Module includes
├── gradle.properties         # Versions, properties
├── apigen-bom/build.gradle   # BOM module
├── apigen-core/build.gradle  # Library module
├── apigen-security/          # Library module
├── apigen-codegen/           # Utility module
├── apigen-server/            # Application module
└── ...
```

## Root build.gradle

```groovy
plugins {
    id 'java'
    id 'com.diffplug.spotless' version '7.1.0'
    id 'org.sonarqube' version '6.1.0.5360'
    id 'io.spring.dependency-management' version '1.1.7' apply false
    id 'org.springframework.boot' version '4.0.0' apply false
}

// Common config for all subprojects
subprojects {
    if (name != 'apigen-bom') {
        apply plugin: 'java'
        apply plugin: 'io.spring.dependency-management'

        java {
            toolchain {
                languageVersion = JavaLanguageVersion.of(25)
            }
        }

        repositories {
            mavenCentral()
        }

        dependencyManagement {
            imports {
                mavenBom "org.springframework.boot:spring-boot-dependencies:4.0.0"
            }
        }

        // Spotless
        spotless {
            java {
                target 'src/**/*.java'
                googleJavaFormat('1.33.0').aosp().reflowLongStrings()
            }
        }
    }
}
```

## Module: apigen-bom

```groovy
plugins {
    id 'java-platform'
    id 'maven-publish'
}

javaPlatform {
    allowDependencies()
}

dependencies {
    api platform("org.springframework.boot:spring-boot-dependencies:4.0.0")

    constraints {
        api "com.jnzader:apigen-core:${version}"
        api "com.jnzader:apigen-security:${version}"
        api "com.jnzader:apigen-graphql:${version}"
        api "com.jnzader:apigen-grpc:${version}"
        api "com.jnzader:apigen-gateway:${version}"

        // Third-party
        api "io.jsonwebtoken:jjwt-api:0.13.0"
        api "com.bucket4j:bucket4j-core:8.16.0"
    }
}
```

## Module: Library (apigen-core)

```groovy
plugins {
    id 'java-library'
    id 'maven-publish'
}

dependencies {
    // API dependencies (transitivas)
    api 'org.springframework.boot:spring-boot-starter-data-jpa'
    api 'org.springframework.boot:spring-boot-starter-validation'
    api 'org.springframework.boot:spring-boot-starter-hateoas'

    // Implementation (no transitivas)
    implementation 'com.github.ben-manes.caffeine:caffeine'
    implementation 'org.mapstruct:mapstruct:1.6.3'

    // Annotation processors
    annotationProcessor 'org.mapstruct:mapstruct-processor:1.6.3'
    annotationProcessor 'org.projectlombok:lombok'

    // Test
    testImplementation 'org.springframework.boot:spring-boot-starter-test'
    testImplementation 'org.testcontainers:postgresql'
}
```

## Module: Application (apigen-server)

```groovy
plugins {
    id 'org.springframework.boot'
}

dependencies {
    implementation project(':apigen-core')
    implementation project(':apigen-security')
    implementation project(':apigen-codegen')

    implementation 'org.springframework.boot:spring-boot-starter-web'

    // Runtime only
    runtimeOnly 'org.postgresql:postgresql'

    // Test
    testImplementation 'org.springframework.boot:spring-boot-starter-test'
}

bootJar {
    archiveFileName = "apigen-server.jar"
}
```

## Comandos Comunes

```bash
# Formatear código
./gradlew spotlessApply

# Build específico
./gradlew :apigen-core:build

# Test específico
./gradlew :apigen-core:test

# Build todo
./gradlew buildAll

# Test todo
./gradlew testAll

# Publish local
./gradlew publishToMavenLocal

# Dependencias de un módulo
./gradlew :apigen-core:dependencies

# Ejecutar servidor
./gradlew :apigen-server:bootRun
```

## Custom Tasks (root build.gradle)

```groovy
tasks.register('buildAll') {
    group = 'build'
    description = 'Build all modules'
    dependsOn subprojects.collect { "${it.path}:build" }
}

tasks.register('testAll') {
    group = 'verification'
    description = 'Test all modules'
    dependsOn subprojects.collect { "${it.path}:test" }
}

tasks.register('publishAll') {
    group = 'publishing'
    description = 'Publish all modules to Maven Local'
    dependsOn subprojects.findAll { it.plugins.hasPlugin('maven-publish') }
        .collect { "${it.path}:publishToMavenLocal" }
}
```

## Testing Configuration

```groovy
// En root o cada módulo
test {
    useJUnitPlatform()

    testLogging {
        events "passed", "skipped", "failed"
    }

    // Paralelismo
    maxParallelForks = Runtime.runtime.availableProcessors().intdiv(2) ?: 1
}

// Separar IT tests
tasks.register('integrationTest', Test) {
    description = 'Run integration tests'
    group = 'verification'

    testClassesDirs = sourceSets.test.output.classesDirs
    classpath = sourceSets.test.runtimeClasspath

    useJUnitPlatform {
        includeTags 'integration'
    }
}
```

## JaCoCo Coverage

```groovy
plugins {
    id 'jacoco'
}

jacoco {
    toolVersion = "0.8.12"
}

jacocoTestReport {
    reports {
        xml.required = true
        html.required = true
    }
}

jacocoTestCoverageVerification {
    violationRules {
        rule {
            limit {
                minimum = 0.70
            }
        }
    }
}
```

## Related Skills

- `spring-boot-4`: Dependencias Spring
