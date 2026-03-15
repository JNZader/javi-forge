---
name: scikit-learn
description: >
  Classical ML with scikit-learn for anomaly detection, classification, and clustering.
  Trigger: sklearn, scikit-learn, classical ml, anomaly detection, classification, clustering
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [sklearn, ml, classification, anomaly-detection, clustering]
  updated: "2026-02"
---

# Scikit-learn Skill

Classical ML for anomaly detection, classification, regression, and clustering.

## Stack

```yaml
scikit-learn: 1.4+
pandas: 2.2+
numpy: 1.26+
joblib: 1.3+
imbalanced-learn: 0.12+
```

## Anomaly Detection

### Isolation Forest

```python
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
import numpy as np
import joblib

class AnomalyDetector:
    def __init__(self, contamination: float = 0.05, n_estimators: int = 100):
        self.pipeline = Pipeline([
            ('scaler', StandardScaler()),
            ('detector', IsolationForest(
                n_estimators=n_estimators,
                contamination=contamination,
                random_state=42,
                n_jobs=-1
            ))
        ])

    def fit(self, X: np.ndarray):
        self.pipeline.fit(X)
        return self

    def predict(self, X: np.ndarray):
        labels = self.pipeline.predict(X)  # -1 anomaly, 1 normal
        scores = self.pipeline.decision_function(X)
        return labels, scores

    def predict_proba(self, X: np.ndarray):
        scores = self.pipeline.decision_function(X)
        return 1 / (1 + np.exp(scores))  # Convert to probability

    def save(self, path: str):
        joblib.dump(self.pipeline, path)

    @classmethod
    def load(cls, path: str):
        detector = cls()
        detector.pipeline = joblib.load(path)
        return detector
```

### One-Class SVM & LOF

```python
from sklearn.svm import OneClassSVM
from sklearn.neighbors import LocalOutlierFactor
from sklearn.preprocessing import RobustScaler

# One-Class SVM (robust to outliers)
class RobustDetector:
    def __init__(self, nu: float = 0.05):
        self.pipeline = Pipeline([
            ('scaler', RobustScaler()),
            ('svm', OneClassSVM(nu=nu, kernel='rbf', gamma='scale'))
        ])

    def fit(self, X):
        self.pipeline.fit(X)
        return self

    def predict(self, X):
        return self.pipeline.predict(X)

# Local Outlier Factor (streaming)
class StreamingLOF:
    def __init__(self, n_neighbors: int = 20, contamination: float = 0.05):
        self.lof = LocalOutlierFactor(
            n_neighbors=n_neighbors,
            contamination=contamination,
            novelty=True  # Enable predict on new data
        )

    def fit(self, X):
        self.lof.fit(X)
        return self

    def predict(self, X):
        return self.lof.predict(X)
```

## Classification

```python
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.pipeline import Pipeline
from sklearn.metrics import classification_report
import pandas as pd

class EquipmentClassifier:
    STATES = ['normal', 'degraded', 'maintenance_required', 'critical']

    def __init__(self, model_type: str = 'random_forest'):
        self.label_encoder = LabelEncoder()
        self.label_encoder.fit(self.STATES)

        classifier = RandomForestClassifier(
            n_estimators=200, max_depth=10, min_samples_split=5,
            class_weight='balanced', n_jobs=-1, random_state=42
        ) if model_type == 'random_forest' else GradientBoostingClassifier(
            n_estimators=200, max_depth=5, learning_rate=0.1, random_state=42
        )

        self.pipeline = Pipeline([
            ('scaler', StandardScaler()),
            ('classifier', classifier)
        ])

    def fit(self, X: np.ndarray, y: np.ndarray):
        if isinstance(y[0], str):
            y = self.label_encoder.transform(y)
        self.pipeline.fit(X, y)
        return self

    def predict(self, X: np.ndarray):
        y_pred = self.pipeline.predict(X)
        return self.label_encoder.inverse_transform(y_pred)

    def predict_proba(self, X: np.ndarray) -> pd.DataFrame:
        proba = self.pipeline.predict_proba(X)
        return pd.DataFrame(proba, columns=self.STATES)

    def feature_importance(self, feature_names: list) -> pd.DataFrame:
        importances = self.pipeline.named_steps['classifier'].feature_importances_
        return pd.DataFrame({'feature': feature_names, 'importance': importances}).sort_values('importance', ascending=False)
```

## Feature Engineering

```python
def extract_features(df: pd.DataFrame, window_size: int = 60) -> pd.DataFrame:
    features = pd.DataFrame()

    for col in ['temperature', 'pressure', 'vibration', 'flow_rate']:
        features[f'{col}_mean'] = df[col].rolling(window_size).mean()
        features[f'{col}_std'] = df[col].rolling(window_size).std()
        features[f'{col}_min'] = df[col].rolling(window_size).min()
        features[f'{col}_max'] = df[col].rolling(window_size).max()
        features[f'{col}_range'] = features[f'{col}_max'] - features[f'{col}_min']
        features[f'{col}_diff'] = df[col].diff()
        features[f'{col}_diff_mean'] = features[f'{col}_diff'].rolling(window_size).mean()

    return features.dropna()
```

## Forecasting (Multi-step)

```python
from sklearn.multioutput import MultiOutputRegressor
from sklearn.ensemble import GradientBoostingRegressor

class Forecaster:
    def __init__(self, horizon: int = 12, lookback: int = 24):
        self.horizon = horizon
        self.lookback = lookback
        self.pipeline = Pipeline([
            ('scaler', StandardScaler()),
            ('regressor', MultiOutputRegressor(
                GradientBoostingRegressor(n_estimators=100, max_depth=5, random_state=42),
                n_jobs=-1
            ))
        ])

    def create_sequences(self, data: np.ndarray):
        X, y = [], []
        for i in range(len(data) - self.lookback - self.horizon + 1):
            X.append(data[i:i + self.lookback].flatten())
            y.append(data[i + self.lookback:i + self.lookback + self.horizon].flatten())
        return np.array(X), np.array(y)

    def fit(self, data: np.ndarray):
        X, y = self.create_sequences(data)
        self.pipeline.fit(X, y)
        return self

    def predict(self, recent_data: np.ndarray) -> np.ndarray:
        X = recent_data.flatten().reshape(1, -1)
        y_pred = self.pipeline.predict(X)
        return y_pred.reshape(self.horizon, recent_data.shape[1])
```

## Clustering

```python
from sklearn.cluster import KMeans, DBSCAN
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score

class ModeDetector:
    def __init__(self, n_modes: int = None, method: str = 'kmeans'):
        self.n_modes = n_modes
        self.scaler = StandardScaler()
        self.pca = PCA(n_components=0.95)
        self.clusterer = None

    def fit(self, X: np.ndarray):
        X_scaled = self.scaler.fit_transform(X)
        X_pca = self.pca.fit_transform(X_scaled)

        if self.n_modes is None:
            self.n_modes = self._find_optimal_k(X_pca)

        self.clusterer = KMeans(n_clusters=self.n_modes, n_init=10, random_state=42)
        self.clusterer.fit(X_pca)
        return self

    def predict(self, X: np.ndarray):
        X_pca = self.pca.transform(self.scaler.transform(X))
        return self.clusterer.predict(X_pca)

    def _find_optimal_k(self, X: np.ndarray, max_k: int = 10) -> int:
        scores = [silhouette_score(X, KMeans(n_clusters=k, n_init=10).fit_predict(X))
                  for k in range(2, max_k + 1)]
        return np.argmax(scores) + 2
```

## Hyperparameter Tuning

```python
from sklearn.model_selection import RandomizedSearchCV, TimeSeriesSplit

def tune_classifier(X: np.ndarray, y: np.ndarray):
    tscv = TimeSeriesSplit(n_splits=5)

    param_grid = {
        'n_estimators': [100, 200, 300],
        'max_depth': [5, 10, 15, None],
        'min_samples_split': [2, 5, 10],
        'min_samples_leaf': [1, 2, 4],
    }

    search = RandomizedSearchCV(
        RandomForestClassifier(random_state=42, n_jobs=-1),
        param_grid,
        n_iter=50,
        cv=tscv,
        scoring='f1_weighted',
        n_jobs=-1
    )
    search.fit(X, y)
    return search.best_estimator_, search.best_params_
```

## Model Persistence

```python
import json
from pathlib import Path
from datetime import datetime

def save_model(model, path: str, metadata: dict = None, feature_names: list = None):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, path)

    meta = {
        'saved_at': datetime.utcnow().isoformat(),
        'sklearn_version': __import__('sklearn').__version__,
        'feature_names': feature_names,
        **(metadata or {})
    }
    path.with_suffix('.json').write_text(json.dumps(meta, indent=2))

def load_model(path: str):
    path = Path(path)
    model = joblib.load(path)
    meta_path = path.with_suffix('.json')
    metadata = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    return model, metadata
```

## Best Practices

1. **Use pipelines** - Combine preprocessing and model for reproducibility
2. **Handle imbalance** - SMOTE or `class_weight='balanced'`
3. **Time series CV** - Use `TimeSeriesSplit` instead of random splits
4. **Feature importance** - Analyze with `.feature_importances_`
5. **Version models** - Save with metadata (version, features, metrics)

## Related Skills

- `mlflow`: Experiment tracking
- `pytorch`: Deep learning alternative
- `duckdb-analytics`: Data preprocessing
- `onnx-inference`: Model deployment
