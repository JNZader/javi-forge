FROM python:3.12-slim@sha256:401f6e1a67dad31a1bd78e9ad22d0ee0a3b52154e6bd30e90be696bb6a3d7461
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir pytest ruff pylint poetry
RUN useradd -m -s /bin/bash runner
USER runner
WORKDIR /home/runner/work
ENTRYPOINT ["/bin/bash", "-c"]
