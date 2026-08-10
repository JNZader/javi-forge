FROM node:22-slim
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10
RUN useradd -m -s /bin/bash runner
USER runner
WORKDIR /home/runner/work
ENTRYPOINT ["/bin/bash", "-c"]
