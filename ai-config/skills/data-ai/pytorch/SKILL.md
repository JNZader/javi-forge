---
name: pytorch
description: >
  Deep learning with PyTorch and Lightning for anomaly detection and time series forecasting.
  Trigger: pytorch, deep learning, neural network, lightning, anomaly detection, forecasting
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [pytorch, deep-learning, lightning, ml, forecasting]
  updated: "2026-02"
---

# PyTorch Skill

Deep learning with PyTorch Lightning for anomaly detection and time series forecasting.

## Stack

```yaml
torch: 2.2+
lightning: 2.2+
torchmetrics: 1.3+
einops: 0.7+
wandb: 0.16+  # logging
```

## Project Structure

```
src/ml/
├── models/
│   ├── autoencoder.py
│   ├── transformer.py
│   └── lstm.py
├── data/
│   ├── dataset.py
│   └── preprocessing.py
├── training/
│   └── trainer.py
└── inference/
    └── predictor.py
```

## Autoencoder for Anomaly Detection

```python
import torch
import torch.nn as nn
import lightning as L
from torchmetrics import F1Score, Precision, Recall

class SensorAutoencoder(nn.Module):
    def __init__(self, input_dim: int = 5, hidden_dims: list = [64, 32, 16], latent_dim: int = 8):
        super().__init__()
        # Encoder
        encoder_layers = []
        prev_dim = input_dim
        for dim in hidden_dims:
            encoder_layers.extend([
                nn.Linear(prev_dim, dim), nn.BatchNorm1d(dim), nn.ReLU(), nn.Dropout(0.1)
            ])
            prev_dim = dim
        encoder_layers.append(nn.Linear(prev_dim, latent_dim))
        self.encoder = nn.Sequential(*encoder_layers)

        # Decoder (mirror)
        decoder_layers = []
        prev_dim = latent_dim
        for dim in reversed(hidden_dims):
            decoder_layers.extend([
                nn.Linear(prev_dim, dim), nn.BatchNorm1d(dim), nn.ReLU(), nn.Dropout(0.1)
            ])
            prev_dim = dim
        decoder_layers.append(nn.Linear(prev_dim, input_dim))
        self.decoder = nn.Sequential(*decoder_layers)

    def forward(self, x):
        z = self.encoder(x)
        return self.decoder(z), z

class AnomalyDetectorModule(L.LightningModule):
    def __init__(self, input_dim: int = 5, learning_rate: float = 1e-3, threshold_percentile: float = 95):
        super().__init__()
        self.save_hyperparameters()
        self.model = SensorAutoencoder(input_dim=input_dim)
        self.threshold = None
        self.f1 = F1Score(task="binary")

    def forward(self, x):
        return self.model(x)

    def training_step(self, batch, batch_idx):
        x, _ = batch
        x_recon, _ = self(x)
        loss = nn.functional.mse_loss(x_recon, x)
        self.log("train_loss", loss, prog_bar=True)
        return loss

    def validation_step(self, batch, batch_idx):
        x, labels = batch
        x_recon, _ = self(x)
        loss = nn.functional.mse_loss(x_recon, x)
        recon_error = torch.mean((x - x_recon) ** 2, dim=1)
        self.log("val_loss", loss, prog_bar=True)
        return {"recon_error": recon_error, "labels": labels}

    def configure_optimizers(self):
        optimizer = torch.optim.AdamW(self.parameters(), lr=self.hparams.learning_rate, weight_decay=1e-5)
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=100, eta_min=1e-6)
        return {"optimizer": optimizer, "lr_scheduler": {"scheduler": scheduler, "monitor": "val_loss"}}
```

## Time Series Transformer

```python
import torch.nn as nn
import math
from einops import rearrange

class PositionalEncoding(nn.Module):
    def __init__(self, d_model: int, max_len: int = 5000):
        super().__init__()
        position = torch.arange(max_len).unsqueeze(1)
        div_term = torch.exp(torch.arange(0, d_model, 2) * (-math.log(10000.0) / d_model))
        pe = torch.zeros(max_len, 1, d_model)
        pe[:, 0, 0::2] = torch.sin(position * div_term)
        pe[:, 0, 1::2] = torch.cos(position * div_term)
        self.register_buffer('pe', pe)

    def forward(self, x):
        return x + self.pe[:x.size(0)]

class SensorTransformer(nn.Module):
    def __init__(self, input_dim: int = 5, d_model: int = 64, nhead: int = 4,
                 num_layers: int = 3, prediction_horizon: int = 12):
        super().__init__()
        self.prediction_horizon = prediction_horizon
        self.input_projection = nn.Linear(input_dim, d_model)
        self.pos_encoder = PositionalEncoding(d_model)
        encoder_layer = nn.TransformerEncoderLayer(d_model=d_model, nhead=nhead,
                                                    dim_feedforward=256, dropout=0.1, batch_first=False)
        self.transformer_encoder = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        self.output_projection = nn.Linear(d_model, input_dim * prediction_horizon)

    def forward(self, src):
        src = rearrange(src, 'b s d -> s b d')
        src = self.pos_encoder(self.input_projection(src))
        output = self.transformer_encoder(src)
        predictions = self.output_projection(output[-1])
        return rearrange(predictions, 'b (h d) -> b h d', h=self.prediction_horizon)
```

## Dataset & DataModule

```python
from torch.utils.data import Dataset, DataLoader
import numpy as np

class SensorDataset(Dataset):
    def __init__(self, data: np.ndarray, labels: np.ndarray = None,
                 sequence_length: int = 100, prediction_horizon: int = 12, normalize: bool = True):
        self.sequence_length = sequence_length
        self.prediction_horizon = prediction_horizon
        self.labels = labels

        if normalize:
            self.mean, self.std = np.mean(data, axis=0), np.std(data, axis=0) + 1e-8
            self.data = (data - self.mean) / self.std
        else:
            self.data = data

    def __len__(self):
        return len(self.data) - self.sequence_length - self.prediction_horizon + 1

    def __getitem__(self, idx):
        x = torch.tensor(self.data[idx:idx + self.sequence_length], dtype=torch.float32)
        y = torch.tensor(self.data[idx + self.sequence_length:idx + self.sequence_length + self.prediction_horizon], dtype=torch.float32)
        if self.labels is not None:
            return x, torch.tensor(self.labels[idx + self.sequence_length - 1], dtype=torch.long)
        return x, y

class SensorDataModule(L.LightningDataModule):
    def __init__(self, data_path: str, batch_size: int = 32, num_workers: int = 4):
        super().__init__()
        self.data_path = data_path
        self.batch_size = batch_size
        self.num_workers = num_workers

    def setup(self, stage=None):
        data = np.load(self.data_path)
        readings, labels = data['readings'], data.get('labels', None)
        n = len(readings)
        train_end, val_end = int(n * 0.7), int(n * 0.85)

        self.train_dataset = SensorDataset(readings[:train_end], labels[:train_end] if labels else None)
        self.val_dataset = SensorDataset(readings[train_end:val_end], labels[train_end:val_end] if labels else None)
        self.test_dataset = SensorDataset(readings[val_end:], labels[val_end:] if labels else None)

    def train_dataloader(self):
        return DataLoader(self.train_dataset, batch_size=self.batch_size, shuffle=True, num_workers=self.num_workers, pin_memory=True)

    def val_dataloader(self):
        return DataLoader(self.val_dataset, batch_size=self.batch_size, num_workers=self.num_workers, pin_memory=True)
```

## Training Script

```python
import lightning as L
from lightning.pytorch.callbacks import ModelCheckpoint, EarlyStopping, LearningRateMonitor
from lightning.pytorch.loggers import WandbLogger

def train(data_path: str, max_epochs: int = 100):
    datamodule = SensorDataModule(data_path=data_path, batch_size=32)
    model = AnomalyDetectorModule(input_dim=5, learning_rate=1e-3)

    callbacks = [
        ModelCheckpoint(dirpath="checkpoints", filename="{epoch:02d}-{val_loss:.4f}",
                       monitor="val_loss", mode="min", save_top_k=3),
        EarlyStopping(monitor="val_loss", patience=10, mode="min"),
        LearningRateMonitor(logging_interval="epoch"),
    ]

    trainer = L.Trainer(
        max_epochs=max_epochs,
        accelerator="auto",
        callbacks=callbacks,
        logger=WandbLogger(project="ml-training"),
        precision="16-mixed",
        gradient_clip_val=1.0,
    )

    trainer.fit(model, datamodule)
    trainer.test(model, datamodule)
    return model
```

## Inference

```python
class Predictor:
    def __init__(self, model_path: str, threshold: float, device: str = "cuda"):
        self.device = torch.device(device if torch.cuda.is_available() else "cpu")
        self.model = AnomalyDetectorModule.load_from_checkpoint(model_path)
        self.model.to(self.device).eval()
        self.threshold = threshold

    @torch.no_grad()
    def predict(self, readings: np.ndarray):
        x = torch.tensor(readings, dtype=torch.float32).unsqueeze(0).to(self.device)
        x_recon, _ = self.model(x)
        error = torch.mean((x - x_recon) ** 2, dim=-1).squeeze().cpu().numpy()
        return error, error > self.threshold
```

## Best Practices

1. **Mixed precision** - `precision="16-mixed"` for faster training
2. **Gradient clipping** - Prevent exploding gradients with `gradient_clip_val=1.0`
3. **LR scheduling** - CosineAnnealingLR or ReduceLROnPlateau
4. **Save normalization params** - Include mean/std in checkpoint
5. **torch.compile** - Use for inference: `model = torch.compile(model, mode="reduce-overhead")`

## Related Skills

- `onnx-inference`: Model export and deployment
- `mlflow`: Experiment tracking
- `scikit-learn`: Classical ML comparison
- `ai-ml`: Full training pipelines
