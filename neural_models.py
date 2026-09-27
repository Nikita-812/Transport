"""Compact torch candidates; torch is imported only on explicit use."""

from __future__ import annotations

from models import FEATURE_NAMES


class TorchCandidate:
    def __init__(self, kind, parameters, backend, seed):
        self.kind, self.parameters, self.backend, self.seed = kind, parameters, backend, seed

    def fit(self, rows, sample_weight=None):
        import numpy as np
        import torch
        torch.manual_seed(self.seed)
        if self.backend == "gpu" and not torch.cuda.is_available():
            raise RuntimeError("requested GPU backend is unavailable")
        self.device = torch.device("cuda" if self.backend == "gpu" else "cpu")
        x = np.asarray([[float(r[n]) for n in FEATURE_NAMES] for r in rows], dtype="float32")
        y = np.asarray([float(r["boardings"]) for r in rows], dtype="float32")[:, None]
        self.mean = x.mean(axis=0); self.std = x.std(axis=0); self.std[self.std == 0] = 1
        xt = torch.as_tensor((x - self.mean) / self.std, device=self.device)
        yt = torch.as_tensor(y, device=self.device)
        width = int(self.parameters.get("width", 64))
        layers = [torch.nn.Linear(x.shape[1], width), torch.nn.ReLU()]
        for _ in range(max(0, int(self.parameters.get("layers", 2)) - 1)):
            layers += [torch.nn.Linear(width, width), torch.nn.ReLU()]
        layers += [torch.nn.Linear(width, 1)]
        self.model = torch.nn.Sequential(*layers).to(self.device)
        optimizer = torch.optim.Adam(self.model.parameters(), lr=1e-3)
        batch = min(4096, len(x))
        generator = torch.Generator().manual_seed(self.seed)
        loader = torch.utils.data.DataLoader(torch.utils.data.TensorDataset(xt, yt), batch_size=batch, shuffle=True, generator=generator)
        self.model.train()
        for _ in range(int(self.parameters.get("epochs", 20))):
            for xb, yb in loader:
                optimizer.zero_grad(); loss = torch.nn.functional.l1_loss(self.model(xb), yb); loss.backward(); optimizer.step()
        self.model = self.model.to("cpu").eval(); self.device = torch.device("cpu")
        return self

    def predict(self, rows):
        import numpy as np
        import torch
        x = np.asarray([[float(r[n]) for n in FEATURE_NAMES] for r in rows], dtype="float32")
        with torch.no_grad():
            result = self.model(torch.as_tensor((x - self.mean) / self.std)).squeeze(1).numpy()
        if not np.isfinite(result).all():
            raise ValueError("model returned non-finite predictions")
        return np.maximum(result, 0).astype(float).tolist()
