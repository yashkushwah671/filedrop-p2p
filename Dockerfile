# ===================================================================
# Multi-stage Dockerfile for FileDrop Spring Boot Application
# ===================================================================

# -------------------------------------------------------------------
# Stage 1: Build the Application
# -------------------------------------------------------------------
FROM maven:3.9.6-eclipse-temurin-17-alpine AS builder

WORKDIR /build

# Copy pom.xml first to leverage Docker layer caching for dependencies
COPY pom.xml .
RUN mvn dependency:go-offline -B

# Copy source code and package application
COPY src ./src
RUN mvn clean package -DskipTests -B

# -------------------------------------------------------------------
# Stage 2: Production Runtime
# -------------------------------------------------------------------
FROM eclipse-temurin:17-jre-alpine

WORKDIR /app

# Add non-root user for security
RUN addgroup -S filedrop && adduser -S filedrop -G filedrop
USER filedrop:filedrop

# Copy generated JAR from builder stage
COPY --from=builder /build/target/filedrop-1.0.0.jar app.jar

# Render injects PORT dynamically; fallback to 8080
ENV PORT=8080
EXPOSE ${PORT}

# Healthcheck configuration
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/api/health || exit 1

# Launch the Spring Boot application
ENTRYPOINT ["sh", "-c", "java -Djava.security.egd=file:/dev/./urandom -Dserver.port=${PORT} -jar app.jar"]
