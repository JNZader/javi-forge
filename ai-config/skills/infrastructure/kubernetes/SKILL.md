---
name: kubernetes
description: >
  Kubernetes container orchestration patterns, manifests, and deployment strategies.
  Trigger: kubernetes, k8s, kubectl, deployment, pods, kustomize, helm
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [kubernetes, containers, devops, orchestration]
  updated: "2026-02"
---

# Kubernetes Container Orchestration

## Stack Versions

```yaml
Kubernetes: 1.29+
kubectl: 1.29+
Helm: 3.14+
Kustomize: 5.3+
```

## Project Structure

```
k8s/
├── base/
│   ├── namespace.yaml
│   ├── configmap.yaml
│   ├── secrets.yaml
│   └── app/
│       ├── deployment.yaml
│       ├── service.yaml
│       └── hpa.yaml
├── overlays/
│   ├── development/
│   ├── staging/
│   └── production/
│       ├── kustomization.yaml
│       ├── patches/
│       └── ingress.yaml
└── helm/
    └── charts/
```

## Core Manifests

### Namespace

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: myapp
  labels:
    app.kubernetes.io/name: myapp
    environment: production
```

### ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: myapp
data:
  LOG_LEVEL: "info"
  LOG_FORMAT: "json"
  API_PORT: "8080"
  METRICS_PORT: "9090"
```

### Secrets (with External Secrets)

```yaml
# Basic Secret
apiVersion: v1
kind: Secret
metadata:
  name: app-secrets
  namespace: myapp
type: Opaque
stringData:
  DATABASE_URL: "postgres://user:pass@postgres:5432/db"
  JWT_SECRET: "your-jwt-secret"
---
# External Secrets (production)
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: app-secrets
  namespace: myapp
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: app-secrets
  data:
    - secretKey: DATABASE_URL
      remoteRef:
        key: myapp/database-url
```

## Deployment Pattern

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: myapp
  labels:
    app: api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: api
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
    spec:
      serviceAccountName: api
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000

      containers:
        - name: api
          image: ghcr.io/org/api:v1.0.0
          imagePullPolicy: Always
          ports:
            - name: http
              containerPort: 8080
            - name: metrics
              containerPort: 9090
          envFrom:
            - configMapRef:
                name: app-config
            - secretRef:
                name: app-secrets
          env:
            - name: POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name

          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi

          livenessProbe:
            httpGet:
              path: /health/live
              port: http
            initialDelaySeconds: 10
            periodSeconds: 10

          readinessProbe:
            httpGet:
              path: /health/ready
              port: http
            initialDelaySeconds: 5
            periodSeconds: 5

          startupProbe:
            httpGet:
              path: /health/live
              port: http
            failureThreshold: 30
            periodSeconds: 5

          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]

          volumeMounts:
            - name: tmp
              mountPath: /tmp

      volumes:
        - name: tmp
          emptyDir: {}

      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchLabels:
                    app: api
                topologyKey: kubernetes.io/hostname
```

## Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: myapp
spec:
  type: ClusterIP
  ports:
    - name: http
      port: 80
      targetPort: http
    - name: metrics
      port: 9090
      targetPort: metrics
  selector:
    app: api
```

## HorizontalPodAutoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api
  namespace: myapp
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Pods
          value: 2
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Pods
          value: 1
          periodSeconds: 120
```

## Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  namespace: myapp
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/rate-limit-rps: "50"
spec:
  tls:
    - hosts:
        - api.example.com
      secretName: api-tls
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  number: 80
```

## Kustomize

### Base Kustomization

```yaml
# k8s/base/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: myapp
resources:
  - namespace.yaml
  - configmap.yaml
  - secrets.yaml
  - deployment.yaml
  - service.yaml
  - hpa.yaml
commonLabels:
  app.kubernetes.io/part-of: myapp
```

### Production Overlay

```yaml
# k8s/overlays/production/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: myapp-prod
resources:
  - ../../base
  - ingress.yaml
namePrefix: prod-
commonLabels:
  environment: production
images:
  - name: ghcr.io/org/api
    newTag: v1.5.0
patches:
  - path: patches/replicas.yaml
  - path: patches/resources.yaml
configMapGenerator:
  - name: app-config
    behavior: merge
    literals:
      - LOG_LEVEL=warn
```

## Network Policies

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: myapp
spec:
  podSelector: {}
  policyTypes:
    - Ingress
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-api-ingress
  namespace: myapp
spec:
  podSelector:
    matchLabels:
      app: api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
      ports:
        - protocol: TCP
          port: 8080
```

## PodDisruptionBudget

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-pdb
  namespace: myapp
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: api
```

## Commands Reference

```bash
# Apply with kustomize
kubectl apply -k k8s/overlays/production

# Preview changes
kubectl diff -k k8s/overlays/production

# Rollout management
kubectl rollout status deployment/api -n myapp
kubectl rollout undo deployment/api -n myapp
kubectl rollout history deployment/api -n myapp

# Scaling
kubectl scale deployment/api --replicas=5 -n myapp

# Debugging
kubectl logs -f deployment/api -n myapp
kubectl exec -it deployment/api -n myapp -- /bin/sh
kubectl port-forward svc/api 8080:80 -n myapp

# Resource inspection
kubectl get all -n myapp
kubectl get pods -n myapp -o wide
kubectl top pods -n myapp
kubectl describe pod <pod-name> -n myapp
```

## Best Practices

1. **Always set resource limits** - Prevents resource starvation
2. **Use all three probes** - liveness, readiness, startup
3. **Security context** - runAsNonRoot, readOnlyRootFilesystem
4. **Pod anti-affinity** - Spread across nodes/zones
5. **Specific image tags** - Never use :latest in production
6. **Network policies** - Default deny, explicit allow
7. **PodDisruptionBudgets** - Maintain availability during updates

## Related Skills

- `docker-containers`: Container build patterns
- `traefik-proxy`: Ingress and routing
- `devops-infra`: CI/CD pipelines
- `opentelemetry`: Cluster observability
