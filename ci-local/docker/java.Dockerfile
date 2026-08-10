ARG JAVA_VERSION=21
FROM eclipse-temurin:${JAVA_VERSION}-jdk-noble
RUN apt-get update && apt-get install -y git curl unzip && rm -rf /var/lib/apt/lists/*
RUN useradd -m -s /bin/bash runner
USER runner
WORKDIR /home/runner/work
ENV GRADLE_USER_HOME=/home/runner/.gradle
ENTRYPOINT ["/bin/bash", "-c"]
