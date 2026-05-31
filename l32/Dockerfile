FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN go build -o api-server ./cmd/api-server
RUN go build -o worker ./cmd/worker
RUN go build -o file-splitter ./cmd/file-splitter
RUN go build -o scaler ./cmd/scaler

FROM alpine:latest

RUN apk --no-cache add ca-certificates docker-cli

WORKDIR /root/

COPY --from=builder /app/api-server .
COPY --from=builder /app/worker .
COPY --from=builder /app/file-splitter .
COPY --from=builder /app/scaler .

EXPOSE 8080
