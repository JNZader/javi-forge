FROM golang:1.23-bookworm@sha256:167053a2bb901972bf2c1611f8f52c44d5fe7e762e5cab213708d82c421614db
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN go install github.com/golangci/golangci-lint/cmd/golangci-lint@v1.62.0 && mv /root/go/bin/golangci-lint /usr/local/bin/
RUN useradd -m -s /bin/bash runner
USER runner
WORKDIR /home/runner/work
ENTRYPOINT ["/bin/bash", "-c"]
