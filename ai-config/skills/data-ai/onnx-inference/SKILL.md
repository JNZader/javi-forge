---
name: onnx-inference
description: >
  Deploy ML models with ONNX Runtime for cross-platform inference (Python, Rust, Go).
  Trigger: onnx, model deployment, inference, edge ml, quantization
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [onnx, ml, inference, edge, deployment]
  updated: "2026-02"
---

# ONNX Inference Skill

Deploy ML models with ONNX Runtime for cross-platform, high-performance inference.

## Stack

```yaml
# Python
onnx: 1.15+
onnxruntime: 1.17+
torch: 2.2+

# Rust
ort: 2.0+

# Go
onnxruntime_go: 1.17+
```

## Model Export

### PyTorch to ONNX

```python
import torch
import torch.onnx

def export_model(model: torch.nn.Module, output_path: str, input_shape: tuple):
    model.eval()
    dummy_input = torch.randn(*input_shape)

    torch.onnx.export(
        model,
        dummy_input,
        output_path,
        export_params=True,
        opset_version=17,
        do_constant_folding=True,
        input_names=['input'],
        output_names=['output'],
        dynamic_axes={
            'input': {0: 'batch_size'},
            'output': {0: 'batch_size'}
        }
    )

# Validate
def validate_model(model_path: str):
    import onnx
    model = onnx.load(model_path)
    onnx.checker.check_model(model)
    print(f"Inputs: {[i.name for i in model.graph.input]}")
    print(f"Outputs: {[o.name for o in model.graph.output]}")
```

### Scikit-learn to ONNX

```python
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType

def export_sklearn(model, output_path: str, input_features: int):
    initial_type = [('input', FloatTensorType([None, input_features]))]
    onnx_model = convert_sklearn(
        model,
        initial_types=initial_type,
        target_opset=17,
        options={id(model): {'zipmap': False}}
    )
    with open(output_path, 'wb') as f:
        f.write(onnx_model.SerializeToString())
```

## Python Inference

```python
import onnxruntime as ort
import numpy as np

class ONNXPredictor:
    def __init__(self, model_path: str, providers: list = None):
        if providers is None:
            providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']

        sess_options = ort.SessionOptions()
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        sess_options.intra_op_num_threads = 4

        self.session = ort.InferenceSession(model_path, sess_options, providers=providers)
        self.input_name = self.session.get_inputs()[0].name
        self.output_names = [o.name for o in self.session.get_outputs()]

    def predict(self, data: np.ndarray) -> np.ndarray:
        if data.dtype != np.float32:
            data = data.astype(np.float32)
        outputs = self.session.run(self.output_names, {self.input_name: data})
        return outputs[0]

    def predict_batch(self, data: np.ndarray, batch_size: int = 32) -> np.ndarray:
        results = []
        for i in range(0, len(data), batch_size):
            batch = data[i:i + batch_size]
            results.append(self.predict(batch))
        return np.concatenate(results, axis=0)
```

## Rust Inference

```rust
// Cargo.toml: ort = { version = "2.0", features = ["load-dynamic"] }
use ort::{Environment, Session, SessionBuilder, Value};
use ndarray::{Array3, ArrayD, IxDyn};
use std::sync::Arc;

pub struct Predictor {
    session: Session,
}

impl Predictor {
    pub fn new(model_path: &str) -> Result<Self, ort::Error> {
        let environment = Arc::new(
            Environment::builder()
                .with_name("inference")
                .with_execution_providers([ort::ExecutionProvider::CPU(Default::default())])
                .build()?
        );

        let session = SessionBuilder::new(&environment)?
            .with_optimization_level(ort::GraphOptimizationLevel::Level3)?
            .with_intra_threads(4)?
            .with_model_from_file(model_path)?;

        Ok(Self { session })
    }

    pub fn predict(&self, input: Array3<f32>) -> Result<Vec<f32>, ort::Error> {
        let shape = input.shape().to_vec();
        let data: Vec<f32> = input.into_iter().collect();
        let tensor = Value::from_array(
            self.session.allocator(),
            &ArrayD::from_shape_vec(IxDyn(&shape), data)?
        )?;

        let outputs = self.session.run(vec![tensor])?;
        let result: ArrayD<f32> = outputs[0].try_extract()?.view().to_owned();
        Ok(result.into_iter().collect())
    }
}
```

## Go Inference

```go
package ml

import "github.com/yalue/onnxruntime_go"

type Predictor struct {
    session *onnxruntime_go.AdvancedSession
}

func NewPredictor(modelPath string) (*Predictor, error) {
    onnxruntime_go.InitializeEnvironment()
    session, err := onnxruntime_go.NewAdvancedSession(
        modelPath,
        []string{"input"},
        []string{"output"},
        nil,
    )
    if err != nil {
        return nil, err
    }
    return &Predictor{session: session}, nil
}

func (p *Predictor) Predict(input []float32, shape []int64) ([]float32, error) {
    inputTensor, _ := onnxruntime_go.NewTensor(onnxruntime_go.NewShape(shape...), input)
    defer inputTensor.Destroy()

    outputSize := int64(1)
    for _, d := range shape[1:] { outputSize *= d }
    outputData := make([]float32, outputSize)
    outputTensor, _ := onnxruntime_go.NewTensor(onnxruntime_go.NewShape(shape[0], outputSize), outputData)
    defer outputTensor.Destroy()

    p.session.Run()
    return outputTensor.GetData(), nil
}

func (p *Predictor) Close() {
    p.session.Destroy()
    onnxruntime_go.DestroyEnvironment()
}
```

## Model Optimization

### Quantization

```python
from onnxruntime.quantization import quantize_dynamic, QuantType

def quantize_model(input_path: str, output_path: str):
    quantize_dynamic(input_path, output_path, weight_type=QuantType.QInt8)

def optimize_model(input_path: str, output_path: str):
    import onnxoptimizer
    import onnx

    model = onnx.load(input_path)
    passes = [
        'eliminate_identity',
        'eliminate_deadend',
        'fuse_bn_into_conv',
        'fuse_matmul_add_bias_into_gemm',
    ]
    optimized = onnxoptimizer.optimize(model, passes)
    onnx.save(optimized, output_path)

# Full pipeline
def prepare_for_edge(model_path: str):
    base = model_path.replace('.onnx', '')
    optimize_model(model_path, f"{base}_optimized.onnx")
    quantize_model(f"{base}_optimized.onnx", f"{base}_quantized.onnx")
```

## Model Registry

```python
import hashlib
import json
from pathlib import Path
from datetime import datetime

class ModelRegistry:
    def __init__(self, registry_path: str = "models/registry.json"):
        self.path = Path(registry_path)
        self.registry = json.loads(self.path.read_text()) if self.path.exists() else {"models": {}}

    def register(self, name: str, model_path: str, version: str, metrics: dict = None):
        model_hash = hashlib.sha256(Path(model_path).read_bytes()).hexdigest()[:16]
        if name not in self.registry["models"]:
            self.registry["models"][name] = {"versions": {}}

        self.registry["models"][name]["versions"][version] = {
            "path": model_path,
            "hash": model_hash,
            "registered_at": datetime.utcnow().isoformat(),
            "metrics": metrics or {}
        }
        self.registry["models"][name]["latest"] = version
        self.path.write_text(json.dumps(self.registry, indent=2))

    def get_path(self, name: str, version: str = "latest") -> str:
        if version == "latest":
            version = self.registry["models"][name]["latest"]
        return self.registry["models"][name]["versions"][version]["path"]
```

## Best Practices

1. **Dynamic axes** - Enable batch dimension flexibility
2. **Quantize for edge** - INT8 reduces size ~4x with minimal accuracy loss
3. **Validate exports** - Always run `onnx.checker.check_model()`
4. **Use execution providers** - CUDA > TensorRT > CPU fallback
5. **Version models** - Track hash, metrics, and metadata

## Related Skills

- `pytorch`: Model training source
- `scikit-learn`: Classical ML models
- `ai-ml`: Full pipeline patterns
- `fastapi`: Model serving API
