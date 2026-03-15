---
name: mlflow
description: >
  ML experiment tracking, model registry, and deployment with MLflow.
  Trigger: mlflow, experiment tracking, model registry, mlops, model versioning
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [mlflow, mlops, experiment-tracking, model-registry]
  updated: "2026-02"
---

# MLflow Skill

ML experiment tracking, model registry, and deployment.

## Stack

```yaml
mlflow: 2.10+
mlflow-skinny: 2.10+  # client only
boto3: 1.34+  # S3 artifacts
psycopg2: 2.9+  # PostgreSQL backend
```

## Docker Setup

```yaml
# docker-compose.mlflow.yml
services:
  mlflow:
    image: ghcr.io/mlflow/mlflow:v2.10.0
    ports:
      - "5000:5000"
    environment:
      - MLFLOW_BACKEND_STORE_URI=postgresql://mlflow:mlflow@postgres:5432/mlflow
      - MLFLOW_DEFAULT_ARTIFACT_ROOT=s3://mlflow-artifacts
    command: >
      mlflow server
      --backend-store-uri postgresql://mlflow:mlflow@postgres:5432/mlflow
      --default-artifact-root s3://mlflow-artifacts
      --host 0.0.0.0 --port 5000
    depends_on:
      - postgres

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: mlflow
      POSTGRES_PASSWORD: mlflow
      POSTGRES_DB: mlflow
    volumes:
      - mlflow_db:/var/lib/postgresql/data

volumes:
  mlflow_db:
```

## Client Configuration

```python
import os
import mlflow

def setup_mlflow():
    mlflow.set_tracking_uri(os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000"))
    mlflow.set_experiment("my-project")
    mlflow.sklearn.autolog()  # Enable autologging
    mlflow.pytorch.autolog()
```

## Experiment Tracking

```python
import mlflow
from mlflow.models import infer_signature
from datetime import datetime

def train_with_tracking(model, X_train, y_train, X_test, y_test, model_name: str, tags: dict = None):
    with mlflow.start_run(run_name=f"{model_name}_{datetime.now().strftime('%Y%m%d_%H%M')}"):
        # Tags
        mlflow.set_tags({
            "model_type": model_name,
            "environment": os.getenv("ENVIRONMENT", "dev"),
            **(tags or {})
        })

        # Parameters
        if hasattr(model, 'get_params'):
            mlflow.log_params(model.get_params())

        # Train
        model.fit(X_train, y_train)
        y_pred = model.predict(X_test)

        # Metrics
        from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score
        mlflow.log_metrics({
            "accuracy": accuracy_score(y_test, y_pred),
            "f1_score": f1_score(y_test, y_pred, average='weighted'),
            "precision": precision_score(y_test, y_pred, average='weighted'),
            "recall": recall_score(y_test, y_pred, average='weighted'),
        })

        # Log model with signature
        signature = infer_signature(X_train, y_pred)
        mlflow.sklearn.log_model(model, "model", signature=signature, registered_model_name=model_name)

        # Log confusion matrix
        log_confusion_matrix(y_test, y_pred)

        return mlflow.active_run().info.run_id

def log_confusion_matrix(y_true, y_pred):
    import matplotlib.pyplot as plt
    import seaborn as sns
    from sklearn.metrics import confusion_matrix

    cm = confusion_matrix(y_true, y_pred)
    fig, ax = plt.subplots(figsize=(8, 6))
    sns.heatmap(cm, annot=True, fmt='d', ax=ax)
    ax.set_xlabel('Predicted')
    ax.set_ylabel('Actual')
    plt.savefig('/tmp/confusion_matrix.png')
    mlflow.log_artifact('/tmp/confusion_matrix.png')
    plt.close()
```

## PyTorch Lightning Integration

```python
import lightning as L
from lightning.pytorch.loggers import MLFlowLogger
from lightning.pytorch.callbacks import ModelCheckpoint, EarlyStopping

def train_with_lightning(model: L.LightningModule, datamodule: L.LightningDataModule, experiment_name: str):
    mlflow_logger = MLFlowLogger(
        experiment_name=experiment_name,
        tracking_uri=os.getenv("MLFLOW_TRACKING_URI"),
        log_model=True
    )

    trainer = L.Trainer(
        max_epochs=100,
        accelerator="auto",
        logger=mlflow_logger,
        callbacks=[
            ModelCheckpoint(monitor="val_loss", mode="min", save_top_k=3),
            EarlyStopping(monitor="val_loss", patience=10)
        ]
    )

    mlflow_logger.log_hyperparams(model.hparams)
    trainer.fit(model, datamodule)
    trainer.test(model, datamodule)
    return mlflow_logger.run_id
```

## Model Registry

```python
from mlflow.tracking import MlflowClient

def register_model(run_id: str, model_name: str, description: str = None, tags: dict = None):
    client = MlflowClient()
    model_uri = f"runs:/{run_id}/model"
    result = mlflow.register_model(model_uri, model_name)

    if description:
        client.update_registered_model(name=model_name, description=description)

    if tags:
        for key, value in tags.items():
            client.set_model_version_tag(name=model_name, version=result.version, key=key, value=value)

    print(f"Registered {model_name} v{result.version}")
    return result.version

def promote_model(model_name: str, version: int, stage: str):  # "Staging", "Production", "Archived"
    client = MlflowClient()
    client.transition_model_version_stage(
        name=model_name,
        version=version,
        stage=stage,
        archive_existing_versions=(stage == "Production")
    )

def get_production_model(model_name: str):
    client = MlflowClient()
    versions = client.get_latest_versions(model_name, stages=["Production"])
    if not versions:
        raise ValueError(f"No production version for {model_name}")
    return versions[0]
```

## Model Loading

```python
def load_model(model_name: str, stage: str = "Production"):
    return mlflow.sklearn.load_model(f"models:/{model_name}/{stage}")

def load_model_version(model_name: str, version: int):
    return mlflow.sklearn.load_model(f"models:/{model_name}/{version}")

class CachedModelLoader:
    def __init__(self):
        self._cache = {}
        self._client = MlflowClient()

    def get_model(self, model_name: str, stage: str = "Production"):
        cache_key = f"{model_name}:{stage}"
        versions = self._client.get_latest_versions(model_name, stages=[stage])
        if not versions:
            raise ValueError(f"No {stage} version for {model_name}")

        current_version = versions[0].version
        if cache_key in self._cache:
            cached_version, model = self._cache[cache_key]
            if cached_version == current_version:
                return model

        model = load_model(model_name, stage)
        self._cache[cache_key] = (current_version, model)
        return model
```

## Model Comparison

```python
import pandas as pd

def compare_runs(experiment_name: str, metric: str = "f1_score", top_n: int = 10) -> pd.DataFrame:
    client = MlflowClient()
    experiment = client.get_experiment_by_name(experiment_name)

    runs = client.search_runs(
        experiment_ids=[experiment.experiment_id],
        order_by=[f"metrics.{metric} DESC"],
        max_results=top_n
    )

    data = []
    for run in runs:
        row = {
            "run_id": run.info.run_id,
            "run_name": run.info.run_name,
            "duration_min": (run.info.end_time - run.info.start_time) / 60000 if run.info.end_time else None,
        }
        row.update(run.data.params)
        row.update(run.data.metrics)
        data.append(row)

    return pd.DataFrame(data)

def get_best_run(experiment_name: str, metric: str = "f1_score", mode: str = "max") -> str:
    client = MlflowClient()
    experiment = client.get_experiment_by_name(experiment_name)
    order = "DESC" if mode == "max" else "ASC"

    runs = client.search_runs(
        experiment_ids=[experiment.experiment_id],
        order_by=[f"metrics.{metric} {order}"],
        max_results=1
    )
    return runs[0].info.run_id if runs else None
```

## Serving

```bash
# REST API serving
mlflow models serve -m "models:/anomaly_detector/Production" -p 5001

# Docker deployment
mlflow models build-docker -m "models:/anomaly_detector/Production" -n ml-model
docker run -p 5001:8080 ml-model

# Request prediction
curl -X POST http://localhost:5001/invocations \
  -H "Content-Type: application/json" \
  -d '{"inputs": [[1.0, 2.0, 3.0, 4.0, 5.0]]}'
```

## Best Practices

1. **Always use experiments** - `mlflow.set_experiment("project-name")`
2. **Log everything** - params, metrics, artifacts, model signature
3. **Use signatures** - `infer_signature(X_train, y_pred)` for input validation
4. **Tag runs** - model_type, dataset_version, author for filtering
5. **Version artifacts** - `mlflow.log_artifact("config.yaml", artifact_path="config")`

## Related Skills

- `pytorch`: Deep learning experiments
- `scikit-learn`: Classical ML experiments
- `kubernetes`: Model deployment at scale
- `docker-containers`: Containerized tracking
